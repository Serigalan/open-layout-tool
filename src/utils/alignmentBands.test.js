import { describe, it, expect } from 'vitest'
import { curvatureBand, cantBand, speedBand, bandValueAt, bandRuns, bandRange } from './alignmentBands'

// Straight 100 m, clothoid 50 m into a right arc R 500 of 200 m with 80 mm
// cant, a Bloss transition 40 m out of it, and a straight of 60 m.
const elements = [
  { elementType: 1, length: 100, speed: 120 },
  { elementType: 2, length: 50, r1: null, r2: 500, speed: 120 },
  { elementType: 3, length: 200, radius: 500, cant: 80, speed: 100 },
  { elementType: 2, length: 40, r1: 500, r2: null, transitionType: 'bloss', speed: 100 },
  { elementType: 1, length: 60 },
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
    expect(bandValueAt(curvatureBand([{ elementType: 3, length: 10, radius: -250 }]), 5)).toBeCloseTo(-4)
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
