import { describe, it, expect } from 'vitest'
import { recalcAbsLengths, rebuildCoords } from '../storage'
import {
  computeStraightValuesUtm, computeCurvedValuesUtm, endPointStraightUtm, resolveEndBearing,
  nodeUtm,
} from '../utils/elementUtils'
import { utmToWgs84 } from '../utils/coordinateUtils'
import { SWITCH_TYPES, computeSwitchGeometryUtm } from '../utils/switchUtils'
import { newSwitchFields, switchElementMark } from '../utils/switchModel'
import { switchEndAnchorRefusal } from '../utils/switchPlacement'
import { carveSwitchRoute } from '../utils/trackSplitUtils'
import { planSwitchDeletion } from '../utils/switchDelete'
import {
  expectValidTrack, expectSwitchRoutesCarved, expectNodesJoin,
} from './chainInvariants'

/**
 * AP 1.3 — the element boundary at a switch end, across all four dialogs.
 *
 * A turnout's two routes have to be elements of their own: the branch and the
 * through route, each beginning at its port's node. Where that does not happen
 * the record carries a port with nothing behind it — the symbol falls back on
 * the stem radii and the delete rules (AP 1.2) find a route that is not there.
 *
 * `SwitchOnTrackForm` and `SCurveForm` carve the through route out of the track
 * (carveSwitchRoute); the two "at a track end" dialogs build it as new geometry,
 * which only works where the anchor really is a track end.
 */

const EPSG  = 25832
const START = { easting: 500000, northing: 5600000, zone: EPSG }
const FORM  = SWITCH_TYPES[2]
const toWgs = (u) => utmToWgs84(u.easting, u.northing, u.zone)

function straightElement(startUtm, bearing, length) {
  const endUtm = endPointStraightUtm(startUtm, bearing, length)
  const v = computeStraightValuesUtm(startUtm, endUtm)
  return {
    elementType: 0,
    startNode: v.startNode, endNode: v.endNode,
    bearing: v.bearing, length: v.length, absLength: v.length, speed: 100,
    geometry: { type: 'LineString', coordinates: [toWgs(startUtm), toWgs(endUtm)] },
  }
}

const trackOf = (id, name, elements) => {
  const els = recalcAbsLengths(elements)
  return { id, name, epsg: EPSG, elements: els, coordinates: rebuildCoords(els) }
}

/** A line track of `n` straights, the shape the dialogs are picked on. */
function lineTrack(n = 2, bearing = 20, each = 200) {
  const els = []
  let at = START
  for (let i = 0; i < n; i++) {
    const el = straightElement(at, bearing, each)
    els.push(el)
    at = { easting: el.endNode[0], northing: el.endNode[1], zone: EPSG }
  }
  return trackOf('t-line', 'line.001', els)
}

/**
 * What ConnectStraightSwitchForm / ConnectSwitchConnectionForm commit: the two
 * route elements from the geometry, hung on the track the anchor belongs to —
 * appended to it (trailing) or as a track of its own (facing).
 */
function connectSwitchAt(track, elIdx, { trailing = false } = {}) {
  const el      = track.elements[elIdx]
  const endWgs  = el.geometry.coordinates[el.geometry.coordinates.length - 1]
  const startUtm = nodeUtm(el.endNode, endWgs, track.epsg)
  const bearing  = resolveEndBearing(el, track.epsg)
  const g = computeSwitchGeometryUtm(startUtm, bearing, FORM, 'left', trailing, endWgs, null)

  const identity = { ...newSwitchFields(), name: 'W 1', label: FORM.label }
  const sv = computeStraightValuesUtm(g.startUtm, g.straightUtm)
  const cv = computeCurvedValuesUtm(g.arcOriginUtm, g.curvedUtm, g.signedR)

  const mainEl = {
    elementType: 0,
    startNode: sv.startNode, endNode: sv.endNode,
    bearing: sv.bearing, length: sv.length, absLength: sv.length, speed: 100,
    ...switchElementMark(identity, 'main'),
    geometry: { type: 'LineString', coordinates: g.straightCoords },
  }
  const branchEl = {
    elementType: 1,
    startNode: cv.startNode, endNode: cv.endNode,
    bearing: cv.bearing, endBearing: cv.endBearing,
    length: cv.length, absLength: cv.length, radius: g.signedR, cant: 0, speed: 100,
    ...switchElementMark(identity, 'branch'),
    geometry: { type: 'LineString', coordinates: g.arcCoords },
  }
  const branchTrack = trackOf('t-branch', 'branch.001', [branchEl])

  if (trailing) {
    // addElementToTrack: appended to the track's last position.
    const host = trackOf(track.id, track.name, [...track.elements, mainEl])
    return {
      tracks: [host, branchTrack],
      record: {
        ...identity, trailing: true, speed: 100,
        portA_trackId: null,           portA_endpoint:  null,
        portB1_trackId: branchTrack.id, portB1_endpoint: 'BEGIN',
        portB2_trackId: host.id,        portB2_endpoint: 'END',
      },
    }
  }
  const mainTrack = trackOf('t-main', 'main.001', [mainEl])
  return {
    tracks: [track, mainTrack, branchTrack],
    record: {
      ...identity, trailing: false, speed: 100,
      portA_trackId: track.id,        portA_endpoint:  'END',
      portB1_trackId: branchTrack.id, portB1_endpoint: 'BEGIN',
      portB2_trackId: mainTrack.id,   portB2_endpoint: 'BEGIN',
    },
  }
}

