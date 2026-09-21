import { describe, it, expect } from 'vitest'
import { mdbStation, mdbGradientChains, gradientForTrack, stationsAlong } from './mdbGradient'
import { parseMdbPayload, buildAllTracksFromMdb } from './mdbImport'
import { trackLength } from './heightUtils'
import fixture from '../test/fixtures/mdb_gradiente.json'

/**
 * The vertical alignment of the DB ASCII interface: Satzart 22 with the point
 * heights of Satzart 13, placed on the track by the stationing of Satzart 11.
 *
 * The fixture is the delivered STR_1150_KM_158-159: one Trasse of four
 * elements over 1 688 m, and the gradient that runs over it — ten height
 * elements over 3 385 m, six slopes and four roundings, every point stationed
 * and every point with a height in `V00`.
 */

const payload = parseMdbPayload(fixture)

/** Gradient between two height points, in per mille. */
const slope = (a, b) => (b.z - a.z) / (b.station - a.station) * 1000

describe('reading a station', () => {
  it('unpacks the form a line uses', () => {
    // 1 157 500 m + 99.917 m. The metres are the last two digits before the
    // point, the hundred-metre block counts in ten thousands.
    expect(mdbStation(115750099.917)).toBeCloseTo(1157599.917, 3)
    expect(mdbStation(115800099.925)).toBeCloseTo(1158099.925, 3)
    // Which makes the difference of the two the length between them: the
    // element there is 500.008 m long.
    expect(mdbStation(115800099.925) - mdbStation(115750099.917)).toBeCloseTo(500.008, 3)
  })

  it('takes the form a station track uses as the metres it is', () => {
    expect(mdbStation(804.799)).toBeCloseTo(804.799, 3)
    expect(mdbStation(1062.394)).toBeCloseTo(1062.394, 3)
    // 783.774 m apart — the length of the element between them.
    expect(mdbStation(804.799) - mdbStation(21.025)).toBeCloseTo(783.774, 3)
  })

  it('reads the two forms the same where they cannot be told apart', () => {
    // Below a hundred metres there is no block to unpack, so both readings
    // give the same number.
    expect(mdbStation(45)).toBe(45)
    expect(mdbStation(99.917)).toBeCloseTo(99.917, 3)
  })

  it('says nothing for a field that states nothing', () => {
    expect(mdbStation(0)).toBe(null)
    expect(mdbStation('')).toBe(null)
    expect(mdbStation(null)).toBe(null)
  })
})

describe('the gradient of the file', () => {
  const { chains, refused } = mdbGradientChains(payload)

  it('is one chain over the whole stretch', () => {
    expect(refused).toBe(0)
    expect(chains).toHaveLength(1)
    expect(chains[0].line).toBe('1150')
    expect(chains[0].sys).toBe('V00')
    expect(chains[0].to - chains[0].from).toBeCloseTo(3385, 0)
  })

  it('turns six slopes and four roundings into seven tangent points', () => {
    const { points } = chains[0]
    expect(points).toHaveLength(7)
    expect(points.filter(p => p.rv)).toHaveLength(4)
  })

  it('takes the radius from how far the gradient turns over the rounding', () => {
    // Rv = 1000 · L / Δi: 40 m from 0 to 2,5 ‰ is 16 000 m, 20 m from 0 to
    // 1,34293 ‰ is 14 893 m.
    const rv = chains[0].points.filter(p => p.rv).map(p => Math.round(p.rv))
    expect(rv).toEqual([16000, 16000, 14893, 18564])
  })

  it('states the gradients the file states', () => {
    // To a hundredth of a per mille, which is as well as the file agrees with
    // itself: several of its heights are written to the centimetre (12.00,
    // 12.05, 12.65), and a height polygon through them has gradients a
    // thousandth off the ones stated beside them. The heights are taken as
    // they stand — they are the ones the points carry.
    const p = chains[0].points
    expect(slope(p[0], p[1])).toBeCloseTo(0.88889, 2)
    expect(slope(p[1], p[2])).toBeCloseTo(0, 2)
    expect(slope(p[2], p[3])).toBeCloseTo(2.5, 2)
    expect(slope(p[3], p[4])).toBeCloseTo(0, 2)
    expect(slope(p[4], p[5])).toBeCloseTo(1.34293, 2)
    expect(slope(p[5], p[6])).toBeCloseTo(3.49762, 2)
  })
})

