import { describe, it, expect } from 'vitest'
import { parseMdbPayload, buildAllTracksFromMdb } from './mdbImport'
import { dropCoveredTracks, COVER_TOL } from './mdbAxisCleanup'
import { endPointStraightUtm, endPointCurvedUtm } from '../geometry/elementUtils'

/**
 * Axis fragments stated twice. The survey is laid out the way the interface
 * delivers one — points in a Lagesystem, elements between them, grouped by
 * their Trasse — on one straight stem of 400 m, due east:
 *
 *   Stamm   the stem
 *   Kopie   its first 100 m again, under other point addresses
 *   Daneben the same 100 m, 2 cm north of it
 *   Halb    from 350 m on: 50 m on the stem, 50 m beyond its end
 *   Zweig   a 190 – 1:9 branch leaving it at 200 m
 */

const SYS = 'ER0'
const EPSG = 5684
const DEG2GON = 1 / 0.9
const ALPHA = Math.atan(1 / 9)

const p = (e, n) => ({ easting: e, northing: n, zone: EPSG })
const S0 = p(4480000, 5765000)
const at = (m) => endPointStraightUtm(S0, 90, m)
const TOE = at(200)
const Z1 = endPointCurvedUtm(TOE, 90, 190 * ALPHA, 190)

const pt = (pad, u) => ({ pad, sys: SYS, y: u.easting, x: u.northing })
const el = (pad1, pad2, trasse, typ, length, bearing, p2 = 0) => ({
  pad1, pad2, sys: SYS, typ, p1: length, p2, p3: 0,
  ariwi: bearing * DEG2GON, text: `Trasse:${trasse}`, err: 0,
})

const survey = (extra = [], points = []) => parseMdbPayload({
  points: [
    ...points,
    pt('S0', S0), pt('S1', at(400)), pt('K0', S0), pt('K1', at(100)),
    pt('D0', p(S0.easting, S0.northing + 0.02)), pt('D1', p(at(100).easting, at(100).northing + 0.02)),
    pt('H0', at(350)), pt('H1', at(450)), pt('TOE', TOE), pt('Z1', Z1),
  ],
  elements: [
    el('S0', 'S1', 'Stamm', 0, 400, 90),
    el('K0', 'K1', 'Kopie', 0, 100, 90),
    el('D0', 'D1', 'Daneben', 0, 100, 90),
    el('H0', 'H1', 'Halb', 0, 100, 90),
    el('TOE', 'Z1', 'Zweig', 1, 190 * ALPHA, 90, 190),
    ...extra,
  ],
})

const names = (tracks) => tracks.map(t => t.name).sort()

describe('axis fragments stated twice', () => {
  const { tracks } = buildAllTracksFromMdb(survey())
  const res = dropCoveredTracks(tracks)

  it('leaves out a track that lies entirely on another, and names what it lies on', () => {
    expect(res.dropped.map(d => [d.track.name, d.by.name])).toEqual([['Kopie.001', 'Stamm.001']])
    expect(names(res.tracks)).toEqual(['Daneben.001', 'Halb.001', 'Stamm.001', 'Zweig.001'])
  })

  it('keeps a track beside another once it is further off than the tolerance', () => {
    expect(COVER_TOL).toBeLessThan(0.02)
    expect(res.tracks.some(t => t.name === 'Daneben.001')).toBe(true)
  })

  it('names a track that lies on another for half its length, and keeps it', () => {
    const half = res.partial.find(o => o.track.name === 'Halb.001')
    expect(half.by.name).toBe('Stamm.001')
    expect(half.share).toBeCloseTo(0.5, 1)
  })

  it('does not take a branch for a copy of its stem', () => {
    expect(res.partial.some(o => o.track.name === 'Zweig.001')).toBe(false)
  })

  it('keeps the longer of two tracks that cover each other, the first of two equal ones', () => {
    // The whole stem once more, under point addresses of its own.
    const twice = buildAllTracksFromMdb(survey(
      [el('W0', 'W1', 'Zwilling', 0, 400, 90)],
      [pt('W0', S0), pt('W1', at(400))],
    )).tracks
    const out = dropCoveredTracks(twice)
    const gone = out.dropped.map(d => d.track.name)
    expect(gone).toContain('Kopie.001')
    // Stamm and Zwilling are one stretch: exactly one of them stays.
    expect(['Stamm.001', 'Zwilling.001'].filter(n => gone.includes(n))).toHaveLength(1)
    // The copy is named with the track that stays.
    const kept = names(out.tracks)
    for (const d of out.dropped) expect(kept).toContain(d.by.name)
  })

  it('leaves tracks of different planes alone', () => {
    const other = tracks.map(t => (t.name === 'Kopie.001' ? { ...t, epsg: 5683 } : t))
    expect(dropCoveredTracks(other).dropped).toEqual([])
  })
})
