import { describe, it, expect } from 'vitest'
import {
  GAUGE_PROFILES, DEFAULT_GAUGE_PROFILE, gaugeProfile, gaugeProfileRing, gaugeProfileGuides,
} from './gaugeProfiles'

describe('the profile table', () => {
  it('names a default that is in it', () => {
    expect(GAUGE_PROFILES[DEFAULT_GAUGE_PROFILE]).toBeDefined()
  })

  it('states every contour from the centre line outwards, over the running plane', () => {
    for (const p of Object.values(GAUGE_PROFILES)) {
      expect(p.points.length).toBeGreaterThan(2)
      expect(p.points.every(([y, z]) => y >= 0 && z >= 0)).toBe(true)
    }
  })

  it('falls back to the default where a project names a profile that is gone', () => {
    expect(gaugeProfile('a-profile-that-was-removed')).toBe(GAUGE_PROFILES[DEFAULT_GAUGE_PROFILE])
  })
})

describe('gaugeProfileRing', () => {
  const half = [[0, 0], [1275, 0], [2500, 760], [0, 4900]]

  it('mirrors the stated half and closes the ring', () => {
    expect(gaugeProfileRing(half)).toEqual([
      [0, 0], [1275, 0], [2500, 760], [0, 4900],
      [-2500, 760], [-1275, 0], [0, 0],
    ])
  })

  it('keeps a point on the centre line once — it is its own mirror image', () => {
    const ring = gaugeProfileRing(half)
    expect(ring.filter(([y, z]) => y === 0 && z === 4900)).toHaveLength(1)
  })

  it('is symmetric about the centre line, so a contour cannot lean by a typing slip', () => {
    const ring = gaugeProfileRing(GAUGE_PROFILES[DEFAULT_GAUGE_PROFILE].points)
    const mirrored = ring.map(([y, z]) => [y === 0 ? 0 : -y, z])
    for (const p of mirrored) expect(ring).toContainEqual(p)
  })

  it('closes a half that does not end on the centre line', () => {
    const ring = gaugeProfileRing([[0, 0], [1000, 500], [900, 4000]])
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  it('answers with nothing for a profile that states no points', () => {
    expect(gaugeProfileRing([])).toEqual([])
  })
})

describe('gaugeProfileGuides', () => {
  it('draws each reference line on both sides of the track', () => {
    expect(gaugeProfileGuides([[[1275, 0], [2500, 0], [2500, 760]]])).toEqual([
      [[1275, 0], [2500, 0], [2500, 760]],
      [[-1275, 0], [-2500, 0], [-2500, 760]],
    ])
  })

  it('keeps a line on the centre line once — it is its own mirror image', () => {
    expect(gaugeProfileGuides([[[0, 0], [0, 4900]]])).toEqual([[[0, 0], [0, 4900]]])
  })

  it('answers with nothing where a profile states no reference lines', () => {
    expect(gaugeProfileGuides(undefined)).toEqual([])
  })
})
