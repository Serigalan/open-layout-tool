import { describe, it, expect } from 'vitest'
import { optimizeTrack, parseTrackForOptimization } from './optimizeUtils'
import { MAX_SWITCH_CANT } from './mapConstants'
import golden from '../test/fixtures/track_optimized.json'

// One curve group out of the golden track: straight – clothoid – arc – clothoid
// – straight, the shape the JS parser accepts. Transitions on both sides, so the
// run is free to raise the cant — which is what the switch limit has to stop.
const EPSG = golden[0].epsg
const ARC = 2

function track({ mark = null, cant = 60 } = {}) {
  return {
    epsg: EPSG,
    elements: golden[0].elements.slice(0, 5).map((el, i) => ({
      ...el,
      ...(i === ARC ? { cant } : {}),
      ...(i === mark ? { switchBranch: true } : {}),
    })),
  }
}

const PARAMS = { corridor: 0.5, uf: 130 }
const firstGroup = (tr) => parseTrackForOptimization(tr).groups[0]

describe('a group that runs through a turnout', () => {
  it('is recognised by the arc it re-cants', () => {
    expect(firstGroup(track({ mark: ARC })).onSwitch).toBe(true)
  })

  it('is recognised by a transition of the curve part too', () => {
    expect(firstGroup(track({ mark: 1 })).onSwitch).toBe(true)
  })

  it('is not, where nothing in it belongs to a switch', () => {
    expect(firstGroup(track()).onSwitch).toBe(false)
  })

  // The bounding straights are shared with the neighbouring groups and carry no
  // cant of their own — a turnout on one must not hold both neighbours down.
  it('is not, where only a bounding straight carries the mark', () => {
    expect(firstGroup(track({ mark: 0 })).onSwitch).toBe(false)
    expect(firstGroup(track({ mark: 4 })).onSwitch).toBe(false)
  })
})

describe('the cant an optimization run may propose', () => {
  it('rises past 100 mm on a line curve — the limit is the switch’s, not everyone’s', () => {
    const { results } = optimizeTrack(track(), PARAMS)
    expect(results[0].changed).toBe(true)
    expect(results[0].uNeu).toBeGreaterThan(MAX_SWITCH_CANT)
  })

  it('stops at 100 mm where the group runs through a turnout', () => {
    const { results } = optimizeTrack(track({ mark: ARC }), PARAMS)
    expect(results[0].changed).toBe(true)
    expect(results[0].uNeu).toBe(MAX_SWITCH_CANT)
  })

  // The 120 mm exception is a designer's written decision on one element; an
  // automatic run has nothing to write, so it never reaches for it.
  it('never reaches for the exception on its own', () => {
    for (const uf of [90, 110, 130, 150]) {
      const { results } = optimizeTrack(track({ mark: ARC }), { ...PARAMS, uf })
      expect(results[0].uNeu).toBeLessThanOrEqual(MAX_SWITCH_CANT)
    }
  })

  // A turnout already canted over its limit is a defect the element table
  // reports; the run neither raises it nor quietly trims it away.
  it('leaves a cant that already stands over the limit exactly where it is', () => {
    const { results } = optimizeTrack(track({ mark: ARC, cant: 120 }), PARAMS)
    expect(results[0].uAlt).toBe(120)
    expect(results[0].uNeu).toBe(120)
  })
})

describe('the deficiency a group is scored at', () => {
  it('is the switch’s where it runs through one, so the same geometry scores lower', () => {
    const onLine   = optimizeTrack(track(), PARAMS).results[0]
    const onSwitch = optimizeTrack(track({ mark: ARC }), PARAMS).results[0]
    expect(onSwitch.rAlt).toBe(onLine.rAlt)
    expect(onSwitch.uAlt).toBe(onLine.uAlt)
    expect(onSwitch.vAlt).toBeLessThan(onLine.vAlt)
  })

  it('never exceeds the caller’s own uf — the switch limit only ever lowers it', () => {
    const tight = optimizeTrack(track({ mark: ARC }), { ...PARAMS, uf: 80 }).results[0]
    const loose = optimizeTrack(track({ mark: ARC }), { ...PARAMS, uf: 150 }).results[0]
    expect(tight.vAlt).toBeLessThan(loose.vAlt)
  })
})
