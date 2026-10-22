import { describe, it, expect } from 'vitest'
import { rebuildCoords } from '../utils/track/trackModel'
import { buildConnectCurved, buildConnectStraight, buildCurvedLineTrack, buildLineTrack, cantAtTrackEnd, trackOf } from '../utils/commands/tracks'
import { buildSwitchOnTrack, switchOnTrackPlacement } from '../utils/commands/switches'
import { arcFrom, straightFrom, transitionElement } from '../utils/geometry/elementFactory'
import { endPointStraightUtm, endPointCurvedUtm } from '../utils/geometry/elementUtils'
import { cantEnds } from '../utils/geometry/clothoidUtils'
import {
  ALL_SWITCH_TYPES, SWITCH_TYPES, hasCompoundBranch, switchBranchSections, switchStraightLength, switchVariants,
} from '../utils/switch/catalogue'
import { dehydrateProjects, hydrateProjects } from '../utils/project/persistenceUtils'
import { hasRuleError } from '../utils/rules/trassierungCheck'
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

describe('connect element — the cant proposed for the arc (Entscheidung 315)', () => {
  const R = 700
  const arc = lastOf(curvedTrack(endPointCurvedUtm(START, 20, 200, R), R))

  it('without a transition the one the track ends with, signed by the raised rail', () => {
    expect(cantAtTrackEnd(arc)).toBe(80)
    expect(cantAtTrackEnd(lastOf(curvedTrack(endPointCurvedUtm(START, 20, 200, -R), -R)))).toBe(-80)
    expect(cantAtTrackEnd(lastOf(lineTrack(endPointStraightUtm(START, 20, 300))))).toBe(0)
  })

  it('none after a transition that states no cant at its end — that one ramps into the arc', () => {
    const t = transitionElement(START, 20, 60, null, 500, { speed: SPEED }).element
    expect(cantAtTrackEnd(t)).toBeNull()
    expect(cantAtTrackEnd({ ...t, cantEnd: 40 })).toBe(40)
  })

  it('the arc is written with the cant the dialog holds, even one that leans against the curve', () => {
    const at = (signedR, cant) => buildConnectCurved({
      start: endOf(arc), bearing: arc.endBearing, arcLength: 150, signedR, speed: SPEED, cant,
    })[0].cant
    expect(at(500, 80)).toBe(80)
    expect(at(-500, 80)).toBe(-80)
    // A reverse curve straight after a canted one: the cant taken over leans against it.
    expect(at(-500, -80)).toBe(80)
  })
})

