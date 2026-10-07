import { describe, it, expect } from 'vitest'
import {
  AXIS_SPACING, axisPoints, buildReconnect, reconnectFromAnswer, reconnectPick, reconnectRange, reconnectRequest,
  replacedSpan, stationMap, stretchDefaults,
} from './reconnect'
import { reconstructElements } from '../elementReconstruct'
import { recalcAbsLengths, rebuildCoords } from '../trackModel'
import { expectValidTrack } from '../../test/chainInvariants'
import fixture from '../../test/fixtures/reconnect_answers.json'

// The search is the service's (olt_optimizer/reconnect.py); what is tested
// here is the app's half — the stretch, the old axis, the request and the
// track written back. Track and answers come from
// tools/optimizer/tests/reconnect_fixture.py: straight 50, straight 200, a
// curve R 800 with 60 m transitions, straight 200, straight 50.

const EPSG = 25832
const makeTrack = (elements, extra = {}) => {
  const els = recalcAbsLengths(reconstructElements(elements.map(el => ({ ...el })), EPSG))
  return { id: 't', name: 't', epsg: EPSG, elements: els, coordinates: rebuildCoords(els), ...extra }
}
const lengthOf = (els) => els.reduce((s, el) => s + el.length, 0)
const track = makeTrack(fixture.elements, {
  heights: [{ station: 0, z: 100 }, { station: 300, z: 103, rv: 5000 }, { station: 920, z: 101 }],
})
const withSwitch = makeTrack(fixture.elements.map((el, i) => (i === 1 ? { ...el, switchId: 'w1' } : el)))
const near = (a, b, tol) => Math.abs(a - b) <= tol

describe('the stretch', () => {
  it('takes every element between the two clicks, in either order, and the transitions beside it', () => {
    const r = reconnectRange(track, 3, 3)
    expect(r).toMatchObject({ from: 2, to: 4, dep: { idx: 1, fixed: false }, arr: { idx: 5, fixed: false }, widened: [2, 4] })
    expect(reconnectRange(track, 4, 2)).toMatchObject({ from: 2, to: 4, widened: [] })
    expect(replacedSpan(r)).toEqual({ first: 1, last: 5 })
  })

  it('keeps a neighbour of a switch as it is', () => {
    const r = reconnectRange(withSwitch, 2, 4)
    expect(r.dep).toEqual({ idx: 1, fixed: true })
    expect(replacedSpan(r)).toEqual({ first: 2, last: 5 })
  })

  it('refuses a switch inside it and a track end beside it', () => {
    expect(reconnectRange(withSwitch, 1, 3)).toEqual({ error: 'reconnect_error_switch' })
    expect(reconnectRange(track, 0, 3)).toEqual({ error: 'reconnect_error_open_end' })
    expect(reconnectRange(track, 3, 6)).toEqual({ error: 'reconnect_error_open_end' })
    expect(reconnectRange(track, 3, 9)).toEqual({ error: 'reconnect_error_pick' })
  })

  it('starts with the fastest element chosen and the form its transitions had', () => {
    const fast = makeTrack(fixture.elements.map((el, i) => (i === 3 ? { ...el, speed: 120 } : el)))
    expect(stretchDefaults(fast, reconnectRange(fast, 2, 4))).toEqual({ speed: 120, transitionType: 'clothoid' })
    const bloss = makeTrack(fixture.elements.map(el => (el.elementType === 2 ? { ...el, transitionType: 'bloss' } : el)))
    expect(stretchDefaults(bloss, reconnectRange(bloss, 3, 3)).transitionType).toBe('bloss')
  })
})

describe('the old axis', () => {
  const { request } = fixture.cases.curve
  const pts = axisPoints(track, 1, 5)

  it('has a point every centimetre, from the first element\'s start to the last one\'s end', () => {
    const len = lengthOf(track.elements.slice(1, 6))
    expect(Math.abs(pts.de.length - len / AXIS_SPACING)).toBeLessThan(6)
    const [e1, n1] = pts.coords[pts.coords.length - 1]
    expect(e1).toBeCloseTo(track.elements[5].endNode[0], 6)
    expect(n1).toBeCloseTo(track.elements[5].endNode[1], 6)
    for (let i = 1; i < pts.coords.length; i += 997) {
      const d = Math.hypot(pts.coords[i][0] - pts.coords[i - 1][0], pts.coords[i][1] - pts.coords[i - 1][1])
      expect(d).toBeLessThanOrEqual(AXIS_SPACING + 1e-9)
    }
  })

  it('lies where the service\'s own sampling of the same elements does, to the millimetre', () => {
    expect(pts.e0).toBeCloseTo(request.points.e0, 6)
    expect(Math.abs(pts.de.length - request.points.count)).toBeLessThan(6)
    // Both are a point every centimetre along the same line, not necessarily
    // the same ones: each of the service's lies within half a step of one here.
    for (const [i, de, dn] of request.points.sample) {
      let best = Infinity
      for (let k = Math.max(0, i - 50); k < Math.min(pts.de.length, i + 50); k++) {
        best = Math.min(best, Math.hypot(pts.de[k] - de, pts.dn[k] - dn))
      }
      expect(best).toBeLessThanOrEqual(6)
    }
  })
})

