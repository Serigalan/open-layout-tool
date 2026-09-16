import { describe, it, expect } from 'vitest'
import {
  recalcAbsLengths, rebuildCoords, joinTracks, reverseTrack, remapSwitches,
} from '../storage'
import {
  computeCurvedValuesUtm, computeStraightValuesUtm, arcCoordsFromRadiusUtm,
  endPointCurvedUtm, endPointStraightUtm, bearingAfterUtm,
} from './elementUtils'
import { computeClothoidUtm, transitionPointAtUtm } from './clothoidUtils'
import { utmToWgs84 } from './coordinateUtils'
import { SAGITTA_ELEMENT, SAGITTA_TRACK } from './mapConstants'
import { newSwitchFields, switchElementMark } from './switchModel'
import { splitElementAt, carveSwitchRoute } from './trackSplitUtils'
import {
  SCHEMA_VERSION, dehydrateProjects, hydrateProjects, parseProjectsPayload,
} from './persistenceUtils'
import { joinHeights, splitHeights } from './heightUtils'
import { switchParts, planSwitchDeletion, mergeableRun, mergeChain } from './switchDelete'
import {
  expectValidTrack, expectNodesJoin, expectAbsLengthsRunning, expectLengthsTrue,
  expectSwitchRoutesCarved,
} from '../test/chainInvariants'

/**
 * AP 1.2 — the delete rules. The fixtures are built the way the dialogs build
 * them (splitElementAt + carveSwitchRoute + a branch track of its own), so what
 * is tested is the real round trip: what the carve did, the delete undoes.
 */

const EPSG  = 25832
const START = { easting: 500000, northing: 5600000, zone: EPSG }
const toWgs = (utm) => utmToWgs84(utm.easting, utm.northing, utm.zone)

const ROUTE_LEN = 33.23        // the through route's length [m]
const BRANCH_R  = -300

/** One arc element, the way CurvedLineForm commits one. */
function arcElement(startUtm, bearing, length, radius, extra = {}) {
  const endUtm = endPointCurvedUtm(startUtm, bearing, length, radius)
  const v = computeCurvedValuesUtm(startUtm, endUtm, radius)
  return {
    elementType: 1,
    startNode: v.startNode, endNode: v.endNode,
    bearing: v.bearing, endBearing: v.endBearing,
    length: v.length, absLength: v.length,
    radius, cant: 20, speed: 100, ...extra,
    geometry: { type: 'LineString', coordinates: arcCoordsFromRadiusUtm(startUtm, endUtm, radius, SAGITTA_ELEMENT) },
    renderCoords: arcCoordsFromRadiusUtm(startUtm, endUtm, radius, SAGITTA_TRACK),
  }
}

/** One straight element, the way LineForm commits one. */
function straightElement(startUtm, bearing, length, extra = {}) {
  const endUtm = endPointStraightUtm(startUtm, bearing, length)
  const v = computeStraightValuesUtm(startUtm, endUtm)
  return {
    elementType: 0,
    startNode: v.startNode, endNode: v.endNode,
    bearing: v.bearing, length: v.length, absLength: v.length, speed: 100, ...extra,
    geometry: { type: 'LineString', coordinates: [toWgs(startUtm), toWgs(endUtm)] },
  }
}

const trackOf = (id, name, elements, extra = {}) => {
  const els = recalcAbsLengths(elements)
  return { id, name, epsg: EPSG, elements: els, coordinates: rebuildCoords(els), ...extra }
}

/**
 * A turnout laid into a line track, the way SwitchOnTrackForm lays one: the
 * host track parted at the toe, the through route carved into the half ahead,
 * the branch a track of its own. `tail` is how much line runs on past the
 * switch end (0 leaves the through route the whole of its half-track).
 */
