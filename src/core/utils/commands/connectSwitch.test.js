import { describe, it, expect } from 'vitest'
import { trackOf } from './tracks'
import { straightFrom, arcFrom } from '../elementFactory'
import { SWITCH_TYPES } from '../switch/catalogue'
import { trackLength } from '../heightUtils'
import { connectionAnchor } from '../connectToTrack'
import { buildSwitchConnect, switchConnectOutcome, switchConnectSolutions } from './connectSwitch'
import { expectValidTrack, expectSwitchRoutesCarved, expectNodesJoin } from '../../test/chainInvariants'
import { resolveEndBearing } from '../elementUtils'

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
    expect(record.portB1_trackId).toBe('target')
    expect(record.portB1_endpoint).toBe('END')
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
    expect(commit.addSwitches[0].portB1_endpoint).toBe('BEGIN')
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
