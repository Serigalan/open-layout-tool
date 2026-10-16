import { describe, it, expect } from 'vitest'
import { trackOf } from './tracks'
import { straightFrom } from '../geometry/elementFactory'
import { SWITCH_TYPES } from '../switch/catalogue'
import { connectionAnchor } from '../switch/connectToTrack'
import { buildSwitchConnect, switchConnectOutcome, switchConnectSolutions } from './connectSwitch'
import { connectRemedies } from './connectRemedies'
import { expectValidTrack } from '../../test/chainInvariants'

const EPSG = 25832
const O = { easting: 500000, northing: 5600000, zone: EPSG }
const at = (n) => ({ easting: n[0], northing: n[1], zone: EPSG })
const off = (dE, dN) => ({ easting: O.easting + dE, northing: O.northing + dN, zone: EPSG })
const FORM = SWITCH_TYPES.find(f => f.label === '760 – 1:14')

/** A fast track coming in at 12° to a straight host: refitted, its end jumps in curvature. */
function setup(v = 120) {
  const host = trackOf([straightFrom(O, 90, 600, { speed: 100 })], EPSG, { name: 'host' }, 'host')
  const a = straightFrom(off(560, 40), 258, 60, { speed: v })
  const target = trackOf([a, straightFrom(at(a.endNode), 258, 40, { speed: v })], EPSG, { name: 't' }, 't')
  const { anchor } = connectionAnchor(target, 'END', { tracks: [host, target] })
  const base = switchConnectSolutions({ track: host, clickStation: 250, anchor, sw: FORM }).preferred
  const outcomeFor = ({ lead, speedLimit }) => {
    const s = lead > 0
      ? switchConnectSolutions({ track: host, clickStation: base.x, anchor, sw: FORM, lead, only: base, reach: lead + 60 }).solutions[0]
      : base
    return s && switchConnectOutcome({ track: host, target, anchor, solution: s, speed: 80, speedLimit })
  }
  return { host, target, anchor, base, outcomeFor }
}

describe('suggestions where the rules reject the refitted element', () => {
  it('none where nothing is wrong', () => {
    const { anchor, outcomeFor } = setup(80)
    const outcome = outcomeFor({ lead: 0, speedLimit: null })
    expect(outcome.ruleError).toBe(false)
    expect(connectRemedies({ anchor, current: { lead: 0, speedLimit: null }, outcome, outcomeFor })).toEqual([])
  })

  it('lower the speed, or put a transition before the arc — each without an error after', { timeout: 30000 }, () => {
    const { anchor, outcomeFor } = setup(120)
    const outcome = outcomeFor({ lead: 0, speedLimit: null })
    expect(outcome.ruleError).toBe(true)
    const list = connectRemedies({ anchor, current: { lead: 0, speedLimit: null }, outcome, outcomeFor })
    const speed = list.find(r => r.kind === 'speed')
    expect(speed.speed).toBeLessThan(120)
    expect(speed.outcome.ruleError).toBe(false)
    const transition = list.find(r => r.kind === 'transition')
    expect(transition.lead).toBeGreaterThan(0)
    expect(transition.outcome.ruleError).toBe(false)
    expect(transition.outcome.lead.elementType).toBe(2)
  })

  it('what is taken over is what is committed', { timeout: 30000 }, () => {
    const { host, target, anchor, base, outcomeFor } = setup(120)
    const outcome = outcomeFor({ lead: 0, speedLimit: null })
    const r = connectRemedies({ anchor, current: { lead: 0, speedLimit: null }, outcome, outcomeFor }).find(x => x.kind === 'speed')
    const commit = buildSwitchConnect({
      track: host, target, anchor, solution: base, tracks: [host, target], sw: FORM, cant: 0, cantReason: '',
      speed: 80, switchName: 'W 1', switchNumber: 1, speedLimit: r.speedLimit,
    })
    const joined = commit.addTracks.find(tr => tr.id === 't')
    expectValidTrack(joined)
    expect(joined.elements.slice(0, 2).every(el => el.speed === r.speed)).toBe(true)
  })
})
