import { describe, it, expect } from 'vitest'
import { heightAt, gradientAt, verticalCurve } from './heightUtils'

describe('gradientAt — the height a track is built at', () => {
  // +10 ‰ up to a crest at 100 m, −10 ‰ down from it, rounded with R 2000:
  // T = 2000 · 0.02 / 2 = 20 m, and the curve passes f = T²/2R = 0.1 m under
  // the point where the gradients meet.
  const heights = [{ station: 0, z: 100 }, { station: 100, z: 101, rv: 2000 }, { station: 200, z: 100 }]

  it('runs under the point where the gradients meet by the sagitta of the curve', () => {
    expect(heightAt(heights, 100)).toBeCloseTo(101, 9)
    expect(gradientAt(heights, 100)).toBeCloseTo(100.9, 9)
  })

  it('leaves and rejoins the tangents at the tangent points', () => {
    expect(gradientAt(heights, 80)).toBeCloseTo(heightAt(heights, 80), 9)
    expect(gradientAt(heights, 120)).toBeCloseTo(heightAt(heights, 120), 9)
  })

  it('is the tangent polygon outside the curve', () => {
    expect(gradientAt(heights, 50)).toBeCloseTo(100.5, 9)
    expect(gradientAt(heights, 150)).toBeCloseTo(100.5, 9)
  })

  it('reads the same parabola the profile draws', () => {
    for (const { station, z } of verticalCurve(heights, 1, 8)) {
      expect(gradientAt(heights, station)).toBeCloseTo(z, 9)
    }
  })

  it('is the polygon where a point has no curve, and nothing for a track without heights', () => {
    const plain = heights.map(({ rv: _rv, ...p }) => p)
    expect(gradientAt(plain, 100)).toBeCloseTo(101, 9)
    expect(gradientAt(undefined, 10)).toBe(null)
    expect(gradientAt([], 10)).toBe(null)
  })
})
