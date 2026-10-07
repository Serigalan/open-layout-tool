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
const settings = { radius: 300, clothoidEnabled: false, transitions: [60, 60], transitionType: 'clothoid', arcJoin: 'straight' }
// The solution the service proposes, as the dialog reads it.
const best = (answer, picks) => spliceFromAnswer(answer, picks).solutions[0]

// Track a runs east to x = 200; track b runs north from y = 100 at x = 400. An
// arc of R 300 turns the one into the other: a quarter circle, 471 m.
const a = track('a', [straightElement(P(0, 0), P(200, 0), { speed: 80 })],
  { heights: [{ station: 0, z: 100 }, { station: 200, z: 102 }] })
const b = track('b', [straightElement(P(400, 100), P(400, 700), { speed: 80 })])
let n = 0
const newId = () => `m${++n}`

describe('picking the two elements', () => {
  it('reads an element\'s ends, bearing, radius and what lies either side of it', () => {
    const pick = splicePick(a, 0)
    expect(pick).toMatchObject({ trackId: 'a', elIdx: 0, signedR: null, label: 'a', length: 200, before: 0, after: 0, speed: 80 })
    expect(pick.bearing).toBeCloseTo(90, 9)
    expect(splicePick(a, 3)).toBe(null)
  })

  it('refuses a transition, the same track and another plane', () => {
    const tr = transitionElement(P(0, 0), 90, 50, null, 300).element
    const inside = track('t', [straightElement(P(-50, 0), P(0, 0)), tr, straightElement(P(50, 3), P(100, 3))])
    expect(splicePick(inside, 1)).toEqual({ error: 'splice_hint_transition_end' })
    const first = splicePick(a, 0)
    expect(secondPickRefusal(first, first)).toBe('same')
    expect(secondPickRefusal(first, { ...first, elIdx: 1 })).toBe('splice_error_same_track')
    const other = { id: 'c', epsg: 25833, elements: [straightElement(P(0, 0, 25833), P(0, 100, 25833))] }
    expect(secondPickRefusal(first, splicePick(other, 0))).toBe('splice_error_crs')
    expect(secondPickRefusal(first, splicePick(b, 0))).toBe(null)
  })
})

describe('which pick departs', () => {
  // The service finds it (olt_optimizer/splice.py, AP S.2); the answer names it.
  const [pa, pb] = [splicePick(a, 0), splicePick(b, 0)]

  it('is the one whose end faces the gap, whichever was picked first', () => {
    const sol = best(answers.cornerPickedTheOtherWay.answer, [pb, pa])
    expect([sol.dep.trackId, sol.arr.trackId]).toEqual(['a', 'b'])
    expect(sol.result).toMatchObject({ reverseDep: false, reverseArr: false, ends: ['start', 'end'] })
  })

  it('runs the shorter track backwards where the two starts meet, and keeps the other one\'s name', () => {
    const a2 = track('a2', [straightElement(P(200, 0), P(0, 0), { speed: 80 })],
      { heights: [{ station: 0, z: 102 }, { station: 200, z: 100 }] })
    const picks = [splicePick(b, 0), splicePick(a2, 0)]
    const sol = best(answers.startToStart.answer, picks)
    expect([sol.dep.trackId, sol.arr.trackId]).toEqual(['a2', 'b'])
    expect(sol.result).toMatchObject({ reverseDep: true, reverseArr: false })
    const commit = buildSplice({ tracks: [a2, b], solution: sol, speed: 60, cant: 40, newId })
    const [merged] = commit.addTracks
    expectValidTrack(merged)
    expect(merged.name).toBe('b')
    expect(merged.elements.map(e => e.elementType)).toEqual([0, 1, 0])
    // Run backwards, a2 is track a: it runs east and turns north into b.
    expect(merged.elements[0].bearing).toBeCloseTo(90, 6)
    expect(merged.elements[0].startNode[0]).toBeCloseTo(500000, 6)
    expect(merged.elements[1]).toMatchObject({ radius: -300, cant: -40, speed: 60 })
    expect(commit.remap).toEqual([{ oldId: 'a2', newId: merged.id, flip: true }, { oldId: 'b', newId: merged.id, flip: false }])
    expect(commit.consumed).toEqual([{ trackId: 'a2', endpoint: 'BEGIN' }, { trackId: 'b', endpoint: 'BEGIN' }])
    // Its gradient turned round with it, up to the tangent point 100 m along.
    expect(merged.heights).toEqual([{ station: 0, z: 100 }, { station: 100, z: 101 }])
  })
})

