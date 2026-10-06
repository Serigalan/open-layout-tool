import { describe, it, expect } from 'vitest'
import { heightAt, gradientAt, verticalCurve, splitHeights, joinHeights, endOfIndex, insertHeightPoint } from './heightUtils'

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

describe('splitHeights inside a vertical curve', () => {
  // The crest of gradientAt's test: T = 20 m, the curve from 80 to 120 m.
  const heights = [{ station: 0, z: 100 }, { station: 100, z: 101, rv: 2000 }, { station: 200, z: 100 }]
  const along = (a, b, sJ) => (s) => (s <= sJ ? gradientAt(a, s) : gradientAt(b, s - sJ))

  for (const sJ of [85, 100, 113.7]) {
    it(`gives both halves the rounded gradient when cut at ${sJ} m`, () => {
      const [a, b] = splitHeights(heights, sJ)
      expect(a.at(-1).station).toBe(sJ)
      expect(b[0].station).toBe(0)
      expect(a.at(-1).z).toBeCloseTo(gradientAt(heights, sJ), 9)
      expect(b[0].z).toBeCloseTo(a.at(-1).z, 9)
      const split = along(a, b, sJ)
      for (let s = 0; s <= 200; s += 0.5) expect(split(s), `at ${s} m`).toBeCloseTo(gradientAt(heights, s), 9)
      // The same gradient on either side of the joint.
      const e = 1e-4
      expect((split(sJ) - split(sJ - e)) / e).toBeCloseTo((split(sJ + e) - split(sJ)) / e, 4)
    })
  }

  it('leaves the curve whole where the cut lies outside it', () => {
    const [a, b] = splitHeights(heights, 60)
    expect(a).toEqual([{ station: 0, z: 100 }, { station: 60, z: 100.6 }])
    expect(b[1]).toEqual({ station: 40, z: 101, rv: 2000 })
  })

  it('is made one curve again by joinHeights', () => {
    for (const sJ of [85, 100, 113.7]) {
      const [a, b] = splitHeights(heights, sJ)
      const joined = joinHeights(a, b, sJ)
      expect(joined).toHaveLength(3)
      expect(joined[1].station).toBeCloseTo(100, 9)
      expect(joined[1].z).toBeCloseTo(101, 9)
      expect(joined[1].rv).toBe(2000)
    }
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
    // (Ahead of the curve at 200 m, which reaches back to 140 m.)
    const [a, b] = splitHeights(heights, 120)
    expect(a).toEqual([{ station: 100, z: 10 }, { station: 120, z: 10.4 }])
    expect(b).toEqual([{ station: 0, z: 10.4 }, { station: 80, z: 12, rv: 4000 }, { station: 180, z: 11 }])
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
