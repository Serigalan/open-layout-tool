import { describe, it, expect } from 'vitest'
import { trackOf } from './tracks'
import { straightFrom } from '../elementFactory'
import { CROSSING_TYPES } from '../switch/catalogue'
import { connectionAnchor } from '../connectToTrack'
import { crossingOnTrackPlacement, crossingOnTrackPort } from './switches'
import { buildCrossingConnect, crossAngleOf, crossingConnectOutcome, crossingConnectSolutions } from './connectCrossing'
import { crossingEndDistance } from '../switch/crossing'
import { expectValidTrack, expectNodesJoin } from '../../test/chainInvariants'
import { resolveEndBearing } from '../elementUtils'
import { portTrack, portEnd } from '../switchModel'

const EPSG = 25832
const O = { easting: 500000, northing: 5600000, zone: EPSG }
const at = (node) => ({ easting: node[0], northing: node[1], zone: EPSG })
const off = (dE, dN) => ({ easting: O.easting + dE, northing: O.northing + dN, zone: EPSG })
const FORM = CROSSING_TYPES.find(f => f.label === 'Kr 1:9')
const SLIP = CROSSING_TYPES.find(f => f.label === 'DKW 1:9 – 190')

function host() {
  const a = straightFrom(O, 90, 300, { speed: 80 })
  const b = straightFrom(at(a.endNode), 90, 300, { speed: 80 })
  return trackOf([a, b], EPSG, { name: 'host.001' }, 'host')
}

/** North of the host, coming from the east at about the crossing angle, its open end at its END. */
function target() {
  const a = straightFrom(off(520, 48), 262, 60, { speed: 60 })
  return trackOf([a, straightFrom(at(a.endNode), 262, 40, { speed: 60 })], EPSG, { name: 'target.001', owner: 'DB' }, 'target')
}

function solve(form, tgt = target()) {
  const track = host()
  const { anchor } = connectionAnchor(tgt, 'END', { tracks: [track, tgt] })
  return { track, tgt, anchor, ...crossingConnectSolutions({ track, clickStation: 300, anchor, form }) }
}

describe('the end of a crossing\'s cross route', () => {
  it('is where the full geometry puts it', () => {
    const track = host()
    for (const side of ['right', 'left']) {
      const args = { track, endDist: crossingEndDistance(FORM), form: FORM, crossAngle: crossAngleOf(FORM, side), pointStation: 250 }
      const g = crossingOnTrackPlacement(args).geom
      for (const port of ['B', 'D']) {
        const end = crossingOnTrackPort(args, port)
        const want = g[`port${port}_utm`]
        expect(Math.hypot(end.utm.easting - want.easting, end.utm.northing - want.northing)).toBeLessThan(1e-9)
      }
    }
  })
})

describe('a crossing connected to the end of another track', () => {
  it('turns its cross route towards the track and connects the end on its side', () => {
    const { preferred } = solve(FORM)
    expect(preferred).toMatchObject({ port: 'D', crossSide: 'left' })
  })

  it('refits the element so that it meets the leg tangentially', () => {
    const { tgt, anchor, preferred } = solve(FORM)
    const out = crossingConnectOutcome({ target: tgt, anchor, solution: preferred })
    expectValidTrack(out.refitted)
    const arriving = resolveEndBearing(out.element, EPSG)
    expect(Math.abs(((arriving - preferred.at.bearingIn + 540) % 360) - 180)).toBeLessThan(1e-5)
  })

  it('commits the leg joined into the track, the other leg a track of its own', () => {
    for (const form of [FORM, SLIP]) {
      const { track, tgt, anchor, preferred } = solve(form)
      const commit = buildCrossingConnect({
        track, target: tgt, anchor, solution: preferred, tracks: [track, tgt], form, switchName: 'Kr 1', switchNumber: 1,
      })
      const record = commit.addSwitches[0]
      expect(portTrack(record, preferred.port)).toBe('target')
      expect(portEnd(record, preferred.port)).toBe('END')
      const joined = commit.addTracks.find(tr => tr.id === 'target')
      expectValidTrack(joined)
      expectNodesJoin(joined.elements)
      commit.addTracks.forEach(expectValidTrack)
      // Every port names a track that exists.
      for (const p of ['A', 'B', 'C', 'D']) {
        expect(commit.addTracks.some(tr => tr.id === portTrack(record, p))).toBe(true)
      }
      const other = commit.addTracks.find(tr => tr.id === portTrack(record, preferred.port === 'B' ? 'D' : 'B'))
      expect(other.owner).toBe('DB')
      expect(other.name).toBe('target.002')
    }
  })
})