// ── the anchor ──────────────────────────────────────────────────────────────

describe('where a turnout may be attached to a track end', () => {
  it('takes the last element of a track', () => {
    const track = lineTrack(3)
    expect(switchEndAnchorRefusal(track, 2)).toBeNull()
  })

  it('refuses an element end inside the track — that is the other dialog’s', () => {
    const track = lineTrack(3)
    expect(switchEndAnchorRefusal(track, 0)).toBe('switch_anchor_not_track_end')
    expect(switchEndAnchorRefusal(track, 1)).toBe('switch_anchor_not_track_end')
  })

  it('refuses an index that names no element', () => {
    expect(switchEndAnchorRefusal(lineTrack(1), 5)).toBe('switch_anchor_no_element')
    expect(switchEndAnchorRefusal({ elements: [] }, 0)).toBe('switch_anchor_no_element')
  })

  it('is what keeps the trailing commit from breaking the chain', () => {
    // Anchored inside the track, the appended through route lands behind
    // elements it does not touch — the very gap the refusal prevents.
    const track = lineTrack(3)
    const { tracks } = connectSwitchAt(track, 0, { trailing: true })
    const host = tracks[0]
    expect(() => expectNodesJoin(host.elements)).toThrow()
    expect(switchEndAnchorRefusal(track, 0)).not.toBeNull()
  })
})

// ── both switch ends are element boundaries ─────────────────────────────────

describe('a turnout attached at a track end', () => {
  it('facing: both routes are elements of their own', () => {
    const { tracks, record } = connectSwitchAt(lineTrack(2), 1)
    expectSwitchRoutesCarved(record, tracks)
    tracks.forEach(expectValidTrack)
  })

  it('trailing: the through route joins the track it extends', () => {
    const { tracks, record } = connectSwitchAt(lineTrack(2), 1, { trailing: true })
    expectSwitchRoutesCarved(record, tracks)
    tracks.forEach(expectValidTrack)
  })

  it('and the delete rules find both of its routes again', () => {
    for (const trailing of [false, true]) {
      const { tracks, record } = connectSwitchAt(lineTrack(2), 1, { trailing })
      const plan = planSwitchDeletion(record, tracks)
      // Nothing runs on past either switch end yet, so the turnout is all there
      // is of itself: it goes with both of its routes.
      expect(plan.reason).toBe('all')
      expect(plan.removedElements).toBeGreaterThanOrEqual(2)
    }
  })
})

// ── what SCurveForm now refuses instead of committing ───────────────────────

describe('the through route a junction switch needs beside it', () => {
  const mark = { switchBranch: true, switchRoute: 'main', switchId: 'x' }
  const isPlainStraight = (el) => el.elementType !== 2 && el.radius == null

  it('carves where there is straight enough ahead', () => {
    const track = lineTrack(1, 20, 200)
    const cut   = endPointStraightUtm(START, 20, 50)
    const carved = carveSwitchRoute(track, 'BEGIN', cut, mark, 50, { accepts: isPlainStraight })
    expect(carved).not.toBeNull()
    expect(carved.elements[0].switchId).toBe('x')
  })

  it('refuses where the track ends first — the case that used to commit a switch with no through route', () => {
    const track = lineTrack(1, 20, 30)
    const cut   = endPointStraightUtm(START, 20, 50)
    expect(carveSwitchRoute(track, 'BEGIN', cut, mark, 50, { accepts: isPlainStraight })).toBeNull()
  })

  it('refuses where a curve lies where the route would', () => {
    const track = lineTrack(1, 20, 200)
    const curved = trackOf(track.id, track.name,
      track.elements.map(el => ({ ...el, elementType: 1, radius: 900 })))
    const cut = endPointStraightUtm(START, 20, 50)
    expect(carveSwitchRoute(curved, 'BEGIN', cut, mark, 50, { accepts: isPlainStraight })).toBeNull()
  })
})