function layout({ radius = 950, toe = 200, tail = 300, branchElements = null } = {}) {
  const hostBearing = 20
  const host  = trackOf('t-host', 'line.001', [arcElement(START, hostBearing, toe + ROUTE_LEN + tail, radius)])
  const toeUtm     = endPointCurvedUtm(START, hostBearing, toe, radius)
  const toeBearing = bearingAfterUtm(hostBearing, toe, radius)
  const endUtm     = endPointCurvedUtm(toeUtm, toeBearing, ROUTE_LEN, radius)

  const sw    = { ...newSwitchFields(), name: 'W 1', label: '500 - 1:12' }
  const split = splitElementAt(host, 0, toeUtm, toeBearing, new Set([host.name]))
  const carved = carveSwitchRoute(split.ahead, split.aheadEndpoint, endUtm,
    switchElementMark(sw, 'main'), ROUTE_LEN)
  expect(carved, 'the through route carves').not.toBeNull()

  const branchEls = branchElements ?? [arcElement(toeUtm, toeBearing, ROUTE_LEN, BRANCH_R)]
  const branch = trackOf('t-branch', 'branch.001', branchEls.map((el, i) => (
    i === 0 || !branchElements ? { ...el, ...switchElementMark(sw, 'branch') } : el)))

  const record = {
    ...sw, number: 1, trailing: false, speed: 100,
    portA_trackId:  split.behind.id, portA_endpoint:  split.behindEndpoint,
    portB1_trackId: branch.id,       portB1_endpoint: 'BEGIN',
    portB2_trackId: split.ahead.id,  portB2_endpoint: split.aheadEndpoint,
  }
  const tracks = [...split.tracks.map(tr => (tr.id === carved.id ? carved : tr)), branch]
  return { host, record, tracks, split, toeUtm, toeBearing, radius }
}

/** Apply a plan to a track list, the way commitSwitchDeletion applies one. */
function apply(tracks, plan) {
  const removed = new Set(plan.removeTrackIds)
  const updated = new Map(plan.updateTracks.map(t => [t.id, t]))
  return tracks.filter(t => !removed.has(t.id)).map(t => updated.get(t.id) ?? t)
}

// ── switchParts ─────────────────────────────────────────────────────────────

describe('switchParts', () => {
  it('finds the switch’s own elements per port and what lies beyond them', () => {
    const { record, tracks } = layout()
    const { byPort } = switchParts(record, tracks)

    expect(byPort.A.mine).toHaveLength(0)          // the toe is a node, not a stretch
    expect(byPort.A.beyond.length).toBeGreaterThan(0)
    expect(byPort.A.occupied).toBe(true)

    expect(byPort.B2.mine).toHaveLength(1)
    expect(byPort.B2.mine[0].switchId).toBe(record.switchId)
    expect(byPort.B2.mine[0].switchRoute).toBe('main')
    expect(byPort.B2.occupied).toBe(true)

    expect(byPort.B1.mine).toHaveLength(1)
    expect(byPort.B1.beyond).toHaveLength(0)
    expect(byPort.B1.occupied).toBe(false)         // the branch is the switch itself

    // The same invariant AP 1.3 holds the four dialogs to, here on the carve.
    expectSwitchRoutesCarved(record, tracks)
  })

  it('does not count another switch’s elements as this one’s', () => {
    const { record, tracks } = layout()
    const foreign = tracks.map(t => ({
      ...t, elements: t.elements.map(el => (el.switchId ? { ...el, switchId: 'other' } : el)),
    }))
    const { byPort } = switchParts(record, foreign)
    expect(byPort.B1.mine).toHaveLength(0)
    expect(byPort.B2.mine).toHaveLength(0)
  })
})

// ── the rule table ──────────────────────────────────────────────────────────