describe('a transition at the end of its track (AP S.7)', () => {
  // Track k: 100 m east, then 60 m of transition into R 500 — where it ends.
  const k = track('k', [
    straightElement(P(0, 0), P(100, 0), { speed: 80 }),
    transitionElement(P(100, 0), 90, 60, null, 500, { speed: 80 }).element,
  ])

  it('is picked as the point it ends in, joined there only', () => {
    const pick = splicePick(k, 1)
    expect(pick).toMatchObject({ virtual: 'end', joinAt: 'end', signedR: 500, length: 0, after: 0 })
    expect(pick.before).toBeCloseTo(160, 6)
    expect(pick.startUtm).toEqual(pick.endUtm)
    expect(spliceRequest(splicePick(b, 0), pick, settings).arr.joinAt).toBe('end')
  })

  it('stays as it is, what is built from it new', () => {
    const { request, answer } = answers.transitionEnd
    const off = track('off', [straightElement(at(request.dep.start), at(request.dep.end), { speed: 80 })])
    const sol = best(answer, [splicePick(off, 0), splicePick(k, 1)])
    expect([sol.dep.trackId, sol.arr.trackId]).toEqual(['k', 'off'])
    const commit = buildSplice({ tracks: [off, k], solution: sol, speed: 80, cant: 0, newId })
    const [merged] = commit.addTracks
    expectValidTrack(merged)
    expect(merged.name).toBe('k')
    // The straight and the transition of k, then 50 m more of R 500, the new R 800 the other way, the straight.
    expect(merged.elements.map(e => e.elementType)).toEqual([0, 2, 1, 1, 0])
    expect(merged.elements[1]).toMatchObject({ elementType: 2, length: 60, r2: 500 })
    expect(merged.elements[2]).toMatchObject({ radius: 500, speed: 80 })
    expect(merged.elements[2].length).toBeCloseTo(50, 3)
    expect(merged.elements[3].radius).toBe(-800)
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

  it('asks for transitions only where they are switched on, each beside its pick', () => {
    expect(spliceRequest(dep, arr, { ...settings, clothoidEnabled: true, transitions: [60, 40] })).toMatchObject({ lDep: 60, lArr: 40 })
    expect(spliceRequest(dep, arr, { ...settings, transitions: [60, 40] })).toMatchObject({ lDep: 0, lArr: 0 })
  })

  it('reads a splice that does not fit as an error with its numbers', () => {
    expect(spliceFromAnswer({ error: 'splice_error_dep_too_large', params: { rMax: 400 } }, [dep, arr]))
      .toEqual({ error: 'splice_error_dep_too_large', params: { rMax: 400 } })
  })
})

describe('the track built from the answer', () => {
  const dep = splicePick(a, 0), arr = splicePick(b, 0)

  it('solves the arc between two straights', () => {
    const splice = best(answers.corner.answer, [dep, arr])
    expect(splice.result.arcLength).toBeCloseTo(300 * Math.PI / 2, 3)
    expect(splice.result.previewCoords.length).toBeGreaterThan(10)
  })

  it('merges both tracks into one, in one commit', () => {
    const splice = best(answers.corner.answer, [dep, arr])
    const commit = buildSplice({ tracks: [a, b], solution: splice, speed: 60, cant: 40, newId })
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
    expect(commit.remap).toEqual([{ oldId: 'a', newId: merged.id, flip: false }, { oldId: 'b', newId: merged.id, flip: false }])
    expect(commit.consumed).toEqual([{ trackId: 'a', endpoint: 'END' }, { trackId: 'b', endpoint: 'BEGIN' }])
    // The departure track's gradient runs as far as the merged track runs over
    // it: to the tangent point 100 m along. Track b has none to join.
    expect(merged.heights).toEqual([{ station: 0, z: 100 }, { station: 100, z: 101 }])
  })

  it('puts transitions either side when asked', () => {
    const splice = best(answers.cornerTransitions.answer, [dep, arr])
    const commit = buildSplice({ tracks: [a, b], solution: splice, speed: 60, cant: 40, newId })
    expect(commit.addTracks[0].elements.map(e => e.elementType)).toEqual([0, 2, 1, 2, 0])
    expectValidTrack(commit.addTracks[0])
  })

  it('reads what the catalogue finds on the stretch, by element', () => {
    // Project SBSS at 80 km/h: R 750 with 45 mm, the Regelüberhöhung being 55 mm.
    const sol = best(answers.sbssRegular.answer, [dep, arr])
    expect(sol.result.judged).toBe(true)
    expect(sol.result.findings).toContainEqual({ at: '#2', index: [2], id: 'LP.KB.04', severity: 'hint' })
    expect(sol.result.worst).toBe('hint')
  })

  it('reads the lengths the service set for each pick, every rule with its formula', () => {
    // Project SBSS: R 410 / 80 mm into R 750 / 45 mm at 80 km/h (AP S.3).
    const { request, answer } = answers.sbssRegular
    const g = track('g', [arcElement(at(request.dep.start), at(request.dep.end), request.dep.radius, { speed: 80, cant: 80 })])
    const h = track('h', [straightElement(at(request.arr.start), at(request.arr.end), { speed: 80 })])
    const sol = best(answer, [splicePick(g, 0), splicePick(h, 0)])
    const [lg, lh] = sol.result.lengths
    expect(lg).toMatchObject({ mode: 'regular', length: 28, regular: 28, minimum: 22.4 })
    expect(lg.regularBy.find(b => b.binding)).toMatchObject({ id: 'LP.UB.03', formula: '10·v·Δu/1000', length: 28 })
    expect(lg.minimumBy.find(b => b.binding)).toMatchObject({ id: 'LP.UB.03', formula: '8·v·Δu/1000' })
    expect(lh).toMatchObject({ mode: 'regular', length: 36 })
    // And they are what the chain written carries.
    const commit = buildSplice({ tracks: [g, h], solution: sol, speed: 80, cant: 45, newId })
    const [merged] = commit.addTracks
    expectValidTrack(merged)
    expect(merged.elements.filter(e => e.elementType === 2).map(e => e.length)).toEqual([28, 36])
  })

  it('offers two arcs joined the other way too, and says why the way asked for does not fit', () => {
    const { request, answer } = answers.arcsAskedDirect
    const c = track('c', [arcElement(at(request.dep.start), at(request.dep.end), request.dep.radius, { speed: 100, cant: 50 })])
    const d = track('d', [arcElement(at(request.arr.start), at(request.arr.end), request.arr.radius, { speed: 100, cant: 30 })])
    const read = spliceFromAnswer(answer, [splicePick(c, 0), splicePick(d, 0)])
    expect(read.solutions.map(x => [x.result.arcJoin, x.result.alternative])).toEqual([['transition', false], ['straight', true]])
    // Asked for none, the straight comes with transitions at the Regellänge.
    expect(read.solutions[1].result.lengths.map(l => l.mode)).toEqual(['regular', 'regular'])
    expect(read.requested).toBeNull()
    const failed = spliceFromAnswer({ ...answer, requested: { error: 'splice_error_arcs_no_fit', params: {} } }, [splicePick(c, 0), splicePick(d, 0)])
    expect(failed.requested).toEqual({ error: 'splice_error_arcs_no_fit', params: {} })
  })

  it('asks for the Regellänge, the Mindestlänge or a length as given, beside each pick', () => {
    const req = spliceRequest(dep, arr, { ...settings, clothoidEnabled: true, speed: 80, cant: -45, modes: ['regular', 'fixed'] })
    expect(req).toMatchObject({ speed: 80, cant: 45, modeDep: 'regular', modeArr: 'fixed', lDep: 60, lArr: 60 })
    // Each pick with its own speed and cant: what is left of it is judged with them.
    expect(req.dep).toMatchObject({ speed: 80, cant: 0, length: 200, before: 0, after: 0 })
    expect(spliceRequest(dep, arr, { ...settings, modes: ['regular', 'minimum'] })).toMatchObject({ modeDep: 'fixed', modeArr: 'fixed' })
  })

  it('folds an arrival arc in backwards, both arcs keeping their cant', () => {
    const { request, answer } = answers.arcsStraight
    const c = track('c', [arcElement(at(request.dep.start), at(request.dep.end), request.dep.radius, { speed: 100, cant: 50 })])
    const d = track('d', [arcElement(at(request.arr.start), at(request.arr.end), request.arr.radius, { speed: 90, cant: 30 })])
    const dc = splicePick(c, 0), dd = splicePick(d, 0)
    const splice = best(answer, [dc, dd])
    const commit = buildSplice({ tracks: [c, d], solution: splice, speed: 70, cant: 0, newId })
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

  it('runs on into an arrival track that points the same way, keeping what follows', () => {
    const { request, answer } = answers.arcOnToStraight
    const e = track('e', [arcElement(at(request.dep.start), at(request.dep.end), request.dep.radius, { speed: 100, cant: 40 })])
    const [fe, fn] = request.arr.end
    const rad = request.arr.bearing * Math.PI / 180
    const onward = [fe + 100 * Math.sin(rad), fn + 100 * Math.cos(rad)]
    const f = track('f', [
      straightElement(at(request.arr.start), at(request.arr.end), { speed: 90 }),
      straightElement(at(request.arr.end), at(onward), { speed: 120 }),
    ])
    const de = splicePick(e, 0), df = splicePick(f, 0)
    const splice = best(answer, [de, df])
    const commit = buildSplice({ tracks: [e, f], solution: splice, speed: 70, cant: 30, newId })
    const [merged] = commit.addTracks
    expectValidTrack(merged)
    expect(merged.elements.map(el => el.elementType)).toEqual([1, 1, 0, 0])
    expect(merged.elements[1]).toMatchObject({ radius: -400, cant: -30, speed: 70 })
    // The arrival track runs on in its own direction, its next element kept.
    expect(merged.elements[2].speed).toBe(90)
    expect(merged.elements[3]).toMatchObject({ speed: 120 })
    expect(merged.elements[3].endNode[0]).toBeCloseTo(onward[0], 6)
    expect(commit.remap[1]).toMatchObject({ oldId: 'f', flip: false })
    expect(commit.consumed[1]).toEqual({ trackId: 'f', endpoint: 'BEGIN' })
  })

  it('joins the gradients of both tracks with one straight gradient, no vertical curve at either end', () => {
    // Track b climbs 6 m over its 600 m; the merged track runs on it from 200 m.
    const bh = { ...b, heights: [{ station: 0, z: 110 }, { station: 600, z: 116 }] }
    // Track a's crest at 100 m, rounded with R 5000 (T = 50 m): the cut falls on it.
    const ah = { ...a, heights: [{ station: 0, z: 100 }, { station: 100, z: 101, rv: 5000 }, { station: 200, z: 100 }] }
    const splice = best(answers.corner.answer, [splicePick(ah, 0), splicePick(bh, 0)])
    const commit = buildSplice({ tracks: [ah, bh], solution: splice, speed: 60, cant: 40, newId })
    const [merged] = commit.addTracks
    const L = merged.elements.reduce((sum, el) => sum + el.length, 0)
    const h = merged.heights
    const j = h.findIndex(p => Math.abs(p.station - 100) < 1e-6)
    // The departure's own curve runs up to the cut, and stops there.
    expect(h[j - 1].rv).toBe(5000)
    expect(h[j].rv).toBeUndefined()
    expect(h[j].z).toBeCloseTo(101 - 50 ** 2 / (2 * 5000), 9)
    // Then straight on to the arrival's gradient at its station 200 m: 112 m.
    expect(h[j + 1]).toEqual({ station: expect.closeTo(L - 400, 6), z: expect.closeTo(112, 9) })
    expect(h[j + 2]).toEqual({ station: expect.closeTo(L, 6), z: 116 })
    expect(h).toHaveLength(j + 3)
  })

  it('joins the arrival\'s gradient also where the departure\'s stops short of the cut', () => {
    // Track a's gradient ends at 50 m — its length was edited behind it.
    const ah = { ...a, heights: [{ station: 0, z: 100 }, { station: 50, z: 100.5, rv: 3000 }] }
    const bh = { ...b, heights: [{ station: 0, z: 110 }, { station: 600, z: 116 }] }
    const dep = splicePick(ah, 0), arr = splicePick(bh, 0)
    const splice = best(answers.corner.answer, [dep, arr])
    const [merged] = buildSplice({ tracks: [ah, bh], solution: splice, speed: 60, cant: 40, newId }).addTracks
    const L = merged.elements.reduce((sum, el) => sum + el.length, 0)
    expect(merged.heights).toEqual([
      { station: 0, z: 100 }, { station: 50, z: 100.5 },
      { station: expect.closeTo(L - 400, 6), z: expect.closeTo(112, 9) }, { station: expect.closeTo(L, 6), z: 116 },
    ])
  })

  it('takes over the gradient of an arrival folded in backwards', () => {
    const { request, answer } = answers.arcsStraight
    const c0 = track('c', [arcElement(at(request.dep.start), at(request.dep.end), request.dep.radius, { speed: 100 })])
    const c = { ...c0, heights: [{ station: 0, z: 50 }, { station: c0.elements[0].length, z: 52 }] }
    const d = track('d', [arcElement(at(request.arr.start), at(request.arr.end), request.arr.radius, { speed: 90 })])
    const dLen = d.elements[0].length
    const dh = { ...d, heights: [{ station: 0, z: 60 }, { station: dLen, z: 60 + dLen / 100 }] }
    const dc = splicePick(c, 0), dd = splicePick(dh, 0)
    const splice = best(answer, [dc, dd])
    const commit = buildSplice({ tracks: [c, dh], solution: splice, speed: 70, cant: 0, newId })
    const [merged] = commit.addTracks
    const L = merged.elements.reduce((sum, el) => sum + el.length, 0)
    const h = merged.heights
    expect(h[0]).toEqual({ station: 0, z: 50 })
    // The arrival runs backwards: its start, 60 m, is the merged track's end,
    // and its height 120 m in — where the kept arc begins — the joint.
    expect(h.at(-1).station).toBeCloseTo(L, 6)
    expect(h.at(-1).z).toBeCloseTo(60, 9)
    expect(h.at(-2).station).toBeCloseTo(L - 120, 6)
    expect(h.at(-2).z).toBeCloseTo(60 + 1.2, 9)
    expect(h.every(p => p.rv == null)).toBe(true)
  })

  it('has nothing to commit without a solution', () => {
    expect(buildSplice({ tracks: [a, b], solution: null, speed: 0, cant: 0 })).toBe(null)
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
