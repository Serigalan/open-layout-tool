import { describe, it, expect } from 'vitest'
import { rebuildCoords } from '../utils/trackModel'
import { buildConnectCurved, buildConnectStraight, buildCurvedLineTrack, buildLineTrack, trackOf } from '../utils/commands/tracks'
import { buildSwitchOnTrack, switchOnTrackPlacement } from '../utils/commands/switches'
import { arcFrom, straightFrom, transitionElement } from '../utils/elementFactory'
import { endPointStraightUtm, endPointCurvedUtm } from '../utils/elementUtils'
import { SWITCH_TYPES, switchStraightLength } from '../utils/switch/catalogue'
import { dehydrateProjects, hydrateProjects } from '../utils/persistenceUtils'
import { hasRuleError } from '../utils/trassierungCheck'
import {
  expectValidTrack, expectNodesJoin, expectTangentsContinuous, expectSwitchCantAdmissible, expectSwitchRoutesCarved,
} from './chainInvariants'

/**
 * The audit of "create element" and "connect element": the chains those forms
 * commit, made by the functions their commits call (utils/commands), checked
 * against the invariant checklist.
 */

const EPSG = 25832
const START = { easting: 500000, northing: 5600000, zone: EPSG }


// ── The commits, from the very functions the dialogs call (R4.2) ────────────

const SPEED = 100
const endOf = (el) => ({ easting: el.endNode[0], northing: el.endNode[1], zone: EPSG })
const lineTrack = (end) => buildLineTrack({ start: START, end, speed: SPEED, meta: {} })
const curvedTrack = (end, signedR) => buildCurvedLineTrack({ start: START, end, signedR, speed: SPEED, cant: 80, meta: {} })
/** A track with the elements a connect dialog appends at its end. */
const appended = (track, elements) => trackOf([...track.elements, ...elements], EPSG)
const lastOf = (track) => track.elements[track.elements.length - 1]

// ── The audit ───────────────────────────────────────────────────────────────

describe('create element', () => {
  it('LineForm commits a valid one-element track', () => {
    expectValidTrack(lineTrack(endPointStraightUtm(START, 42, 300)))
  })

  it('CurvedLineForm commits a valid one-element track, either hand', () => {
    for (const signedR of [600, -600]) {
      expectValidTrack(curvedTrack(endPointCurvedUtm(START, 42, 250, signedR), signedR))
    }
  })

  // The dialogs take the cant as a magnitude; unsigned on a left-hand curve it
  // counted against the curve, and LP.KB.02 found a deficiency of v²/R·11.8 + u.
  it('the arc stores its cant signed with the curve, either hand, and the deficiency is not exceeded', () => {
    for (const signedR of [600, -600]) {
      const [arc] = curvedTrack(endPointCurvedUtm(START, 42, 250, signedR), signedR).elements
      const [connected] = buildConnectCurved({
        start: START, bearing: 42, arcLength: 100, signedR, speed: SPEED, cant: 80,
      })
      for (const el of [arc, connected]) {
        expect(el.cant).toBe(Math.sign(signedR) * 80)
        expect(hasRuleError([el])).toBe(false)
      }
    }
  })
})

describe('connect element — straight onto a curve, over a transition', () => {
  const R = -600
  const arcTrack = curvedTrack(endPointCurvedUtm(START, 20, 250, R), R)
  const arc = lastOf(arcTrack)

  for (const type of ['clothoid', 'bloss']) {
    it(`commits a chain that joins, runs tangentially and adds up (${type})`, () => {
      const els = buildConnectStraight({
        start: endOf(arc), bearing: arc.endBearing, length: 400, speed: SPEED,
        transition: { length: 90, type, fromRadius: R },
      })
      expect(els).toHaveLength(2)
      expectValidTrack(appended(arcTrack, els))
    })
  }
})

describe('connect element — arc onto a straight, over a transition', () => {
  it('commits a chain that joins, runs tangentially and adds up', () => {
    const straightTrack = lineTrack(endPointStraightUtm(START, 20, 300))
    const straight = lastOf(straightTrack)
    const els = buildConnectCurved({
      start: endOf(straight), bearing: straight.bearing, arcLength: 220, signedR: 800, speed: SPEED, cant: 80,
      transition: { length: 80, fromRadius: null },
    })
    expectValidTrack(appended(straightTrack, els))
  })

  it('a reverse curve through the transition keeps its tangent', () => {
    const arcTrack = curvedTrack(endPointCurvedUtm(START, 20, 200, 700), 700)
    const arc = lastOf(arcTrack)
    const els = buildConnectCurved({
      start: endOf(arc), bearing: arc.endBearing, arcLength: 200, signedR: -700, speed: SPEED, cant: 80,
      transition: { length: 120, fromRadius: 700 },
    })
    expectValidTrack(appended(arcTrack, els))
  })
})

describe('the committed chain survives a reload unchanged', () => {
  it('dehydrate then hydrate gives back the same nodes, bearings and lengths', () => {
    const straightTrack = lineTrack(endPointStraightUtm(START, 20, 300))
    const straight = lastOf(straightTrack)
    const track = appended(straightTrack, buildConnectCurved({
      start: endOf(straight), bearing: straight.bearing, arcLength: 220, signedR: 800, speed: SPEED, cant: 80,
      transition: { length: 80, fromRadius: null },
    }))

    const [reloaded] = hydrateProjects(dehydrateProjects(structuredClone([{ id: 'p1', tracks: [track] }])))
    const back = reloaded.tracks[0]
    expectValidTrack(back)
    back.elements.forEach((el, i) => {
      expect(el.startNode).toEqual(track.elements[i].startNode)
      expect(el.endNode).toEqual(track.elements[i].endNode)
      expect(el.bearing).toBeCloseTo(track.elements[i].bearing, 9)
      expect(el.length).toBeCloseTo(track.elements[i].length, 9)
    })
  })
})

