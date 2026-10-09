import { describe, it, expect } from 'vitest'
import { heightAt, gradientAt, verticalCurve, verticalCurveOverlaps, splitHeights, joinHeights, endOfIndex, insertHeightPoint,
  pointGrades, solveHeightPoint, jointHeightUpdates } from './heightUtils'

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

describe('verticalCurveOverlaps — curves running into each other (HP.AR.04)', () => {
  // Crest at 100 m (+10 ‰ → −10 ‰) and sag at 140 m (−10 ‰ → +10 ‰).
  const heights = (rv) => [
    { station: 0, z: 100 }, { station: 100, z: 101, rv }, { station: 140, z: 100.6, rv }, { station: 240, z: 101.6 },
  ]

  it('finds the stretch two curves both claim', () => {
    // R 3000: T = 30 m each, 70–130 and 110–170 share 110–130.
    const [o, ...rest] = verticalCurveOverlaps(heights(3000))
    expect(rest).toEqual([])
    expect(o.a).toBe(1)
    expect(o.b).toBe(2)
    expect(o.from).toBeCloseTo(110, 9)
    expect(o.to).toBeCloseTo(130, 9)
    expect(o.zMin).toBeLessThan(o.zMax)
  })

  it('leaves curves alone that only touch or keep apart', () => {
    expect(verticalCurveOverlaps(heights(2000))).toEqual([])   // T = 20 m: 80–120 and 120–160
    expect(verticalCurveOverlaps(heights(1000))).toEqual([])
    expect(verticalCurveOverlaps(heights(undefined))).toEqual([])
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

describe('solveHeightPoint — a gradient point from two of its values', () => {
  // 0 → 100 rising 10 ‰ to the point at 100, falling 5 ‰ after it to 300.
  const h = [{ station: 0, z: 100 }, { station: 100, z: 101, rv: 5000 }, { station: 300, z: 100 }]

  it('reads the gradients either side', () => {
    expect(pointGrades(h, 1).before).toBeCloseTo(0.01, 9)
    expect(pointGrades(h, 1).after).toBeCloseTo(-0.005, 9)
    expect(pointGrades(h, 0).before).toBeNull()
    expect(pointGrades(h, 2).after).toBeNull()
  })

  it('takes station and height as they are', () => {
    expect(solveHeightPoint(h, 1, { s: 120.0004, z: 101.2346 })).toEqual({ station: 120, z: 101.235 })
  })

  it('slides along the gradient before or after, its station given', () => {
    expect(solveHeightPoint(h, 1, { s: 150, gb: 0.01 })).toEqual({ station: 150, z: 101.5 })
    expect(solveHeightPoint(h, 1, { s: 200, ga: -0.005 })).toEqual({ station: 200, z: 100.5 })
  })

  it('finds the station where a gradient reaches the height', () => {
    expect(solveHeightPoint(h, 1, { z: 101.2, gb: 0.008 })).toEqual({ station: 150, z: 101.2 })
    expect(solveHeightPoint(h, 1, { z: 101, ga: -0.004 })).toEqual({ station: 50, z: 101 })
    expect(solveHeightPoint(h, 1, { z: 101, gb: 0 })).toEqual({ error: 'flat' })
  })

  it('meets two gradients where they cross', () => {
    // 12 ‰ up from (0, 100), 4 ‰ down to (300, 100): 0.012 s = 0.004 (300 − s) → s = 75.
    expect(solveHeightPoint(h, 1, { gb: 0.012, ga: -0.004 })).toEqual({ station: 75, z: 100.9 })
    expect(solveHeightPoint(h, 1, { gb: 0.01, ga: 0.01 })).toEqual({ error: 'parallel' })
  })

  it('keeps the point between its neighbours and on the track', () => {
    expect(solveHeightPoint(h, 1, { s: 299.95, z: 101 })).toEqual({ error: 'order' })
    expect(solveHeightPoint(h, 1, { z: 104, gb: 0.01 })).toEqual({ error: 'order' })
    expect(solveHeightPoint(h, 0, { s: -1, z: 100 }, { length: 300 })).toEqual({ error: 'order' })
    expect(solveHeightPoint(h, 0, { s: 0, gb: 0.01 })).toEqual({ error: 'missing' })
    expect(solveHeightPoint(h, 0, { s: 0, ga: 0.02 })).toEqual({ station: 0, z: 99 })
  })
})

describe('jointHeightUpdates', () => {
  // Two tracks end to end at (100, 0): a's END is b's BEGIN.
  const a = { id: 'a', epsg: 5684, elements: [{ elementType: 0, startNode: [0, 0], endNode: [100, 0], bearing: 90, length: 100 }],
    heights: [{ station: 0, z: 10 }, { station: 50, z: 10.5 }, { station: 100, z: 11 }] }
  const b = { id: 'b', epsg: 5684, elements: [{ elementType: 0, startNode: [100, 0], endNode: [200, 0], bearing: 90, length: 100 }],
    heights: [{ station: 0, z: 11 }, { station: 100, z: 12 }] }

  it('gives a reason to the point and to every point joined to it, and takes it away again', () => {
    const set = jointHeightUpdates([a, b], [], [{ trackId: 'a', index: 2, reason: 'Zwangspunkt' }])
    expect(set.get('a')[2]).toEqual({ station: 100, z: 11, reason: 'Zwangspunkt' })
    expect(set.get('b')[0]).toEqual({ station: 0, z: 11, reason: 'Zwangspunkt' })
    const withReason = [{ ...a, heights: set.get('a') }, { ...b, heights: set.get('b') }]
    const off = jointHeightUpdates(withReason, [], [{ trackId: 'a', index: 2, reason: null }])
    expect(off.get('a')[2]).toEqual({ station: 100, z: 11 })
    expect(off.get('b')[0]).toEqual({ station: 0, z: 11 })
    // An inner point is alone in its group; a field left out stays.
    const inner = jointHeightUpdates([a, b], [], [{ trackId: 'a', index: 1, z: 10.6, reason: 'Bestand' }])
    expect(inner.get('a')[1]).toEqual({ station: 50, z: 10.6, reason: 'Bestand' })
    expect(inner.has('b')).toBe(false)
  })
})