describe('the piece a track runs over', () => {
  const { tracks } = buildAllTracksFromMdb(payload)
  const track = tracks[0]

  it('reaches from the track begin to its end', () => {
    expect(tracks).toHaveLength(1)
    const h = track.heights
    expect(h.length).toBeGreaterThan(1)
    expect(h[0].station).toBe(0)
    expect(h[h.length - 1].station).toBeCloseTo(trackLength(track), 6)
    for (let i = 1; i < h.length; i++) expect(h[i].station).toBeGreaterThan(h[i - 1].station)
  })

  it('keeps the gradients of the chain it was cut from', () => {
    const h = track.heights
    // The track begins inside the first slope and ends inside the last, so the
    // ends are interpolated and everything between is the chain's own.
    expect(slope(h[0], h[1])).toBeCloseTo(0.88889, 2)
    expect(slope(h[h.length - 2], h[h.length - 1])).toBeCloseTo(3.49762, 2)
    expect(h.filter(p => p.rv).map(p => Math.round(p.rv))).toEqual([16000, 16000, 14893, 18564])
  })

  it('is a height the whole way, not a hole where the file says nothing', () => {
    for (const p of track.heights) expect(Number.isFinite(p.z)).toBe(true)
    const z = track.heights.map(p => p.z)
    expect(Math.min(...z)).toBeGreaterThan(11)
    expect(Math.max(...z)).toBeLessThan(15)
  })

  it('says how many tracks got one', () => {
    const { errors } = buildAllTracksFromMdb(payload)
    expect(errors.join(' ')).toMatch(/1 von 1 Gleisen bekommen eine/)
  })
})

describe('a chain with gaps in it', () => {
  it('fills a missing station from the lengths around it', () => {
    const station = new Map([['A', 1000], ['D', 1300]])
    expect(stationsAlong(['A', 'B', 'C', 'D'], [0, 100, 200, 300], station))
      .toEqual([1000, 1100, 1200, 1300])
  })

  it('follows the stationing backwards where the chain does', () => {
    const station = new Map([['A', 1300], ['D', 1000]])
    expect(stationsAlong(['A', 'B', 'C', 'D'], [0, 100, 200, 300], station))
      .toEqual([1300, 1200, 1100, 1000])
  })

  it('has nothing to say when no point of it is stationed', () => {
    expect(stationsAlong(['A', 'B'], [0, 100], new Map())).toBe(null)
  })

  it('puts a station aside that the lengths contradict', () => {
    // B says it is 400 m along where the elements make it 100. Taken as it
    // stands it would move C and D 300 m down the line with it.
    const station = new Map([['A', 1000], ['B', 1400], ['C', 1200], ['D', 1300]])
    expect(stationsAlong(['A', 'B', 'C', 'D'], [0, 100, 200, 300], station))
      .toEqual([1000, 1100, 1200, 1300])
  })

  it('keeps a Fehlprofil small enough to be the measurement', () => {
    // Four metres over a kilometre is the stationing and the geometry
    // disagreeing, not a different place.
    const station = new Map([['A', 1000], ['B', 2004]])
    expect(stationsAlong(['A', 'B'], [0, 1000], station)).toEqual([1000, 2004])
  })

  it('carries a missing height along the gradient instead of dropping the chain', () => {
    const thin = parseMdbPayload({
      ...fixture,
      heights: fixture.heights.filter((h, i) => i > 0),   // the first point loses its height
    })
    const { chains, refused } = mdbGradientChains(thin)
    expect(refused).toBe(0)
    // Carried over the 885 m slope that follows it, which lands within a
    // hundredth of a millimetre of the height the file states there.
    expect(chains[0].points[0].z).toBeCloseTo(
      mdbGradientChains(payload).chains[0].points[0].z, 4)
  })
})

describe('a track the file states no gradient for', () => {
  it('gets none rather than a level one', () => {
    const gradientPads = new Set(fixture.gradients.flatMap(g => [g.pad1, g.pad2]))
    const other = parseMdbPayload({
      ...fixture,
      // The same gradient, stationed on a line the track knows nothing of.
      stations: fixture.stations.map(s => (gradientPads.has(s.pad)
        ? { ...s, strecke: '9999' } : s)),
    })
    const { tracks } = buildAllTracksFromMdb(other)
    expect(tracks[0].heights).toBeUndefined()
  })

  it('refuses a piece that is not as long as the track it is for', () => {
    const chains = [{
      line: '1150', bst: new Set(['1150']), sys: 'V00',
      from: 0, to: 2000, points: [{ station: 0, z: 10 }, { station: 2000, z: 12 }],
    }]
    const ask = (length) => gradientForTrack(chains,
      { line: '1150', bst: new Set(['1150']), begin: 0, end: 1000, length })
    expect(ask(1000)).toHaveLength(2)
    expect(ask(1005)).toHaveLength(2)     // a per cent of stretching is the two measurements
    expect(ask(1200)).toBe(null)          // a fifth of the track is not
  })

  it('refuses a chain that reaches over only part of the track', () => {
    const chains = [{
      line: '1150', bst: new Set(['1150']), sys: 'V00',
      from: 0, to: 500, points: [{ station: 0, z: 10 }, { station: 500, z: 11 }],
    }]
    expect(gradientForTrack(chains,
      { line: '1150', bst: new Set(['1150']), begin: 0, end: 800, length: 800 })).toBe(null)
    expect(gradientForTrack(chains,
      { line: '1150', bst: new Set(['1150']), begin: 100, end: 400, length: 300 })).toHaveLength(2)
  })
})