describe('which route survives', () => {
  it('A and B2 occupied: the through route is a line and stays', () => {
    const { record, tracks } = layout()
    expect(planSwitchDeletion(record, tracks).reason).toBe('through')
  })

  it('A and B1 occupied, B2 not: the branch is the line and stays', () => {
    // The switch sits at the very end of its host track (nothing past the
    // switch end), and the branch runs on past its own arc.
    const { record, tracks, toeUtm, toeBearing } = layout({ tail: 0 })
    const branchEnd = endPointCurvedUtm(toeUtm, toeBearing, ROUTE_LEN, BRANCH_R)
    const grown = tracks.map(t => (t.id !== 't-branch' ? t : trackOf(t.id, t.name, [
      ...t.elements,
      arcElement(branchEnd, bearingAfterUtm(toeBearing, ROUTE_LEN, BRANCH_R), 150, BRANCH_R),
    ])))
    expect(planSwitchDeletion(record, grown).reason).toBe('branch')
  })

  it('only one port occupied: nothing of the switch is a line', () => {
    const { record, tracks } = layout({ tail: 0 })   // B2 is the route alone, B1 the branch alone
    const plan = planSwitchDeletion(record, tracks)
    expect(plan.reason).toBe('all')
    expect(new Set(plan.removeTrackIds)).toEqual(new Set(['t-branch', record.portB2_trackId]))
  })

  it('B1 and B2 occupied but not A: still nothing to keep', () => {
    const { record, tracks, toeUtm, toeBearing } = layout()
    const branchEnd = endPointCurvedUtm(toeUtm, toeBearing, ROUTE_LEN, BRANCH_R)
    const grown = tracks.map(t => (t.id !== 't-branch' ? t : trackOf(t.id, t.name, [
      ...t.elements,
      arcElement(branchEnd, bearingAfterUtm(toeBearing, ROUTE_LEN, BRANCH_R), 150, BRANCH_R),
    ])))
    // Nothing behind the toe.
    const noA = grown.map(t => (t.id === record.portA_trackId ? { ...t, elements: [] } : t))
    const plan = planSwitchDeletion(record, noA)
    expect(plan.reason).toBe('all')
    expect(plan.joined).toBe(false)
  })

  it('all three occupied: the through route stays, only the branch goes', () => {
    const { record, tracks, toeUtm, toeBearing } = layout()
    const branchEnd = endPointCurvedUtm(toeUtm, toeBearing, ROUTE_LEN, BRANCH_R)
    const grown = tracks.map(t => (t.id !== 't-branch' ? t : trackOf(t.id, t.name, [
      ...t.elements,
      arcElement(branchEnd, bearingAfterUtm(toeBearing, ROUTE_LEN, BRANCH_R), 150, BRANCH_R),
    ])))
    const plan = planSwitchDeletion(record, grown)
    expect(plan.reason).toBe('through')
    // The branch keeps what ran on past it — as its own, now unconnected track.
    expect(plan.removeTrackIds).not.toContain('t-branch')
    const branch = plan.updateTracks.find(t => t.id === 't-branch')
    expect(branch.elements).toHaveLength(1)
    expect(branch.elements[0].switchId).toBeUndefined()
  })
})

// ── the round trip ──────────────────────────────────────────────────────────