describe('the branch a switch dialog commits', () => {
  // SwitchOnTrackForm builds one element per piece of the branch chain. A
  // turnout laid across several elements of its host track gets several, and
  // that is the chain the invariants have to hold for. The commit is the
  // dialog's own: switchOnTrackPlacement, then buildSwitchOnTrack (R4.2).
  const form = SWITCH_TYPES.find(f => f.label === '760 – 1:14')
  const straightLen = switchStraightLength(form)

  /** A host track from START at 30°, made of `pieces` ({ length, r1, r2 }), and the turnout laid at its begin. */
  const laid = (pieces) => {
    const els = []
    let at = START, bearing = 30
    for (const { length, r1, r2 } of pieces) {
      const el = r1 !== r2
        ? transitionElement(at, bearing, length, r1, r2).element
        : r1 ? arcFrom(at, bearing, length, r1) : straightFrom(at, bearing, length)
      els.push({ ...el, speed: SPEED })
      at = { easting: el.endNode[0], northing: el.endNode[1], zone: EPSG }
      bearing = el.endBearing ?? el.bearing
    }
    const track = { ...trackOf(els, EPSG, { name: 'line.001' }, 'host') }
    const placement = switchOnTrackPlacement({ track, toeStation: 1, reversed: false, sw: form, side: 'right', straightLen })
    expect(placement.error).toBeNull()
    const commit = buildSwitchOnTrack({
      track, tracks: [track], place: placement.place, g: placement.geom, plain: placement.plain,
      sw: form, straightLen, cant: 0, cantReason: '', speed: SPEED,
      switchName: 'W 1', switchNumber: 1, name: 'branch.001', fields: { owner: 'DB', type: 'station_track' },
    })
    expect(commit.noRoom).toBeUndefined()
    const branch = commit.addTracks[commit.addTracks.length - 1]
    return { g: placement.geom, commit, elements: branch.elements }
  }

  it('on a straight stem: one element, joining the toe exactly, both routes carved', () => {
    const { g, commit, elements } = laid([{ length: 400, r1: null, r2: null }])
    expect(elements).toHaveLength(1)
    expect(elements[0].startNode).toEqual(g.portA)
    expect(elements[0].endNode).toEqual(g.portB1)
    expectNodesJoin(elements)
    expectSwitchRoutesCarved(commit.addSwitches[0], commit.addTracks)
  })

  it('across a straight running into a clothoid and on into an arc: one element per piece', () => {
    const { commit, elements } = laid([
      { length: straightLen * 0.3, r1: null, r2: null },
      { length: straightLen * 0.4, r1: null, r2: -900 },
      { length: straightLen * 0.6 + 100, r1: -900, r2: -900 },
    ])
    expect(elements.length).toBeGreaterThan(1)
    expectNodesJoin(elements)
    expectTangentsContinuous(elements, EPSG)
    expect(elements.some(el => el.elementType === 2)).toBe(true)
    commit.addTracks.forEach(t => expectValidTrack(t))
  })

  // The cant rule of AP 1.1, as the chain has to hold it: the marked elements of
  // a turnout stay inside what a switch admits, and an exception is only an
  // exception where the reason for it is on the element itself.
  describe('the cant its elements may carry', () => {
    const straight = () => laid([{ length: 400, r1: null, r2: null }]).elements
    const branch = (extra) => straight().map(el => ({ ...el, ...extra }))

    it('passes at the plain limit, and with a reason up to the exception', () => {
      expect(() => expectSwitchCantAdmissible(branch({ cant: 100 }))).not.toThrow()
      expect(() => expectSwitchCantAdmissible(branch({ cant: 120, cantException: 'Zwangspunkt' })))
        .not.toThrow()
    })

    it('fails over the plain limit without one', () => {
      expect(() => expectSwitchCantAdmissible(branch({ cant: 105 }))).toThrow()
    })

    it('fails past the exception even with one', () => {
      expect(() => expectSwitchCantAdmissible(branch({ cant: 125, cantException: 'Zwangspunkt' })))
        .toThrow()
    })

    it('leaves a line element alone — the rule is the turnout’s', () => {
      const line = straight().map(({ switchBranch: _b, switchRoute: _r, switchId: _i, ...el }) => ({ ...el, cant: 150 }))
      expect(() => expectSwitchCantAdmissible(line)).not.toThrow()
    })
  })

  it('the branch runs the form’s own length however the stem is made up', () => {
    const { g, elements } = laid([
      { length: straightLen * 0.5, r1: null, r2: null },
      { length: straightLen * 0.9 + 50, r1: null, r2: -900 },
    ])
    const total = elements.reduce((sum, el) => sum + el.length, 0)
    expect(total).toBeCloseTo(g.arcLen, 6)
  })
})

describe('track.coordinates', () => {
  it('are taken from renderCoords where an element has them, not from the fine polyline', () => {
    // The two paths that build them — rebuildCoords on a commit and
    // hydrateProjects on a reload — have to agree, or a track redraws at a
    // different density after a reload than it was committed at.
    const R = 600
    const track = curvedTrack(endPointCurvedUtm(START, 20, 250, R), R)
    expect(track.coordinates).toEqual(track.elements[0].renderCoords)
    expect(rebuildCoords(track.elements)).toEqual(track.elements[0].renderCoords)

    const [reloaded] = hydrateProjects(dehydrateProjects(structuredClone([{ id: 'p1', tracks: [track] }])))
    expect(reloaded.tracks[0].coordinates).toEqual(reloaded.tracks[0].elements[0].renderCoords)
  })
})
