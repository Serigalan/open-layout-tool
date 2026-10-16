import { describe, it, expect } from 'vitest'
import { solveSplice } from './solveSplice'
import { buildSplice, spliceFromAnswer, splicePick, spliceRequest } from '../commands/splice'
import { straightElement, straightFrom, arcFrom, transitionElement } from '../geometry/elementFactory'
import { bearingAfterUtm, endPointCurvedUtm, endPointStraightUtm } from '../geometry/elementUtils'
import { rebuildCoords } from '../track/trackModel'
import { expectValidTrack } from '../../test/chainInvariants'
import serviceAnswers from './serviceAnswers.json'
import coreAnswers from '../../test/fixtures/splice_answers.json'

// The splice is computed in the browser (decision 294), ported from the
// optimizer service's splice.py. It is held against what the service answers
// for the very same requests — random geometries asked in every way a user
// can ask them, with and without transitions, at the Regellänge — written by
// tools/optimizer/tests/splice_answers_fixture.py; the merged track it leads
// to is checked like any other.

const NODE_TOL = 1e-6   // m

const sideOf = (l) => ({ mode: l.mode, length: l.length, regular: l.regular ?? null, minimum: l.minimum ?? null })
const closeTo = (got, want, digits) => (want == null ? expect(got ?? null).toBeNull() : expect(got).toBeCloseTo(want, digits))

function expectSameSides(got, want) {
  expect(got.length).toBe(want.length)
  want.forEach((w, k) => {
    const g = sideOf(got[k])
    expect(g.mode).toBe(w.mode)
    closeTo(g.length, w.length, 6)
    closeTo(g.regular, w.regular, 6)
    closeTo(g.minimum, w.minimum, 6)
  })
}

function expectSameAnswer(local, service) {
  if (service.error) {
    expect(local.error).toBe(service.error)
    for (const [k, tol] of [['rMax', 1], ['rMin', 1], ['lMax', 0.1]]) {
      if (service.params[k] == null) expect(local.params[k]).toBeUndefined()
      else expect(Math.abs(local.params[k] - service.params[k])).toBeLessThanOrEqual(tol + 1e-9)
    }
    if (service.lengths) expectSameSides(local.lengths, service.lengths)
    return
  }
  expect(local.error).toBeUndefined()
  expect(local.solutions.map(s => [s.ends.join(), s.alternative, s.arcJoin ?? null]))
    .toEqual(service.solutions.map(s => [s.ends.join(), s.alternative, s.arcJoin ?? null]))
  if (service.requested) expect(local.requested?.error).toBe(service.requested.error)
  else expect(local.requested).toBeUndefined()
  service.solutions.forEach((want, i) => {
    const got = local.solutions[i]
    expect(got).toMatchObject({ depPick: want.depPick, reverseDep: want.reverseDep, reverseArr: want.reverseArr })
    expect(got.rebuilt).toBeCloseTo(want.rebuilt, 4)
    expect(got.findings.map(f => [f.at, f.id, f.severity])).toEqual(want.findings)
    expect([got.worst, got.judged]).toEqual([want.worst, want.judged])
    if (want.lengths) expectSameSides(got.lengths, want.lengths)
    expect(got.elements.map(el => [el.elementType, el.role])).toEqual(want.elements.map(el => [el.elementType, el.role]))
    got.elements.forEach((el, k) => {
      const w = want.elements[k]
      for (const node of ['startNode', 'endNode']) {
        expect(Math.hypot(el[node][0] - w[node][0], el[node][1] - w[node][1])).toBeLessThan(NODE_TOL)
      }
      for (const r of ['radius', 'r1', 'r2']) if (w[r] != null) expect(el[r]).toBeCloseTo(w[r], 6)
      if (w.length != null) expect(el.length).toBeCloseTo(w.length, 6)
    })
  })
}

describe('the splice finds what the service finds', () => {
  it.each(serviceAnswers.map(c => [c.name, c]))('%s', (_name, c) => {
    expectSameAnswer(solveSplice(c.request), c.answer)
  })

  it.each(Object.keys(coreAnswers))('the app\'s case %s', (name) => {
    const { request, answer } = coreAnswers[name]
    const local = solveSplice(request)
    expect(local.solutions.map(s => [s.ends.join(), s.alternative, s.arcJoin ?? null, s.worst]))
      .toEqual(answer.solutions.map(s => [s.ends.join(), s.alternative, s.arcJoin ?? null, s.worst]))
    answer.solutions.forEach((want, i) => {
      const got = local.solutions[i]
      expect(got.elements.map(el => el.elementType)).toEqual(want.elements.map(el => el.elementType))
      got.elements.forEach((el, k) => {
        expect(Math.hypot(el.endNode[0] - want.elements[k].endNode[0], el.endNode[1] - want.elements[k].endNode[1])).toBeLessThan(NODE_TOL)
      })
      expect(got.findings).toEqual(want.findings)
      expectSameSides(got.lengths, want.lengths)
    })
  })

  it('answers in the service\'s form', () => {
    const [sol] = solveSplice(coreAnswers.corner.request).solutions
    expect(sol).toMatchObject({
      lengths: [{ mode: 'fixed', length: 0 }, { mode: 'fixed', length: 0 }], findings: [], worst: 'ok', judged: false, alternative: false,
    })
  })

  it('refuses parallel straights and two straights without a radius', () => {
    const dep = { start: [0, 0], end: [100, 0], bearing: 90, radius: null }
    expect(solveSplice({ dep, arr: { start: [200, 10], end: [300, 10], bearing: 90, radius: null }, radius: 300 }).error)
      .toBe('splice_error_parallel')
    expect(solveSplice({ dep, arr: { start: [400, 100], end: [400, 700], bearing: 0, radius: null }, radius: 0 }).error)
      .toBe('splice_error_parallel')
  })
})

