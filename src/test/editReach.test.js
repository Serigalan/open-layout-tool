import { describe, it, expect } from 'vitest'
import { recalcAbsLengths, rebuildCoords } from '../storage'
import {
  computeStraightValuesUtm, computeCurvedValuesUtm, arcCoordsFromRadiusUtm,
  endPointStraightUtm, endPointCurvedUtm, bearingAfterUtm,
} from '../utils/elementUtils'
import { utmToWgs84 } from '../utils/coordinateUtils'
import { SAGITTA_ELEMENT, SAGITTA_TRACK, MAX_EDIT_SWITCHES, MAX_EDIT_TRACKS } from '../utils/mapConstants'
import { newSwitchFields, switchElementMark } from '../utils/switchModel'
import { planElementChange, mergeElementEdits } from '../components/panels/EditElementPanel/editGeometry'
import { expectValidTrack } from './chainInvariants'

/**
 * AP 5.1 — how far one change in the track editor reaches.
 *
 * `planElementChange` re-shapes the element and everything hanging off its end,
 * across track and project boundaries. The point of these tests is the *reach*:
 * that it is reported truthfully, that a switch standing on a re-shaped track
 * counts as reached even when none of its own elements moved, and that the
 * limits refuse what nobody could oversee.
 */

const EPSG  = 25832
const START = { easting: 500000, northing: 5600000, zone: EPSG }
const toWgs = (u) => utmToWgs84(u.easting, u.northing, u.zone)

function straight(startUtm, bearing, length, extra = {}) {
  const endUtm = endPointStraightUtm(startUtm, bearing, length)
  const v = computeStraightValuesUtm(startUtm, endUtm)
  return {
    elementType: 0,
    startNode: v.startNode, endNode: v.endNode,
    bearing: v.bearing, length: v.length, absLength: v.length, speed: 100, ...extra,
    geometry: { type: 'LineString', coordinates: [toWgs(startUtm), toWgs(endUtm)] },
  }
}

function arc(startUtm, bearing, length, radius, extra = {}) {
  const endUtm = endPointCurvedUtm(startUtm, bearing, length, radius)
  const v = computeCurvedValuesUtm(startUtm, endUtm, radius)
  return {
    elementType: 1,
    startNode: v.startNode, endNode: v.endNode,
    bearing: v.bearing, endBearing: v.endBearing,
    length: v.length, absLength: v.length, radius, cant: 0, speed: 100, ...extra,
    geometry: { type: 'LineString', coordinates: arcCoordsFromRadiusUtm(startUtm, endUtm, radius, SAGITTA_ELEMENT) },
    renderCoords: arcCoordsFromRadiusUtm(startUtm, endUtm, radius, SAGITTA_TRACK),
  }
}

const trackOf = (id, elements) => {
  const els = recalcAbsLengths(elements)
  return { id, name: id, epsg: EPSG, elements: els, coordinates: rebuildCoords(els) }
}

const endOf = (el) => ({ easting: el.endNode[0], northing: el.endNode[1], zone: EPSG })

/** `n` tracks laid end to end, each one straight, all in the same plane. */
function chainOfTracks(n, bearing = 20, each = 200) {
  const tracks = []
  let at = START
  for (let i = 0; i < n; i++) {
    const el = straight(at, bearing, each)
    tracks.push(trackOf(`t${i}`, [el]))
    at = endOf(el)
  }
  return tracks
}

// ── what it reaches ─────────────────────────────────────────────────────────