describe('the request', () => {
  it('hands over the two neighbours as the service took them', () => {
    const { request } = fixture.cases.curve
    const r = reconnectRange(track, 2, 4)
    const picks = [reconnectPick(track, r.dep.idx, 'end', r.dep.fixed), reconnectPick(track, r.arr.idx, 'start', r.arr.fixed)]
    const req = reconnectRequest(picks, axisPoints(track, 1, 5), { tolerance: 0.1, speed: 100, transitionType: 'clothoid', radius: 0 })
    for (const side of ['dep', 'arr']) {
      expect(req[side].joinAt).toBe(request[side].joinAt)
      expect(req[side].radius ?? null).toBe(request[side].radius ?? null)
      expect(req[side].bearing).toBeCloseTo(request[side].bearing, 6)
      for (const k of ['start', 'end']) {
        expect(req[side][k][0]).toBeCloseTo(request[side][k][0], 5)
        expect(req[side][k][1]).toBeCloseTo(request[side][k][1], 5)
      }
    }
    expect(req).toMatchObject({ tolerance: 0.1, speed: 100, radius: 0, transition: 'clothoid' })
    expect(req.lMin).toBeGreaterThan(0)
  })

  it('hands over a kept neighbour as the point it ends in', () => {
    const p = reconnectPick(withSwitch, 1, 'end', true)
    expect(p.length).toBe(0)
    expect(p.startUtm).toEqual(p.endUtm)
    expect(p.startUtm.easting).toBeCloseTo(withSwitch.elements[1].endNode[0], 6)
  })
})

describe('the track written back', () => {
  const answerOf = (name, t) => {
    const r = reconnectRange(t, 2, 4)
    const picks = [reconnectPick(t, r.dep.idx, 'end', r.dep.fixed), reconnectPick(t, r.arr.idx, 'start', r.arr.fixed)]
    return { r, read: reconnectFromAnswer(fixture.cases[name].answer, picks) }
  }

  it('replaces the stretch and the re-shaped neighbours by the chain, in one valid track', () => {
    const { r, read } = answerOf('curve', track)
    const sol = read.solutions[0]
    expect(sol.reconnect.within).toBe(true)
    const { track: out } = buildReconnect({ track, range: r, solution: sol, speed: 100 })
    expectValidTrack(out)
    expect(out.id).toBe('t')
    expect(out.elements[0]).toMatchObject({ length: track.elements[0].length, speed: 80 })
    expect(out.elements.at(-1).length).toBeCloseTo(track.elements.at(-1).length, 9)
    const arc = out.elements.find(el => el.elementType === 1)
    expect(arc.speed).toBe(100)
    expect(Math.abs(arc.cant)).toBe(sol.reconnect.cant)
    expect(Math.abs(arc.radius)).toBe(sol.reconnect.radius)
    // The neighbours re-shaped keep their own speed.
    expect(out.elements[1]).toMatchObject({ elementType: 0, speed: 80 })
    // Starts and ends where the old one did.
    expect(out.elements[0].startNode).toEqual(track.elements[0].startNode)
    const [e, n] = out.elements.at(-1).endNode
    expect(e).toBeCloseTo(track.elements.at(-1).endNode[0], 6)
    expect(n).toBeCloseTo(track.elements.at(-1).endNode[1], 6)
  })

  it('re-stations the gradient: in the stretch in proportion, behind it by the difference', () => {
    const { r, read } = answerOf('curve', track)
    const { track: out, map } = buildReconnect({ track, range: r, solution: read.solutions[0], speed: 100 })
    const oldLen = lengthOf(track.elements), newLen = lengthOf(out.elements)
    expect(out.heights.map(p => p.z)).toEqual([100, 103, 101])
    expect(out.heights[0].station).toBe(0)
    expect(out.heights[2].station).toBeCloseTo(920 + newLen - oldLen, 9)
    expect(out.heights[1].rv).toBe(5000)
    expect(near(out.heights[1].station, map(300), 1e-9)).toBe(true)
    expect(Math.abs(newLen - oldLen)).toBeLessThan(1)
  })

  it('leaves a kept neighbour as it is and builds on from its end', () => {
    const { r, read } = answerOf('fixedDeparture', withSwitch)
    const { track: out } = buildReconnect({ track: withSwitch, range: r, solution: read.solutions[0], speed: 100 })
    expectValidTrack(out)
    expect(out.elements[1]).toEqual(withSwitch.elements[1])
    expect(out.elements.filter(el => el.switchId).length).toBe(1)
  })

  it('writes nothing without a solution', () => {
    const r = reconnectRange(track, 2, 4)
    expect(buildReconnect({ track, range: r, solution: null, speed: 100 })).toBe(null)
    expect(reconnectFromAnswer({ error: 'reconnect_error_same_circle' }, [])).toEqual({ error: 'reconnect_error_same_circle' })
  })
})

describe('stationMap', () => {
  it('keeps what lies before, stretches what lies in it and shifts what lies behind', () => {
    const map = stationMap(100, 200, 210)
    expect(map(50)).toBe(50)
    expect(map(200)).toBeCloseTo(205, 9)
    expect(map(400)).toBeCloseTo(410, 9)
  })
})
