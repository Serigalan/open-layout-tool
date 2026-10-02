import { describe, it, expect } from 'vitest'
import {
  QUERSCHNITT_KATALOG, GAUGE_PROFILES, DEFAULT_GAUGE_PROFILE, gaugeProfile, gaugeProfileRing,
  gaugeProfileAreas, gaugeProfileLabelKey, LICHTRAUM_SOURCE,
} from './gaugeProfiles'
import { translations } from '../locales/i18n'

describe('the profile table', () => {
  it('names a default that is in it', () => {
    expect(GAUGE_PROFILES[DEFAULT_GAUGE_PROFILE]).toBeDefined()
  })

  it('is the Lichtraum of Ril 800.0130A01 — Hauptgleise, Nebengleise and S-Bahn', () => {
    expect(Object.keys(GAUGE_PROFILES)).toEqual(['hauptgleis', 'nebengleis', 's_bahn'])
    expect(LICHTRAUM_SOURCE).toBe('DB Ril 800.0130A01')
    expect(GAUGE_PROFILES.nebengleis.points)
      .toEqual([[0, 0], [2200, 0], [2200, 3900], [1860, 4900], [0, 4900]])
  })

  it('names itself to the reader in both languages, apart from the German source title', () => {
    const key = `regelwerk_title_${QUERSCHNITT_KATALOG.katalog.id}`
    for (const lang of Object.keys(translations)) {
      expect(typeof translations[lang][key], lang).toBe('string')
    }
  })

  it('states the S-Bahn profile with its three named areas', () => {
    const p = GAUGE_PROFILES.s_bahn
    expect(p.points).toEqual([[0, 0], [2400, 0], [2400, 3173], [1075, 4800], [0, 4800]])
    expect(p.einragungen).toHaveLength(3)
    expect(p.areaKinds).toEqual(['bahnsteig', 'signal_mast', 'tunnel'])
    // The inner corners of the signal and tunnel areas lie on the chamfer of the outline.
    const chamfer = (y) => 3173 + (2400 - y) / (2400 - 1075) * (4800 - 3173)
    expect(p.einragungen[1][2][1]).toBeCloseTo(chamfer(2100), 0)
    expect(p.einragungen[2][2][1]).toBeCloseTo(chamfer(1900), 0)
  })

  it('names every profile and every named area in both languages', () => {
    for (const p of Object.values(GAUGE_PROFILES)) {
      expect(p.areaKinds.length === 0 || p.areaKinds.length === p.einragungen.length, p.id).toBe(true)
      for (const kind of p.areaKinds) {
        for (const lang of Object.keys(translations)) {
          expect(typeof translations[lang][`constraints_querschnitt_einragung_${kind}`], `${lang}.${kind}`).toBe('string')
        }
      }
    }
  })

  it('names every profile in both languages', () => {
    const languages = Object.keys(translations)
    for (const id of Object.keys(GAUGE_PROFILES)) {
      for (const lang of languages) {
        expect(typeof translations[lang][gaugeProfileLabelKey(id)], `${lang}.${id}`).toBe('string')
      }
    }
  })

  it('states every contour from the centre line outwards, over the running plane', () => {
    for (const p of Object.values(GAUGE_PROFILES)) {
      expect(p.points.length).toBeGreaterThan(2)
      expect(p.points.every(([y, z]) => y >= 0 && z >= 0)).toBe(true)
      for (const area of p.einragungen) {
        expect(area.every(([y, z]) => y >= 0 && z >= 0)).toBe(true)
      }
    }
  })

  it('falls back to the default where a project names a profile that is gone', () => {
    expect(gaugeProfile('a-profile-that-was-removed')).toBe(GAUGE_PROFILES[DEFAULT_GAUGE_PROFILE])
    // The profile every project was drawn against before the Ril's came in.
    expect(gaugeProfile('en15273_gc')).toBe(GAUGE_PROFILES.hauptgleis)
  })
})

// Inside or on the edge of a closed outline — an area may share its border
// with the outline it is cut out of, and most of them do. The Ril states whole
// millimetres, so a corner on a sloping edge is on it within half of one.
const ROUNDING = 0.5
function inside([py, pz], ring) {
  const onEdge = ring.slice(1).some(([y2, z2], i) => {
    const [y1, z1] = ring[i]
    const cross = (y2 - y1) * (pz - z1) - (z2 - z1) * (py - y1)
    return Math.abs(cross) / Math.hypot(y2 - y1, z2 - z1) <= ROUNDING
      && py >= Math.min(y1, y2) - 1e-9 && py <= Math.max(y1, y2) + 1e-9
      && pz >= Math.min(z1, z2) - 1e-9 && pz <= Math.max(z1, z2) + 1e-9
  })
  if (onEdge) return true
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, zi] = ring[i], [yj, zj] = ring[j]
    if ((zi > pz) !== (zj > pz) && py < ((yj - yi) * (pz - zi)) / (zj - zi) + yi) hit = !hit
  }
  return hit
}

describe('the catalogue checked against itself', () => {
  it('names every line category in both languages', () => {
    const languages = Object.keys(translations)
    const kategorien = [...new Set(QUERSCHNITT_KATALOG.streckenquerschnitte.rows.map(r => r.kategorie))]
    for (const kategorie of kategorien) {
      for (const lang of languages) {
        const key = `constraints_querschnitt_kategorie_${kategorie}`
        expect(typeof translations[lang][key], `${lang}.${key}`).toBe('string')
      }
    }
  })


  it('states a formation width that is the track spacing plus both edges', () => {
    for (const row of QUERSCHNITT_KATALOG.streckenquerschnitte.rows) {
      expect(row.planumsbreite, row.kategorie)
        .toBeCloseTo(row.gleisabstand + 2 * row.planumskante, 9)
    }
  })

  it('keeps every area that may be reached into inside the outline it belongs to', () => {
    for (const [id, p] of Object.entries(GAUGE_PROFILES)) {
      const ring = gaugeProfileRing(p.points)
      for (const area of p.einragungen) {
        for (const point of area) expect(inside(point, ring), `${id} ${point}`).toBe(true)
      }
    }
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

describe('gaugeProfileAreas', () => {
  it('closes each area and lays it on both sides of the track', () => {
    expect(gaugeProfileAreas([[[2200, 0], [2200, 3900], [2500, 3050], [2500, 0]]])).toEqual([
      [[2200, 0], [2200, 3900], [2500, 3050], [2500, 0], [2200, 0]],
      [[-2200, 0], [-2200, 3900], [-2500, 3050], [-2500, 0], [-2200, 0]],
    ])
  })

  it('keeps an area on the centre line once — it is its own mirror image', () => {
    expect(gaugeProfileAreas([[[0, 0], [0, 4900]]])).toEqual([[[0, 0], [0, 4900], [0, 0]]])
  })

  it('answers with nothing where a profile states no areas', () => {
    expect(gaugeProfileAreas(undefined)).toEqual([])
  })
})