describe('deleting the switch undoes the carve', () => {
  it('gives back the one element the host track was', () => {
    const { host, record, tracks } = layout()
    const plan = planSwitchDeletion(record, tracks)
    expect(plan.reason).toBe('through')

    const after = apply(tracks, plan)
    expect(after).toHaveLength(1)
    const [joined] = after
    expect(joined.elements).toHaveLength(1)
    expect(plan.mergedElements).toBe(3)
    expect(plan.mergedInto).toBe(1)
    expect(plan.joined).toBe(true)

    const [was] = host.elements
    const [now] = joined.elements
    expect(now.startNode[0]).toBeCloseTo(was.startNode[0], 6)
    expect(now.startNode[1]).toBeCloseTo(was.startNode[1], 6)
    expect(now.endNode[0]).toBeCloseTo(was.endNode[0], 6)
    expect(now.endNode[1]).toBeCloseTo(was.endNode[1], 6)
    expect(now.length).toBeCloseTo(was.length, 6)
    expect(now.radius).toBe(was.radius)
    expect(now.cant).toBe(was.cant)
    expect(now.speed).toBe(was.speed)
    expect(now.switchBranch).toBeUndefined()
    expectValidTrack(joined)
  })

  it('joins the halves whichever way round the toe meets them', () => {
    // The same layout with both ports meeting the toe at their BEGIN: one of the
    // two has to be turned round, and the line behind the toe is not the one.
    const { host, record, tracks } = layout()
    const behindId = record.portA_trackId
    const behind   = tracks.find(t => t.id === behindId)
    const turned   = reverseTrack(behind)
    const flipped  = { ...record, portA_endpoint: 'BEGIN' }
    const plan = planSwitchDeletion(flipped,
      tracks.map(t => (t.id === behindId ? turned : t)))
    const [joined] = apply(tracks.map(t => (t.id === behindId ? turned : t)), plan)
    expect(joined.elements).toHaveLength(1)
    expect(joined.elements[0].length).toBeCloseTo(host.elements[0].length, 6)
    expectValidTrack(joined)
  })

  it('joins them when both meet the toe with their end', () => {
    // The through route's track turned round: now both halves end at the toe,
    // so the switch's own piece is the one that gets reversed.
    const { host, record, tracks } = layout()
    const turned = tracks.map(t => (t.id === record.portB2_trackId ? reverseTrack(t) : t))
    const flipped = { ...record, portB2_endpoint: 'END' }
    const plan = planSwitchDeletion(flipped, turned)
    expect(plan.reason).toBe('through')
    const [joined] = apply(turned, plan)
    expect(joined.elements).toHaveLength(1)
    expect(joined.elements[0].length).toBeCloseTo(host.elements[0].length, 6)
    expect(joined.elements[0].bearing).toBeCloseTo(host.elements[0].bearing, 9)
    expectValidTrack(joined)
  })

  it('keeps a kink the merge may not swallow', () => {
    // A host track of two straights that meet at an angle: the carve parts the
    // second one, the delete gives back two elements, not one.
    const bend  = endPointStraightUtm(START, 20, 250)
    const host  = trackOf('t-host', 'line.001', [
      straightElement(START, 20, 250),
      straightElement(bend, 24, 250),
    ])
    const sw     = { ...newSwitchFields(), name: 'W 2', label: '500 - 1:12' }
    const toeUtm = endPointStraightUtm(bend, 24, 100)
    const split  = splitElementAt(host, 1, toeUtm, 24, new Set([host.name]))
    const carved = carveSwitchRoute(split.ahead, split.aheadEndpoint,
      endPointStraightUtm(toeUtm, 24, ROUTE_LEN), switchElementMark(sw, 'main'), ROUTE_LEN)
    const branch = trackOf('t-branch', 'branch.001',
      [{ ...arcElement(toeUtm, 24, ROUTE_LEN, BRANCH_R), ...switchElementMark(sw, 'branch') }])
    const tracks = [...split.tracks.map(tr => (tr.id === carved.id ? carved : tr)), branch]
    const record = {
      ...sw, portA_trackId: split.behind.id, portA_endpoint: split.behindEndpoint,
      portB1_trackId: branch.id, portB1_endpoint: 'BEGIN',
      portB2_trackId: split.ahead.id, portB2_endpoint: split.aheadEndpoint,
    }

    const plan = planSwitchDeletion(record, tracks)
    const [joined] = apply(tracks, plan)
    expect(joined.elements).toHaveLength(2)
    expect(joined.elements[0].length).toBeCloseTo(250, 6)
    expect(joined.elements[1].length).toBeCloseTo(250, 6)
    // Not expectValidTrack: the kink is deliberate, so tangent continuity is
    // not this chain's invariant — everything else about it is.
    expectNodesJoin(joined.elements)
    expectAbsLengthsRunning(joined.elements)
    expectLengthsTrue(joined.elements)
  })

  it('gives back the clothoid the carve cut in two', () => {
    const L = 90, R = -800
    const cl = computeClothoidUtm(START, 20, L, null, R, SAGITTA_ELEMENT)
    const transition = {
      elementType: 2, transitionType: 'clothoid', r1: null, r2: R,
      startNode: [START.easting, START.northing],
      endNode: [cl.endUtm.easting, cl.endUtm.northing],
      bearing: 20, endBearing: cl.endBearing, length: L, absLength: L, speed: 100,
      geometry: { type: 'LineString', coordinates: cl.coords },
      renderCoords: computeClothoidUtm(START, 20, L, null, R, SAGITTA_TRACK).coords,
    }
    const host = trackOf('t-host', 'line.001', [transition])

    // Cut it where a switch toe would: at the station, on the curve's own point
    // there — the two pieces are clothoids of the same parameter.
    const toe = transitionPointAtUtm(START, 20, L, null, R, 'clothoid', 40)
    const parted = carveSwitchRoute(host, 'BEGIN', { ...toe, station: 40 },
      { switchBranch: true, switchRoute: 'main', switchId: 'x' }, 40)
    expect(parted.elements).toHaveLength(2)

    const plain = parted.elements.map(({
      switchBranch: _b, switchRoute: _r, switchId: _i, ...rest
    }) => rest)
    const merged = mergeChain(plain, EPSG)
    expect(merged.mergedFrom).toBe(2)
    expect(merged.elements).toHaveLength(1)
    expect(merged.elements[0].length).toBeCloseTo(L, 6)
    expect(merged.elements[0].r1).toBe(null)
    expect(merged.elements[0].r2).toBe(R)
    expect(merged.elements[0].endNode[0]).toBeCloseTo(transition.endNode[0], 6)
    expect(merged.elements[0].endNode[1]).toBeCloseTo(transition.endNode[1], 6)
    expectValidTrack({ ...host, elements: merged.elements })
  })

  it('leaves a whole clothoid alone — there is nothing to merge it with', () => {
    const L = 90, R = -800
    const cl = computeClothoidUtm(START, 20, L, null, R, SAGITTA_ELEMENT)
    const el = {
      elementType: 2, transitionType: 'clothoid', r1: null, r2: R,
      startNode: [START.easting, START.northing],
      endNode: [cl.endUtm.easting, cl.endUtm.northing],
      bearing: 20, endBearing: cl.endBearing, length: L, absLength: L, speed: 100,
      geometry: { type: 'LineString', coordinates: cl.coords },
    }
    expect(mergeChain([el], EPSG).mergedFrom).toBe(0)
  })
})

