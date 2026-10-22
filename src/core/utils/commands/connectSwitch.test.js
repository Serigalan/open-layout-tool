import { describe, it, expect } from 'vitest'
import { trackOf } from './tracks'
import { straightFrom, arcFrom } from '../geometry/elementFactory'
import { SWITCH_TYPES } from '../switch/catalogue'
import { trackLength } from '../track/heightUtils'
import { connectionAnchor, endChainDefault, endChainOpen } from '../switch/connectToTrack'
import { buildSwitchConnect, switchConnectChainSolutions, switchConnectOutcome, switchConnectSolutions } from './connectSwitch'
import { expectValidTrack, expectSwitchRoutesCarved, expectNodesJoin } from '../../test/chainInvariants'
import { resolveEndBearing, reverseElement } from '../geometry/elementUtils'

const EPSG = 25832
const O = { easting: 500000, northing: 5600000, zone: EPSG }
const FORM = SWITCH_TYPES.find(f => f.label === '760 – 1:14')
const at = (node) => ({ easting: node[0], northing: node[1], zone: EPSG })
const off = (dE, dN) => ({ easting: O.easting + dE, northing: O.northing + dN, zone: EPSG })

/** The host: 600 m of straight running east, in three pieces. */
function host() {
  const a = straightFrom(O, 90, 200, { speed: 100 })
  const b = straightFrom(at(a.endNode), 90, 200, { speed: 100 })
  const c = straightFrom(at(b.endNode), 90, 200, { speed: 100 })
  return trackOf([a, b, c], EPSG, { name: 'host.001' }, 'host')
}

/**
 * The track to connect: north of the host, coming from the east and running
 * west-south-west towards it, its open end at its END — `last` its last element.
 */
function target(last = (p, b) => straightFrom(p, b, 40, { speed: 80 })) {
  const a = straightFrom(off(560, 22), 266, 60, { speed: 80 })
  return trackOf([a, last(at(a.endNode), 266)], EPSG, { name: 'target.001' }, 'target')
}

function solve(tgt, endpoint = 'END', clickStation = 250) {
  const track = host()
  const { anchor } = connectionAnchor(tgt, endpoint, { tracks: [track, tgt] })
  return { track, anchor, ...switchConnectSolutions({ track, clickStation, anchor, sw: FORM }) }
}

