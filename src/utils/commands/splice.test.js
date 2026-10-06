import { describe, it, expect } from 'vitest'
import { buildSplice, clearanceRequest, neighbourAxis, secondPickRefusal, spliceFromAnswer, splicePick, spliceRequest } from './splice'
import { straightElement, arcElement, transitionElement } from '../elementFactory'
import { recalcAbsLengths, rebuildCoords } from '../trackModel'
import { expectValidTrack } from '../../test/chainInvariants'
import answers from '../../test/fixtures/splice_answers.json'

// The construction is the service's (olt_optimizer/splice.py); what is tested
// here is the app's half — the request it sends and the track it builds from
// the answer. The answers are real ones, written by
// tools/optimizer/tests/splice_fixture.py for the very same picks.

const EPSG = 25832
const P = (x, y, zone = EPSG) => ({ easting: 500000 + x, northing: 5700000 + y, zone })
const at = ([e, n]) => ({ easting: e, northing: n, zone: EPSG })
const track = (id, elements, extra = {}) => {
  const els = recalcAbsLengths(elements)
  return { id, name: id, epsg: EPSG, elements: els, coordinates: rebuildCoords(els), ...extra }
}
const settings = { radius: 300, clothoidEnabled: false, clothoidDep: 60, clothoidArr: 60, transitionType: 'clothoid', arcJoin: 'straight' }

// Track a runs east to x = 200; track b runs north from y = 100 at x = 400. An
// arc of R 300 turns the one into the other: a quarter circle, 471 m.
const a = track('a', [straightElement(P(0, 0), P(200, 0), { speed: 80 })],
  { heights: [{ station: 0, z: 100 }, { station: 200, z: 102 }] })
const b = track('b', [straightElement(P(400, 100), P(400, 700), { speed: 80 })])
let n = 0
const newId = () => `m${++n}`

describe('picking the two elements', () => {
  it('reads an element\'s ends, bearing and radius', () => {
    const pick = splicePick(a, 0)
    expect(pick).toMatchObject({ trackId: 'a', elIdx: 0, signedR: null, label: 'a' })
    expect(pick.bearing).toBeCloseTo(90, 9)
    expect(splicePick(a, 3)).toBe(null)
  })

  it('refuses a transition, the same track and another plane', () => {
    const tr = transitionElement(P(0, 0), 90, 50, null, 300).element
    expect(splicePick({ ...a, elements: [tr] }, 0)).toEqual({ error: 'splice_hint_straight_only' })
    const first = splicePick(a, 0)
    expect(secondPickRefusal(first, first)).toBe('same')
    expect(secondPickRefusal(first, { ...first, elIdx: 1 })).toBe('splice_error_same_track')
    const other = { id: 'c', epsg: 25833, elements: [straightElement(P(0, 0, 25833), P(0, 100, 25833))] }
    expect(secondPickRefusal(first, splicePick(other, 0))).toBe('splice_error_crs')
    expect(secondPickRefusal(first, splicePick(b, 0))).toBe(null)
  })
})

describe('the request to the service', () => {
  const dep = splicePick(a, 0), arr = splicePick(b, 0)

  it('holds both picks and the settings, as the service is asked', () => {
    const req = spliceRequest(dep, arr, settings)
    const want = answers.corner.request
    expect(req.radius).toBe(want.radius)
    expect(req.lDep).toBe(0)
    for (const side of ['dep', 'arr']) {
      for (const key of ['start', 'end']) {
        expect(req[side][key][0]).toBeCloseTo(want[side][key][0], 6)
        expect(req[side][key][1]).toBeCloseTo(want[side][key][1], 6)
      }
      expect(req[side].bearing).toBeCloseTo(want[side].bearing, 9)
      expect(req[side].radius).toBe(want[side].radius)
    }
  })

  it('asks for transitions only where they are switched on', () => {
    expect(spliceRequest(dep, arr, { ...settings, clothoidEnabled: true })).toMatchObject({ lDep: 60, lArr: 60 })
  })

  it('reads a splice that does not fit as an error with its numbers', () => {
    expect(spliceFromAnswer({ error: 'splice_error_dep_too_large', params: { rMax: 400 } }, dep, arr, settings))
      .toEqual({ error: 'splice_error_dep_too_large', params: { rMax: 400 } })
  })
})