// ── mergeableRun ────────────────────────────────────────────────────────────

describe('mergeableRun', () => {
  const pieces = () => {
    const parted = carveSwitchRoute(
      trackOf('t', 'l.001', [arcElement(START, 20, 400, 950)]), 'BEGIN',
      endPointCurvedUtm(START, 20, 120, 950),
      { switchBranch: true, switchId: 'x', switchRoute: 'main' }, 120)
    return parted.elements.map(({ switchBranch: _b, switchRoute: _r, switchId: _i, ...rest }) => rest)
  }

  it('merges two pieces of one arc', () => {
    expect(mergeableRun(pieces(), EPSG)).toBe(true)
  })

  it('refuses a differing cant, speed or radius', () => {
    const [a, b] = pieces()
    expect(mergeableRun([a, { ...b, cant: 40 }], EPSG)).toBe(false)
    expect(mergeableRun([a, { ...b, speed: 120 }], EPSG)).toBe(false)
    expect(mergeableRun([a, { ...b, radius: 951 }], EPSG)).toBe(false)
  })

  it('refuses an element that is some switch’s own geometry', () => {
    const [a, b] = pieces()
    expect(mergeableRun([a, { ...b, switchBranch: true, switchId: 'y' }], EPSG)).toBe(false)
  })

  it('refuses two arcs that only look alike — they do not meet', () => {
    const [a] = pieces()
    const far = arcElement(endPointCurvedUtm(START, 20, 300, 950), 99, 100, 950)
    expect(mergeableRun([a, far], EPSG)).toBe(false)
  })

  it('refuses a run that would sweep past half a turn', () => {
    const R = 40
    const a = arcElement(START, 0, Math.PI * R * 0.6, R)
    const b = arcElement({ easting: a.endNode[0], northing: a.endNode[1], zone: EPSG },
      a.endBearing, Math.PI * R * 0.6, R)
    expect(mergeableRun([a, b], EPSG)).toBe(false)
  })

  it('refuses two Bloss curves — neither is a piece of the other', () => {
    const bloss = { elementType: 2, transitionType: 'bloss', r1: null, r2: -800, length: 50,
      startNode: [0, 0], endNode: [0, 50], bearing: 0, speed: 100 }
    expect(mergeableRun([bloss, { ...bloss, startNode: [0, 50], endNode: [0, 100] }], EPSG)).toBe(false)
  })
})