describe('the merged track', () => {
  const EPSG = 25832
  const P = (x, y) => ({ easting: 500000 + x, northing: 5700000 + y, zone: EPSG })
  const at = ([e, n]) => ({ easting: e, northing: n, zone: EPSG })
  const track = (id, elements) => {
    const els = elements
    return { id, name: id, epsg: EPSG, elements: els, coordinates: rebuildCoords(els) }
  }
  const merge = (tracks, picks, settings) => {
    const sol = spliceFromAnswer(solveSplice(spliceRequest(picks[0], picks[1], settings)), picks).solutions[0]
    return buildSplice({ tracks, solution: sol, speed: settings.speed, cant: settings.cant, newId: () => 'm' }).addTracks[0]
  }

  it('turns one straight into the other with the arc asked for', () => {
    const a = track('a', [straightElement(P(0, 0), P(200, 0))])
    const b = track('b', [straightElement(P(400, 100), P(400, 700))])
    const merged = merge([a, b], [splicePick(b, 0), splicePick(a, 0)], { radius: 300, speed: 60, cant: 40 })
    expectValidTrack(merged)
    expect(merged.name).toBe('a')
    expect(merged.elements.map(e => e.elementType)).toEqual([0, 1, 0])
    expect(merged.elements[1]).toMatchObject({ radius: -300, cant: -40, speed: 60 })
    expect(merged.elements[1].length).toBeCloseTo(300 * Math.PI / 2, 6)
  })

  // Ideal chains built forwards and cut apart: what lies between the picks is
  // what the splice has to find again.
  const after = (p, bearing, length, r) => (r ? endPointCurvedUtm(p, bearing, length, r) : endPointStraightUtm(p, bearing, length))

  it('joins an arc and a straight by a new arc, and two arcs by a straight', () => {
    const arcA = arcFrom(P(0, 0), 90, 150, 600)
    const a = track('a', [straightElement(P(-100, 0), P(0, 0)), arcA])
    // On from the arc: R 400 the other way for 100 m, then a straight, 20 m on.
    const b1 = bearingAfterUtm(arcA.endBearing, 100, -400)
    const s0 = after(after(at(arcA.endNode), arcA.endBearing, 100, -400), b1, 20)
    const b = track('b', [straightFrom(s0, b1, 200)])
    const one = merge([a, b], [splicePick(b, 0), splicePick(a, 1)], { radius: 400, speed: 80, cant: 0 })
    expectValidTrack(one)
    expect(one.elements.map(e => e.elementType)).toEqual([0, 1, 1, 0])
    expect(one.elements[2].radius).toBeCloseTo(-400, 6)
    expect(one.elements[2].length).toBeCloseTo(100, 4)

    // On from the arc: a straight of 80 m, then R 900 to the left, 10 m on.
    const c0 = after(after(at(arcA.endNode), arcA.endBearing, 80), arcA.endBearing, 10, -900)
    const c = track('c', [arcFrom(c0, bearingAfterUtm(arcA.endBearing, 10, -900), 120, -900)])
    const two = merge([a, c], [splicePick(a, 1), splicePick(c, 0)], { radius: 0, speed: 80, cant: 0 })
    expectValidTrack(two)
    expect(two.elements.map(e => e.elementType)).toEqual([0, 1, 0, 1])
    expect(two.elements[2].length).toBeCloseTo(80, 4)
  })

  it('keeps a transition at the end of its track and builds on from it', () => {
    const { element: tr, endUtm, endBearing } = transitionElement(P(100, 0), 90, 60, null, 500)
    const t = track('t', [straightElement(P(0, 0), P(100, 0)), tr])
    // On from the transition: 50 m more of R 500, R 800 the other way, a straight 30 m on.
    const on = after(endUtm, endBearing, 50, 500)
    const b1 = bearingAfterUtm(endBearing, 50, 500)
    const b2 = bearingAfterUtm(b1, 150, -800)
    const off = track('off', [straightFrom(after(after(on, b1, 150, -800), b2, 30), b2, 200)])
    const merged = merge([t, off], [splicePick(t, 1), splicePick(off, 0)], { radius: 800, speed: 80, cant: 0 })
    expectValidTrack(merged)
    expect(merged.elements.map(e => e.elementType)).toEqual([0, 2, 1, 1, 0])
    expect(merged.elements[2].length).toBeCloseTo(50, 4)
  })
})