describe('a turnout connected to the end of another track', () => {
  it('opens towards the track, to its side, and slides along the host', () => {
    const { preferred } = solve(target())
    expect(preferred).toMatchObject({ reversed: false, side: 'left' })
    expect(preferred.x).toBeGreaterThan(0)
    expect(preferred.x).toBeLessThan(600)
  })

  it('refits the straight at the end into an arc that meets the branch end tangentially', () => {
    const tgt = target()
    const { track, anchor, preferred } = solve(tgt)
    const out = switchConnectOutcome({ track, target: tgt, anchor, solution: preferred, speed: 80 })
    expectValidTrack(out.refitted)
    expect(out.element.elementType).toBe(1)
    expect(out.element.speed).toBe(80)
    const end = out.element.endNode
    expect(Math.hypot(end[0] - preferred.at.port.easting, end[1] - preferred.at.port.northing)).toBeLessThan(1e-6)
    const arriving = resolveEndBearing(out.element, EPSG)
    expect(Math.abs(((arriving - preferred.at.bearingIn + 540) % 360) - 180)).toBeLessThan(1e-5)
  })

  it('commits one track: the branch joined into the connected one, which keeps its id and name', () => {
    const tgt = target()
    const { track, anchor, preferred } = solve(tgt)
    const commit = buildSwitchConnect({
      track, target: tgt, anchor, solution: preferred, tracks: [track, tgt], sw: FORM,
      cant: 0, cantReason: '', speed: 80, switchName: 'W 1', switchNumber: 1,
    })
    expect(commit.removeTrackIds).toEqual(['host', 'target'])
    const joined = commit.addTracks.find(tr => tr.id === 'target')
    expect(joined.name).toBe('target.001')
    expectValidTrack(joined)
    expectNodesJoin(joined.elements)
    const record = commit.addSwitches[0]
    expect(record.ports?.B1?.trackId).toBe('target')
    expect(record.ports?.B1?.endpoint).toBe('END')
    commit.addTracks.forEach(expectValidTrack)
    expectSwitchRoutesCarved(record, commit.addTracks)
    // Only the host's halves and the joined track: no track of its own for the branch.
    expect(commit.addTracks).toHaveLength(3)
    expect(commit.restation).toEqual([])
  })

  it('at the connected track\'s start, its stations move by the branch and the change of length', () => {
    // The same track, digitised the other way: its open end is its BEGIN.
    const base = target()
    const flipped = trackOf([...base.elements].reverse().map(el => ({
      ...straightFrom(at(el.endNode), (el.bearing + 180) % 360, el.length, { speed: 80 }),
    })), EPSG, { name: 'target.001' }, 'target')
    const tgt = { ...flipped, heights: [{ station: 0, z: 100 }, { station: 100, z: 101 }] }
    const { track, anchor, preferred } = solve(tgt, 'BEGIN')
    const commit = buildSwitchConnect({
      track, target: tgt, anchor, solution: preferred, tracks: [track, tgt], sw: FORM,
      cant: 0, cantReason: '', speed: 80, switchName: 'W 1', switchNumber: 1,
    })
    const joined = commit.addTracks.find(tr => tr.id === 'target')
    expectValidTrack(joined)
    expect(commit.addSwitches[0].ports?.B1?.endpoint).toBe('BEGIN')
    const [{ shift }] = commit.restation
    expect(trackLength(joined)).toBeCloseTo(trackLength(tgt) + shift, 6)
    expect(joined.heights.at(-1).station).toBeCloseTo(100 + shift, 6)
  })

  it('a curved connecting element stays an arc', () => {
    const tgt = target((p, b) => arcFrom(p, b, 40, -1500, { speed: 80 }))
    const { track, anchor, preferred } = solve(tgt)
    const out = switchConnectOutcome({ track, target: tgt, anchor, solution: preferred, speed: 80 })
    expectValidTrack(out.refitted)
    expect(out.element.elementType).toBe(1)
  })

  it('finds nothing where the end points away from the host', () => {
    const a = straightFrom(off(300, 30), 0, 60, { speed: 80 })
    const away = trackOf([a], EPSG, { name: 'away' }, 'away')
    expect(solve(away).preferred).toBeNull()
  })
})

// ── two elements laid anew (Entscheidung 377) ───────────────────────────────

/** A track coming in at 10° to the host: a straight, then an arc of R 500 turning onto the branch. */
function chainTarget() {
  const a = straightFrom(off(560, 40), 256, 60, { speed: 80 })
  return trackOf([a, arcFrom(at(a.endNode), 256, 40, 500, { speed: 80, cant: 20 })], EPSG, { name: 'target.001' }, 'target')
}