// ── the primitives ──────────────────────────────────────────────────────────

describe('joinTracks', () => {
  it('is splitElementAt’s inverse for the elements and the heights', () => {
    const host = trackOf('t-host', 'line.001', [arcElement(START, 20, 400, 950)], {
      heights: [{ station: 0, z: 100 }, { station: 200, z: 104, rv: 3000 }, { station: 400, z: 110 }],
    })
    const split = splitElementAt(host, 0, endPointCurvedUtm(START, 20, 150, 950), 20, new Set([host.name]))
    const [a, b] = split.tracks
    const joined = joinTracks(a, b)
    expect(joined.id).toBe(a.id)
    expect(joined.elements).toHaveLength(2)
    expect(joined.heights.map(p => p.station)).toEqual([0, 150, 200, 400])
    expect(joined.heights.find(p => p.station === 200).rv).toBe(3000)
    expectValidTrack(joined)
  })

  it('reverseTrack turns a track round and back', () => {
    const host = trackOf('t', 'l.001', [arcElement(START, 20, 400, 950)], {
      heights: [{ station: 0, z: 100 }, { station: 400, z: 110 }],
    })
    const there = reverseTrack(host)
    const back  = reverseTrack(there)
    expect(back.elements[0].startNode).toEqual(host.elements[0].startNode)
    expect(back.elements[0].bearing).toBeCloseTo(host.elements[0].bearing, 9)
    expect(back.heights).toEqual(host.heights)
  })
})

describe('joinHeights', () => {
  it('undoes splitHeights', () => {
    const heights = [{ station: 0, z: 100 }, { station: 120, z: 103 }, { station: 300, z: 108 }]
    const [a, b] = splitHeights(heights, 120)
    expect(joinHeights(a, b, 120)).toEqual(heights)
  })

  it('keeps the joint once when the cut fell between two points', () => {
    const heights = [{ station: 0, z: 100 }, { station: 300, z: 106 }]
    const [a, b] = splitHeights(heights, 100)
    const joined = joinHeights(a, b, 100)
    expect(joined.map(p => p.station)).toEqual([0, 100, 300])
    expect(joined[1].z).toBeCloseTo(102, 9)
  })

  it('is undefined where neither half had any', () => {
    expect(joinHeights(undefined, undefined, 100)).toBeUndefined()
  })
})

// ── a second switch on the same line ────────────────────────────────────────