describe('the reach of one change', () => {
  it('is the edited track alone where nothing hangs off its end', () => {
    const tracks = chainOfTracks(1)
    const plan = planElementChange(tracks, [], 't0', 0, { length: 250 })
    expect(plan.error).toBeNull()
    expect(plan.touchedTrackIds).toEqual(['t0'])
    expect(plan.touchedSwitchIds).toEqual([])
    plan.tracks.forEach(expectValidTrack)
  })

  it('follows the chain across track boundaries', () => {
    const tracks = chainOfTracks(3)
    const plan = planElementChange(tracks, [], 't0', 0, { length: 250 })
    expect(new Set(plan.touchedTrackIds)).toEqual(new Set(['t0', 't1', 't2']))
    // …and every one of them still holds together afterwards.
    plan.tracks.forEach(expectValidTrack)
    // The chain really moved: the last track starts 50 m further along.
    const moved = plan.tracks.find(t => t.id === 't2').elements[0]
    const before = tracks.find(t => t.id === 't2').elements[0]
    expect(moved.startNode[1] - before.startNode[1]).toBeCloseTo(50 * Math.cos(20 * Math.PI / 180), 6)
  })

  it('refuses a change that rebuilds more tracks than anyone can oversee', () => {
    const tracks = chainOfTracks(MAX_EDIT_TRACKS + 1)
    const plan = planElementChange(tracks, [], 't0', 0, { length: 250 })
    expect(plan.touchedTrackIds).toHaveLength(MAX_EDIT_TRACKS + 1)
    expect(plan.error).toBe('table_edit_too_wide')
    // The tracks still come back, so a preview can show what was refused.
    expect(plan.tracks).toHaveLength(MAX_EDIT_TRACKS + 1)
  })
})

// ── the switches it reaches ─────────────────────────────────────────────────

describe('the switches one change reaches', () => {
  /** Two tracks end to end, with a turnout standing on the second one. */
  function withSwitch({ marked = true } = {}) {
    const [a, b] = chainOfTracks(2)
    const sw = { ...newSwitchFields(), name: 'W 1', label: '500 - 1:12' }
    const mark = marked ? switchElementMark(sw, 'main') : {}
    const host = trackOf('t1', b.elements.map(el => ({ ...el, ...mark })))
    const branchStart = { easting: b.elements[0].startNode[0], northing: b.elements[0].startNode[1], zone: EPSG }
    const branch = trackOf('t-branch', [
      { ...arc(branchStart, bearingAfterUtm(20, 0, null), 40, -300), ...switchElementMark(sw, 'branch') },
    ])
    const record = {
      ...sw,
      portA_trackId: 't0',       portA_endpoint: 'END',
      portB1_trackId: 't-branch', portB1_endpoint: 'BEGIN',
      portB2_trackId: 't1',       portB2_endpoint: 'BEGIN',
    }
    return { tracks: [a, host, branch], switches: [record], record }
  }

  it('counts one whose own route elements are re-shaped', () => {
    const { tracks, switches, record } = withSwitch()
    const plan = planElementChange(tracks, switches, 't0', 0, { length: 250 })
    expect(plan.touchedSwitchIds).toEqual([record.switchId])
  })

  it('counts one standing on a re-shaped track even where its own elements did not move', () => {
    // Nothing on the host track carries the switch's mark, so only the port
    // makes the connection — which is the case a mark-only check would miss.
    const { tracks, switches, record } = withSwitch({ marked: false })
    const plan = planElementChange(tracks, switches, 't0', 0, { length: 250 })
    expect(plan.touchedSwitchIds).toEqual([record.switchId])
  })

  it('refuses a change that would move more than one turnout', () => {
    const { tracks, switches } = withSwitch()
    const second = { ...newSwitchFields(), name: 'W 2', label: '500 - 1:12' }
    const also = {
      ...second,
      portA_trackId: 't1', portA_endpoint: 'END',
      portB1_trackId: 't-branch', portB1_endpoint: 'END',
      portB2_trackId: 't1', portB2_endpoint: 'END',
    }
    const plan = planElementChange(tracks, [...switches, also], 't0', 0, { length: 250 })
    expect(plan.touchedSwitchIds.length).toBeGreaterThan(MAX_EDIT_SWITCHES)
    expect(plan.error).toBe('table_edit_too_wide')
  })

  it('leaves a switch on another track alone', () => {
    const { tracks, switches } = withSwitch()
    const elsewhere = chainOfTracks(1)[0]
    const far = { ...trackOf('t-far', elsewhere.elements), id: 't-far' }
    const other = { ...newSwitchFields(), name: 'W 9', label: '500 - 1:12',
      portA_trackId: 't-far', portA_endpoint: 'END',
      portB1_trackId: 't-far', portB1_endpoint: 'BEGIN',
      portB2_trackId: 't-far', portB2_endpoint: 'BEGIN' }
    const plan = planElementChange([...tracks, far], [...switches, other], 't0', 0, { length: 210 })
    expect(plan.touchedSwitchIds).not.toContain(other.switchId)
  })
})