describe('the track built from the answer', () => {
  const dep = splicePick(a, 0), arr = splicePick(b, 0)

  it('solves the arc between two straights', () => {
    const splice = spliceFromAnswer(answers.corner.answer, dep, arr, settings)
    expect(splice.result.arcLength).toBeCloseTo(300 * Math.PI / 2, 3)
    expect(splice.arcMode).toBe(false)
    expect(splice.result.previewCoords.length).toBeGreaterThan(10)
  })

  it('merges both tracks into one, in one commit', () => {
    const splice = spliceFromAnswer(answers.corner.answer, dep, arr, settings)
    const commit = buildSplice({ tracks: [a, b], dep, arr, splice, speed: 60, cant: 40, newId })
    expect(commit.removeTrackIds).toEqual(['a', 'b'])
    const [merged] = commit.addTracks
    expectValidTrack(merged)
    expect(merged.elements.map(e => e.elementType)).toEqual([0, 1, 0])
    expect(merged.elements[1]).toMatchObject({ radius: -300, cant: -40, speed: 60 })   // a left turn
    // What is left of the picked straights keeps their speed.
    expect(merged.elements[0].speed).toBe(80)
    expect(merged.elements[2].speed).toBe(80)
    expect(merged.elements.some(e => 'role' in e)).toBe(false)
    // The arrival track runs on in its own direction: it is not folded in.
    expect(commit.remap).toEqual([{ oldId: 'a', newId: merged.id }, { oldId: 'b', newId: merged.id, flip: false }])
    expect(commit.consumed).toEqual([{ trackId: 'a', endpoint: 'END' }, { trackId: 'b', endpoint: 'BEGIN' }])
    // The departure track's gradient ends where its last element is re-shaped.
    expect(merged.heights).toBeUndefined()
  })

  it('puts transitions either side when asked', () => {
    const s = { ...settings, clothoidEnabled: true }
    const splice = spliceFromAnswer(answers.cornerTransitions.answer, dep, arr, s)
    const commit = buildSplice({ tracks: [a, b], dep, arr, splice, speed: 60, cant: 40, newId })
    expect(commit.addTracks[0].elements.map(e => e.elementType)).toEqual([0, 2, 1, 2, 0])
    expectValidTrack(commit.addTracks[0])
  })

  it('folds an arrival arc in backwards, both arcs keeping their cant', () => {
    const { request, answer } = answers.arcsStraight
    const c = track('c', [arcElement(at(request.dep.start), at(request.dep.end), request.dep.radius, { speed: 100, cant: 50 })])
    const d = track('d', [arcElement(at(request.arr.start), at(request.arr.end), request.arr.radius, { speed: 90, cant: 30 })])
    const dc = splicePick(c, 0), dd = splicePick(d, 0)
    const splice = spliceFromAnswer(answer, dc, dd, { ...settings, clothoidEnabled: true, clothoidDep: 40, clothoidArr: 40 })
    expect(splice.arcMode).toBe(true)
    const commit = buildSplice({ tracks: [c, d], dep: dc, arr: dd, splice, speed: 70, cant: 0, newId })
    const [merged] = commit.addTracks
    expectValidTrack(merged)
    expect(merged.elements.map(e => e.elementType)).toEqual([1, 2, 0, 2, 1])
    expect(merged.elements[0]).toMatchObject({ radius: 600, cant: 50, speed: 100 })
    // stored as a right arc running back, it is run forwards as the left arc it
    // is — and its cant changes side with it
    expect(merged.elements[4]).toMatchObject({ radius: -900, cant: -30, speed: 90 })
    expect(splice.result.straightLength).toBeCloseTo(100, 4)
    expect(merged.elements[2].speed).toBe(70)
    expect(commit.remap[1]).toMatchObject({ oldId: 'd', flip: true })
    expect(commit.consumed[1]).toEqual({ trackId: 'd', endpoint: 'END' })
  })

  it('has nothing to commit without a solution', () => {
    expect(buildSplice({ tracks: [a, b], dep, arr, splice: { error: 'x' }, speed: 0, cant: 0 })).toBe(null)
  })
})

describe('the spacing to a neighbouring track', () => {
  const dep = splicePick(a, 0), arr = splicePick(b, 0)

  it('hands over the neighbour every metre, only near the two picked elements', () => {
    // A neighbour 10 m north of track a, two kilometres long.
    const far = track('n', [straightElement(P(-1000, 10), P(1000, 10))])
    const axis = neighbourAxis(far, EPSG, dep, arr)
    const es = axis.map(p => p[0] - 500000)
    expect(Math.min(...es)).toBeCloseTo(-150, 6)
    expect(Math.max(...es)).toBeCloseTo(550, 6)
    expect(axis.length).toBe(701)
    expect(axis.every(p => p[1] === 5700010 && p[2] === 0)).toBe(true)
  })

  it('carries the cant as it holds at each station, signed as stored', () => {
    const curve = track('c', [arcElement(P(0, 10), P(100, 20), -500, { cant: -80 })])
    const axis = neighbourAxis(curve, EPSG, dep, arr)
    expect(axis.length).toBe(Math.ceil(curve.elements[0].length) + 1)
    expect(axis.every(p => p[2] === -80)).toBe(true)
  })

  it('asks for the spacing with the cant figures and the shortest arc of the speed', () => {
    const req = spliceRequest(dep, arr, settings, clearanceRequest({
      axis: [[1, 2, 0]], dMin: '4.0', profile: [[0, 0], [2500, 0]], maximize: true, speed: 160, cant: -60,
    }))
    expect(req.clearance).toMatchObject({
      ref: [[1, 2, 0]], dMin: 4, maximize: true, speed: 160, cant: 60,
      cantModel: { coeff: 6.5, defMin: 60, step: 5 },
    })
    expect(req.clearance.lMin).toBeCloseTo(32)
    expect(req.dep.cant).toBe(0)
    expect(spliceRequest(dep, arr, settings).clearance).toBeUndefined()
  })
})