describe('a switch further along the same track', () => {
  /**
   * Two turnouts laid into one line, the way the dialog lays them one after the
   * other: the first parts the track at its toe, the second parts the half
   * ahead again. Deleting the first has to hand the second its new track.
   */
  const twoSwitches = () => {
    const radius = 950, bearing = 20
    const host = trackOf('t-host', 'line.001', [arcElement(START, bearing, 800, radius)])

    const mk = (track, elIdx, station, name) => {
      const sw      = { ...newSwitchFields(), name, label: '500 - 1:12' }
      const toeUtm  = endPointCurvedUtm(START, bearing, station, radius)
      const toeBear = bearingAfterUtm(bearing, station, radius)
      const split   = splitElementAt(track, elIdx, toeUtm, toeBear, new Set([track.name]))
      const carved  = carveSwitchRoute(split.ahead, split.aheadEndpoint,
        endPointCurvedUtm(toeUtm, toeBear, ROUTE_LEN, radius),
        switchElementMark(sw, 'main'), ROUTE_LEN)
      expect(carved).not.toBeNull()
      const branch = trackOf(`t-branch-${name}`, `branch.${name}`,
        [{ ...arcElement(toeUtm, toeBear, ROUTE_LEN, BRANCH_R), ...switchElementMark(sw, 'branch') }])
      return { sw, split, carved, branch, toeUtm, toeBear }
    }

    const one = mk(host, 0, 200, 'W1')
    // The half ahead of W1 is [through route, rest]; W2 goes into the rest.
    const two = mk(one.carved, 1, 400, 'W2')

    const rec1 = {
      ...one.sw, portA_trackId: one.split.behind.id, portA_endpoint: one.split.behindEndpoint,
      portB1_trackId: one.branch.id, portB1_endpoint: 'BEGIN',
      // W1's through route stayed on the half of W1's ahead track that holds its
      // BEGIN — which the second split has just made a track of its own.
      portB2_trackId: one.split.aheadEndpoint === 'BEGIN' ? two.split.tracks[0].id : two.split.tracks[1].id,
      portB2_endpoint: one.split.aheadEndpoint,
    }
    const rec2 = {
      ...two.sw, portA_trackId: two.split.behind.id, portA_endpoint: two.split.behindEndpoint,
      portB1_trackId: two.branch.id, portB1_endpoint: 'BEGIN',
      portB2_trackId: two.split.ahead.id, portB2_endpoint: two.split.aheadEndpoint,
    }
    const tracks = [
      one.split.behind,
      ...two.split.tracks.map(tr => (tr.id === two.carved.id ? two.carved : tr)),
      one.branch, two.branch,
    ]
    return { host, rec1, rec2, tracks }
  }

  it('keeps its ports when the first switch is deleted under it', () => {
    const { rec1, rec2, tracks } = twoSwitches()
    const plan = planSwitchDeletion(rec1, tracks)
    expect(plan.reason).toBe('through')

    const after     = apply(tracks, plan)
    // The join really did swallow a track W2 was standing on.
    expect(plan.remap.length).toBeGreaterThan(0)
    expect(plan.remap.map(r => r.oldId)).toContain(rec2.portA_trackId)
    const [moved] = remapSwitches([rec2], plan.remap)
    expect(moved.portA_trackId).not.toBe(rec2.portA_trackId)
    expect(after.find(t => t.id === moved.portA_trackId)).toBeDefined()
    expect(after.find(t => t.id === moved.portB1_trackId)).toBeDefined()
    expect(after.find(t => t.id === moved.portB2_trackId)).toBeDefined()

    // W2 still finds its own elements on its own ports.
    const { byPort } = switchParts(moved, after)
    expect(byPort.B1.mine).toHaveLength(1)
    expect(byPort.B2.mine).toHaveLength(1)
    expect(byPort.A.occupied).toBe(true)
    after.forEach(track => { if (track.elements.length) expectValidTrack(track) })
  })

  it('and the result is a project that loads again', () => {
    const { rec1, rec2, tracks } = twoSwitches()
    const plan   = planSwitchDeletion(rec1, tracks)
    const after  = apply(tracks, plan)
    const project = {
      id: 'p1', name: 'p',
      tracks: after,
      switches: remapSwitches([rec2], plan.remap),
    }
    const payload = { version: SCHEMA_VERSION, projects: dehydrateProjects(structuredClone([project])) }
    const { projects } = parseProjectsPayload(structuredClone(payload))
    const [reloaded] = hydrateProjects(projects)

    expect(reloaded.switches).toHaveLength(1)
    expect(reloaded.switches[0].fillCoords?.length).toBeGreaterThan(0)
    reloaded.tracks.forEach(track => { if (track.elements.length) expectValidTrack(track) })
  })
})
