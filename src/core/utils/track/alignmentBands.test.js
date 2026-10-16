import { describe, it, expect } from 'vitest'
import { curvatureBand, cantBand, speedBand, bandValueAt, bandRuns, bandRange, withBandValue, bandFindings } from './alignmentBands'

// Straight 100 m, clothoid 50 m into a right arc R 500 of 200 m with 80 mm
// cant, a Bloss transition 40 m out of it, and a straight of 60 m.
const elements = [
  { elementType: 0, length: 100, speed: 120 },
  { elementType: 2, length: 50, r1: null, r2: 500, speed: 120 },
  { elementType: 1, length: 200, radius: 500, cant: 80, speed: 100 },
  { elementType: 2, length: 40, r1: 500, r2: null, transitionType: 'bloss', speed: 100 },
  { elementType: 0, length: 60 },
]

describe('curvatureBand', () => {
  const band = curvatureBand(elements)
  it('is 0 on a straight, 1000/R on an arc, ramps across a transition', () => {
    expect(bandValueAt(band, 50)).toBe(0)
    expect(bandValueAt(band, 125)).toBeCloseTo(1)      // halfway up the clothoid to 2
    expect(bandValueAt(band, 250)).toBeCloseTo(2)
    expect(bandValueAt(band, 370)).toBeCloseTo(1)      // Bloss is at half at its middle
    expect(bandValueAt(band, 360)).toBeGreaterThan(1)  // ... and above the clothoid's line before it
    expect(bandValueAt(band, 400)).toBe(0)
  })
  it('signs a left curve below the line', () => {
    expect(bandValueAt(curvatureBand([{ elementType: 1, length: 10, radius: -250 }]), 5)).toBeCloseTo(-4)
  })
})

describe('cantBand', () => {
  it('ramps the cant over the transitions from the arc it runs into', () => {
    const band = cantBand(elements)
    expect(bandValueAt(band, 100)).toBe(0)
    expect(bandValueAt(band, 125)).toBeCloseTo(40)
    expect(bandValueAt(band, 200)).toBe(80)
    expect(bandValueAt(band, 370)).toBeCloseTo(40)
    expect(bandValueAt(band, 420)).toBe(0)
  })
  it('keeps the ramp ends a cut transition carries', () => {
    const band = cantBand([{ elementType: 2, length: 10, r1: null, r2: 300, cantStart: 20, cantEnd: 60 }])
    expect(bandValueAt(band, 0)).toBe(20)
    expect(bandValueAt(band, 10)).toBe(60)
  })
})

describe('speedBand', () => {
  const band = speedBand(elements)
  it('steps at a change, the new speed holding from the joint on', () => {
    expect(bandValueAt(band, 149)).toBe(120)
    expect(bandValueAt(band, 150)).toBe(100)
  })
  it('breaks where an element has no speed', () => {
    expect(bandValueAt(band, 420)).toBeNull()
    expect(bandRange(band)).toEqual([100, 120])
  })
  it('makes one run of neighbouring elements at one speed', () => {
    expect(bandRuns(band)).toEqual([{ from: 0, to: 150, v: 120 }, { from: 150, to: 390, v: 100 }])
  })
})

describe('bandValueAt', () => {
  it('is null beside the track', () => {
    const band = speedBand(elements)
    expect(bandValueAt(band, -1)).toBeNull()
    expect(bandValueAt(band, 451)).toBeNull()
    expect(bandValueAt([], 0)).toBeNull()
  })
})

describe('withBandValue', () => {
  it('sets the speed on every picked element, never below 0, and clears it with null', () => {
    const next = withBandValue(elements, [0, 1], 'speed', 140)
    expect(next.map(e => e.speed)).toEqual([140, 140, 100, 100, undefined])
    expect(next[2]).toBe(elements[2])
    expect(withBandValue(elements, [0], 'speed', -5)[0].speed).toBe(0)
    expect('speed' in withBandValue(elements, [0], 'speed', null)[0]).toBe(false)
  })
  it('sets a cant on its 5 mm step, signed by the curve, and leaves a transition alone', () => {
    const left = [{ elementType: 1, length: 10, radius: -400 }, { elementType: 2, length: 10, r1: -400, r2: null }]
    const next = withBandValue(left, [0, 1], 'cant', 83)
    expect(next[0].cant).toBe(-85)
    expect(next[1]).toBe(left[1])
  })
  it('keeps the side of a straight\'s cant and caps it at the limit', () => {
    const next = withBandValue([{ elementType: 0, length: 10, cant: -20 }], [0], 'cant', 500)
    expect(next[0].cant).toBeLessThan(0)
    expect(Math.abs(next[0].cant)).toBeLessThanOrEqual(170)
  })
})

describe('bandFindings', () => {
  const r = (id, severity) => ({ id, severity })
  it('puts a finding into the band of the quantity its rule is about', () => {
    const found = bandFindings({
      elements: [{ index: 0, results: [r('LP.KB.01', 'error'), r('LP.ALL.02', 'hint'), r('LP.KB.03', 'ok')] },
        { index: 1, results: [r('LP.KB.02', 'warning'), r('LP.UB.03', 'error')] }],
      ramps: [{ index: 1, results: [r('LP.UB.02', 'special_case')] }],
      boundaries: [{ index: 0, results: [r('LP.KS.02', 'error'), r('LP.UB.01', 'ok')] }],
    })
    expect(found.cant.spans.map(s => [s.index, s.severity, s.results.map(x => x.id)]))
      .toEqual([[0, 'error', ['LP.KB.01']], [1, 'special_case', ['LP.KB.02', 'LP.UB.02']]])
    expect(found.speed.spans.map(s => [s.index, s.results.map(x => x.id)]))
      .toEqual([[0, ['LP.ALL.02']], [1, ['LP.KB.02']]])
    expect(found.curvature.spans.map(s => s.index)).toEqual([1])
    expect(found.curvature.joints.map(j => j.index)).toEqual([0])
    expect(found.cant.joints).toEqual([])
  })
})
