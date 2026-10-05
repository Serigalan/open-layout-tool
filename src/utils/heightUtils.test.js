import { describe, it, expect } from 'vitest'
import { heightAt, gradientAt, verticalCurve, splitHeights, endOfIndex, insertHeightPoint } from './heightUtils'

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

describe('heights that cover only part of their track', () => {
  // An imported gradient beginning 100 m into a 400 m track and ending at 300 m.
  const heights = [{ station: 100, z: 10 }, { station: 200, z: 12, rv: 4000 }, { station: 300, z: 11 }]
  const track = { elements: [{ length: 400 }], heights }

  it('split where they are leave the other half without any', () => {
    expect(splitHeights(heights, 50)).toEqual([undefined,
      [{ station: 50, z: 10 }, { station: 150, z: 12, rv: 4000 }, { station: 250, z: 11 }]])
    expect(splitHeights(heights, 350)).toEqual([heights, undefined])
  })

  it('split inside them meet at the interpolated height, as always', () => {
    const [a, b] = splitHeights(heights, 150)
    expect(a).toEqual([{ station: 100, z: 10 }, { station: 150, z: 11 }])
    expect(b).toEqual([{ station: 0, z: 11 }, { station: 50, z: 12, rv: 4000 }, { station: 150, z: 11 }])
  })

  it('have no point on a joint where they stop short of the end', () => {
    expect(endOfIndex(track, 0)).toBe(null)
    expect(endOfIndex(track, 2)).toBe(null)
    const whole = { elements: [{ length: 400 }], heights: [{ station: 0, z: 1 }, { station: 400, z: 2 }] }
    expect(endOfIndex(whole, 0)).toBe('BEGIN')
    expect(endOfIndex(whole, 1)).toBe('END')
  })
})

describe('insertHeightPoint — splitting a gradient', () => {
  const heights = [{ station: 0, z: 100 }, { station: 200, z: 102, rv: 5000 }, { station: 400, z: 101 }]

  it('adds a point on the stretch, at its height, keeping the others', () => {
    const r = insertHeightPoint(heights, 50)
    expect(r.index).toBe(1)
    expect(r.heights).toEqual([heights[0], { station: 50, z: 100.5 }, heights[1], heights[2]])
  })

  it('works on the last stretch too', () => {
    const r = insertHeightPoint(heights, 300)
    expect(r.index).toBe(2)
    expect(r.heights[2]).toEqual({ station: 300, z: 101.5 })
  })

  it('adds nothing outside the points or on top of one', () => {
    expect(insertHeightPoint(heights, -1)).toBeNull()
    expect(insertHeightPoint(heights, 400)).toBeNull()
    expect(insertHeightPoint(heights, 401)).toBeNull()
    expect(insertHeightPoint(heights, 200.05)).toBeNull()
    expect(insertHeightPoint([{ station: 0, z: 1 }], 0.5)).toBeNull()
  })
})