describe('a turnout connected with the last two elements of the track laid anew', () => {
  const chainSolve = (tgt, mids, { endpoint = 'END', station = null, clickStation = 250 } = {}) => {
    const track = host()
    const { anchor } = connectionAnchor(tgt, endpoint, { tracks: [track, tgt], count: 2 })
    return { track, anchor, ...switchConnectChainSolutions({ track, clickStation, anchor, sw: FORM, mids, station }) }
  }

  it('the default spec keeps types and radii: both lengths change and the turnout slides', () => {
    const tgt = chainTarget()
    const track = host()
    const { anchor } = connectionAnchor(tgt, 'END', { tracks: [track, tgt], count: 2 })
    const mids = endChainDefault(anchor)
    expect(mids).toEqual([{ type: 'straight', length: null, radius: null }, { type: 'arc', length: null, radius: 500, side: 1 }])
    expect(endChainOpen(mids)).toBe(2)
    const { preferred } = switchConnectChainSolutions({ track, clickStation: 250, anchor, sw: FORM, mids })
    expect(preferred).toMatchObject({ reversed: false, side: 'left' })
    const out = switchConnectOutcome({ track, target: tgt, anchor, solution: preferred, speed: 80 })
    expectValidTrack(out.refitted)
    expect(out.refitted.elements).toHaveLength(2)
    expect(out.judged).toEqual([0, 1])
    const [a, b] = out.refitted.elements
    expect(a.elementType).toBe(0)
    expect(b.radius).toBe(500)
    expect(b.cant).toBe(20)
    expect(a.startNode).toEqual(tgt.elements[0].startNode)
    const end = b.endNode
    expect(Math.hypot(end[0] - preferred.at.port.easting, end[1] - preferred.at.port.northing)).toBeLessThan(1e-6)
    const arriving = resolveEndBearing(b, EPSG)
    expect(Math.abs(((arriving - preferred.at.bearingIn + 540) % 360) - 180)).toBeLessThan(1e-5)
  })

  it('with the turnout given, the arc’s radius is sought', () => {
    const tgt = chainTarget()
    const mids = [{ type: 'straight', length: null, radius: null }, { type: 'arc', length: null, radius: null }]
    const first = chainSolve(tgt, endChainDefault(connectionAnchor(tgt, 'END', { tracks: [tgt], count: 2 }).anchor))
    const station = first.preferred.x + 15
    const { preferred, track, anchor } = chainSolve(tgt, mids, { station })
    expect(preferred.x).toBe(station)
    const out = switchConnectOutcome({ track, target: tgt, anchor, solution: preferred, speed: 80 })
    expectValidTrack(out.refitted)
    expect(out.refitted.elements[1].radius).toBeLessThan(450)
  })

  it('with a radius given the turnout slides, and a chosen type is laid', () => {
    const tgt = target()
    const mids = [{ type: 'straight', length: null, radius: null }, { type: 'arc', length: null, radius: 2000, side: -1 }]
    const { anchor, preferred, track } = chainSolve(tgt, mids)
    expect(preferred).not.toBeNull()
    const out = switchConnectOutcome({ track, target: tgt, anchor, solution: preferred, speed: 80 })
    expectValidTrack(out.refitted)
    expect(out.refitted.elements[1].radius).toBe(-2000)
  })

  it('a transition at the end runs into the branch\'s curvature', () => {
    const tgt = target((p, b) => arcFrom(p, b, 40, -1500, { speed: 80 }))
    const mids = [{ type: 'arc', length: null, radius: null }, { type: 'transition', length: 30, radius: null }]
    const { anchor, preferred, track } = chainSolve(tgt, mids)
    expect(preferred).not.toBeNull()
    const out = switchConnectOutcome({ track, target: tgt, anchor, solution: preferred, speed: 80 })
    expectValidTrack(out.refitted)
    const [arc, tr] = out.refitted.elements
    expect(tr.elementType).toBe(2)
    expect(tr.length).toBeCloseTo(30, 6)
    expect(tr.r1).toBeCloseTo(arc.radius, 3)
    expect(tr.cant).toBeUndefined()
  })

  it('at the track\'s start the spec stays in the track\'s order and direction', () => {
    const base = chainTarget()
    const flipped = trackOf([...base.elements].reverse().map(el => reverseElement(el)), EPSG, { name: 'target.001' }, 'target')
    const track = host()
    const { anchor } = connectionAnchor(flipped, 'BEGIN', { tracks: [track, flipped], count: 2 })
    const mids = endChainDefault(anchor)
    expect(mids.map(m => m.type)).toEqual(['arc', 'straight'])
    expect(mids[0]).toMatchObject({ radius: 500, side: -1 })
    const { preferred } = switchConnectChainSolutions({ track, clickStation: 250, anchor, sw: FORM, mids })
    expect(preferred).not.toBeNull()
    const commit = buildSwitchConnect({
      track, target: flipped, anchor, solution: preferred, tracks: [track, flipped], sw: FORM,
      cant: 0, cantReason: '', speed: 80, switchName: 'W 1', switchNumber: 1,
    })
    const joined = commit.addTracks.find(tr => tr.id === 'target')
    expectValidTrack(joined)
    expectNodesJoin(joined.elements)
    expect(joined.elements.at(-1).endNode).toEqual(flipped.elements.at(-1).endNode)
  })

  it('refuses a spec with the wrong number of open values', () => {
    const mids = [{ type: 'straight', length: null, radius: null }, { type: 'arc', length: null, radius: null }]
    expect(chainSolve(target(), mids).error).toBe('connect_chain_unknowns')
  })

  it('needs two elements at the end', () => {
    const a = straightFrom(off(560, 22), 266, 60, { speed: 80 })
    const one = trackOf([a], EPSG, { name: 'one' }, 'one')
    expect(connectionAnchor(one, 'END', { tracks: [one], count: 2 }).error).toBe('connect_end_too_few')
  })
})