describe('the committed chain survives a reload unchanged', () => {
  it('dehydrate then hydrate gives back the same nodes, bearings and lengths, to 1 µm and 10⁻⁹ °', () => {
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
      el.startNode.forEach((v, k) => expect(v).toBeCloseTo(track.elements[i].startNode[k], 6))
      el.endNode.forEach((v, k) => expect(v).toBeCloseTo(track.elements[i].endNode[k], 6))
      expect(el.bearing).toBeCloseTo(track.elements[i].bearing, 9)
      expect(el.length).toBeCloseTo(track.elements[i].length, 6)
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

  // The cant beside the branch (Entscheidung 367): the host's, piece by piece,
  // and at the switch end exactly the through route's.
  describe('the cant along its branch', () => {
    const lay = (els, toeStation) => {
      const track = { ...trackOf(els, EPSG, { name: 'line.001' }, 'host') }
      const placement = switchOnTrackPlacement({ track, toeStation, reversed: false, sw: form, side: 'right', straightLen })
      expect(placement.error).toBeNull()
      const commit = buildSwitchOnTrack({
        track, tracks: [track], place: placement.place, g: placement.geom, plain: placement.plain,
        sw: form, straightLen, cant: 0, cantReason: '', speed: SPEED,
        switchName: 'W 1', switchNumber: 1, name: 'branch.001', fields: { owner: 'DB', type: 'station_track' },
      })
      const branch = commit.addTracks[commit.addTracks.length - 1].elements
      const main = commit.addTracks.flatMap(tr => tr.elements.map((el, i) => ({ el, i, tr }))).filter(x => x.el.switchRoute === 'main')
      const we = main[main.length - 1]
      return { branch, atWe: cantEnds(we.tr.elements, we.i).end }
    }
    const left = -900
    const ramp = (s) => 60 * s / 80
    const clothoid = () => ({ ...transitionElement(START, 30, 80, null, left).element, speed: SPEED, cantStart: 0, cantEnd: -60 })

    it('meets the through route\'s cant at the switch end inside a ramp', () => {
      const cl = clothoid()
      const { branch, atWe } = lay([cl, { ...arcFrom(endOf(cl), cl.endBearing, 200, left), speed: SPEED, cant: -60 }], 10)
      expect(atWe).toBeCloseTo(-ramp(10 + straightLen), 9)
      expect(branch[branch.length - 1].cantEnd).toBeCloseTo(atWe, 9)
      expect(branch[0].cantStart).toBeCloseTo(-ramp(10), 9)
    })

    it('ramps on an arc piece beside an arc whose cant ramps', () => {
      const arc = { ...arcFrom(START, 30, 200, left), speed: SPEED, cantStart: -20, cantEnd: -60 }
      const { branch, atWe } = lay([arc], 50)
      const cantAt = (s) => -20 - 40 * s / 200
      expect(branch).toHaveLength(1)
      expect(branch[0].elementType).toBe(1)
      expect(branch[0].cantStart).toBeCloseTo(cantAt(50), 9)
      expect(branch[0].cantEnd).toBeCloseTo(cantAt(50 + straightLen), 9)
      expect(branch[0].cantEnd).toBeCloseTo(atWe, 9)
    })
  })

  it('laid backwards into a clothoid that runs out into a straight at WE: the form\'s own radius there (Entscheidung 370)', () => {
    // The SBSS case: the toe 1 form-length into a clothoid from straight, WE on
    // the joint with the straight before it.
    const sw = SWITCH_TYPES.find(f => f.label === '500 – 1:12')
    const T = switchStraightLength(sw)
    const st = { ...straightFrom(START, 30, 100), speed: SPEED }
    const cl = { ...transitionElement(endOf(st), 30, 58, null, 500).element, speed: SPEED }
    const arc = { ...arcFrom(endOf(cl), cl.endBearing, 100, 500), speed: SPEED }
    const track = { ...trackOf([st, cl, arc], EPSG, { name: 'line.001' }, 'host') }
    for (const side of ['left', 'right']) {
      const placement = switchOnTrackPlacement({ track, toeStation: 100 + T, reversed: true, sw, side, straightLen: T })
      expect(placement.error).toBeNull()
      const branch = placement.geom.branchSegments
      expect(Math.abs(branch[branch.length - 1].r2)).toBeCloseTo(500, 9)
    }
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

// The clothoid and compound-curve turnouts (Paket WD, decision 344): a branch of
// several curved sections, starting on a radius at the toe, laid by the same
// commit as every other form.
describe('the branch of a clothoid turnout', () => {
  const forms = ALL_SWITCH_TYPES.filter(hasCompoundBranch)

  const laid = (form, pieces) => {
    const straightLen = switchStraightLength(form)
    const els = []
    let at = START, bearing = 30
    for (const { length, r } of pieces) {
      const el = r ? arcFrom(at, bearing, length, r) : straightFrom(at, bearing, length)
      els.push({ ...el, speed: SPEED })
      at = { easting: el.endNode[0], northing: el.endNode[1], zone: EPSG }
      bearing = el.endBearing ?? el.bearing
    }
    const track = { ...trackOf(els, EPSG, { name: 'line.001' }, 'host') }
    const placement = switchOnTrackPlacement({ track, toeStation: 1, reversed: false, sw: form, side: 'right', straightLen })
    expect(placement.error, form.label).toBeNull()
    const commit = buildSwitchOnTrack({
      track, tracks: [track], place: placement.place, g: placement.geom, plain: placement.plain,
      sw: form, straightLen, cant: 0, cantReason: '', speed: SPEED,
      switchName: 'W 1', switchNumber: 1, name: 'branch.001', fields: { owner: 'DB', type: 'station_track' },
    })
    const branch = commit.addTracks[commit.addTracks.length - 1]
    return { g: placement.geom, commit, elements: branch.elements }
  }

  it('are the nine of the table', () => {
    expect(forms).toHaveLength(9)
  })

  it('on a straight stem: one element per section, tangential, ending where the table puts WE', () => {
    for (const form of forms) {
      const { g, commit, elements } = laid(form, [{ length: 400, r: null }])
      expect(elements, form.label).toHaveLength(switchBranchSections(form).length)
      expect(elements[0].startNode).toEqual(g.portA)
      expect(elements.at(-1).endNode).toEqual(g.portB1)
      expectNodesJoin(elements)
      expectTangentsContinuous(elements, EPSG)
      expectSwitchRoutesCarved(commit.addSwitches[0], commit.addTracks)
      // The branch end lies the table's s from the through route.
      const [ax, ay] = g.portA, [bx, by] = g.portB2, [ex, ey] = g.portB1
      const off = Math.abs((bx - ax) * (ey - ay) - (by - ay) * (ex - ax)) / Math.hypot(bx - ax, by - ay)
      expect(off, form.label).toBeCloseTo(switchVariants(form)[0].masse.s, 2)
    }
  })

  it('bent into an arc: the curvatures add, and the chain stays valid', () => {
    for (const form of forms) {
      const { commit, elements } = laid(form, [{ length: switchStraightLength(form) + 100, r: 4000 }])
      expectNodesJoin(elements)
      expectTangentsContinuous(elements, EPSG)
      commit.addTracks.forEach(tr => expectValidTrack(tr))
    }
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