// ── the plan writes nothing ─────────────────────────────────────────────────

describe('planElementChange is a dry run', () => {
  it('leaves the tracks it was given untouched', () => {
    const tracks = chainOfTracks(2)
    const before = structuredClone(tracks)
    planElementChange(tracks, [], 't0', 0, { length: 250 })
    expect(tracks).toEqual(before)
  })
})

/**
 * What Save writes back. The table holds a copy of every track of the project
 * from the moment it was opened, so this is the difference between writing its
 * own edits and writing the whole world as it looked back then — an undo, or
 * the height fill running in the background, must not be taken back out by the
 * next press of Save.
 */
describe('mergeElementEdits', () => {
  const el = (length) => ({ elementType: 0, length, bearing: 0 })
  const store = () => ([
    { id: 't1', name: 'one', epsg: 25832, elements: [el(100)], coordinates: [[1, 1]], heights: [{ station: 0, z: 100 }] },
    { id: 't2', name: 'two', epsg: 25832, elements: [el(200)], coordinates: [[2, 2]] },
  ])

  it('leaves a track the table did not change exactly as the store has it', () => {
    const now = store()
    const stale = [{ ...now[0], heights: undefined }, { ...now[1], elements: [el(999)] }]
    const merged = mergeElementEdits(now, stale, { changed: [] })
    expect(merged).toEqual(now)
    expect(merged[0]).toBe(now[0])   // not even copied
  })

  it('lays the edited elements over the record the store has now', () => {
    const now = store()
    const edited = [{ ...now[0], name: 'stale name', elements: [el(120)], coordinates: [[9, 9]] }, now[1]]
    const [t1] = mergeElementEdits(now, edited, { changed: ['t1'] })
    expect(t1.elements).toEqual([el(120)])
    expect(t1.coordinates).toEqual([[9, 9]])
    // Everything else is the store's: the table edits elements, nothing else.
    expect(t1.name).toBe('one')
    expect(t1.epsg).toBe(25832)
  })

  it('keeps heights written under it where it only changed metadata', () => {
    const now = store()
    // The working copy predates the height fill; the element lengths are the
    // same, so its stations still hold and the fresh heights stay.
    const edited = [{ ...now[0], heights: undefined, elements: [{ ...el(100), speed: 80 }] }, now[1]]
    const [t1] = mergeElementEdits(now, edited, { changed: ['t1'], reshaped: [] })
    expect(t1.heights).toEqual([{ station: 0, z: 100 }])
    expect(t1.elements[0].speed).toBe(80)
  })

  it('takes the heights of a track it re-shaped, dropped ones included', () => {
    const now = store()
    // A new length re-stations the track, so planElementChange cuts the height
    // points there — that deletion is a result and has to reach the store.
    const edited = [{ ...now[0], elements: [el(120)], heights: undefined }, now[1]]
    const [t1] = mergeElementEdits(now, edited, { changed: ['t1'], reshaped: ['t1'] })
    expect('heights' in t1).toBe(false)

    const trimmed = [{ ...now[0], elements: [el(120)], heights: [{ station: 0, z: 100 }] }, now[1]]
    const [kept] = mergeElementEdits(now, trimmed, { changed: ['t1'], reshaped: ['t1'] })
    expect(kept.heights).toEqual([{ station: 0, z: 100 }])
  })

  it('does not resurrect a track the store no longer has', () => {
    const now = [store()[1]]
    const edited = store()
    expect(mergeElementEdits(now, edited, { changed: ['t1', 't2'] }).map(tr => tr.id)).toEqual(['t2'])
  })

  it('reaches every track one change re-shaped, not only the edited one', () => {
    const now = store()
    const edited = [
      { ...now[0], elements: [el(120)] },
      { ...now[1], elements: [el(220)] },
    ]
    const merged = mergeElementEdits(now, edited, { changed: ['t1', 't2'], reshaped: ['t1', 't2'] })
    expect(merged.map(tr => tr.elements[0].length)).toEqual([120, 220])
  })
})
