import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import { epsgForLagesystem, parseMdbPayload, buildTracksFromMdb, mdbRows } from './mdbImport'
import { crsName, utmToWgs84 } from './coordinateUtils'
import { loadNtv2Grid } from './ntv2Grid'
import fixture from '../test/fixtures/mdb_thueringen.json'

/**
 * The Lagesysteme of the DB ASCII interface, and the one thing that can be
 * checked without a second source: the database states the same physical point
 * in two of them. A point of Strecke 613 is delivered as `DB0` — PD/83, the
 * Thüringen datum, 9° strip — and again as `DR0`, DB_REF in the same strip.
 * Convert both to WGS84 and they have to land on each other; how far apart
 * they land is the whole datum chain measured end to end.
 *
 * The fixture is a Gleisabschnitt of the delivered test database (Strecke 613,
 * straight–arc–straight) with its four points in both systems.
 */

const payload = parseMdbPayload(fixture)
const realFetch = globalThis.fetch

/** Metres between two WGS84 points, near enough at this latitude. */
const apart = (a, b) => Math.hypot(
  (a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180),
  (a[1] - b[1]) * 111320,
)

/** The same point in both systems, as the file states it. */
const pairs = () => {
  const by = new Map()
  for (const p of payload.points) {
    if (!by.has(p.pad)) by.set(p.pad, {})
    by.get(p.pad)[p.sys] = [p.y, p.x]
  }
  return [...by.values()].filter(v => v.DB0 && v.DR0)
}

const spread = () => pairs().map(v => apart(
  utmToWgs84(v.DB0[0], v.DB0[1], epsgForLagesystem('DB0')),
  utmToWgs84(v.DR0[0], v.DR0[1], epsgForLagesystem('DR0')),
))

describe('reading a Lagesystem code', () => {
  it('takes the strip from the first letter', () => {
    expect(epsgForLagesystem('CR0')).toBe(5682)   // 6°E  → DB_REF zone 2
    expect(epsgForLagesystem('DR0')).toBe(5683)   // 9°E  → zone 3
    expect(epsgForLagesystem('ER0')).toBe(5684)   // 12°E → zone 4
    expect(epsgForLagesystem('FR0')).toBe(5685)   // 15°E → zone 5
  })

  it('takes the frame from the second', () => {
    expect(crsName(epsgForLagesystem('EA0'))).toBe('DHDN / GK Zone 4')
    expect(crsName(epsgForLagesystem('DB0'))).toBe('PD/83 / GK Zone 3')
    expect(crsName(epsgForLagesystem('EC0'))).toBe('42/83 / GK Zone 4')
    expect(crsName(epsgForLagesystem('ER0'))).toBe('DB_REF / GK Zone 4')
  })

  it('gives Berlin its Soldner net, which has no strip', () => {
    expect(epsgForLagesystem('ES0')).toBe(3068)
    expect(epsgForLagesystem('CS0')).toBe(3068)
    expect(crsName(3068)).toBe('DHDN / Soldner Berlin')
  })

  it('says nothing rather than something for a frame that has no plane there', () => {
    // PD/83 is Thüringen, so zones 3 and 4; 42/83 does not reach the 6° strip.
    expect(epsgForLagesystem('CB0')).toBe(null)
    expect(epsgForLagesystem('FB0')).toBe(null)
    expect(epsgForLagesystem('CC0')).toBe(null)
    expect(epsgForLagesystem('XY0')).toBe(null)
    expect(epsgForLagesystem('')).toBe(null)
    expect(epsgForLagesystem(null)).toBe(null)
  })

  it('reports the code it cannot place instead of dropping the elements', () => {
    const odd = parseMdbPayload({
      ...fixture,
      points: fixture.points.map(p => ({ ...p, sys: p.sys === 'DB0' ? 'CB0' : p.sys })),
      elements: fixture.elements.map(e => ({ ...e, sys: 'CB0' })),
    })
    const { tracks, errors } = buildTracksFromMdb(odd, '613')
    expect(tracks).toHaveLength(0)
    expect(errors.join(' ')).toMatch(/Lagesystem CB0 ist nicht zugeordnet/)
  })
})

describe('a Thüringen alignment', () => {
  it('is read in its own datum, not bent into the DHDN next door', () => {
    const { tracks } = buildTracksFromMdb(payload, '613')
    expect(tracks).toHaveLength(1)
    expect(tracks[0].lagesystem).toBe('DB0')
    expect(tracks[0].epsg).toBe(3396)
    expect(tracks[0].elements).toHaveLength(3)
  })

  it('keeps the elements the file states, in the plane the file states them in', () => {
    const { rows } = mdbRows(payload)
    expect(rows.every(r => r.lsys === 'DB0')).toBe(true)
    const { tracks } = buildTracksFromMdb(payload, '613')
    const [e] = tracks[0].elements
    // 3 591 048 / 5 650 030 in the 9° strip: PD/83 states a Gauss-Krüger
    // coordinate exactly as DB_REF does, which is why only the datum tells
    // them apart.
    expect(e.startNode[0]).toBeGreaterThan(3_500_000)
    expect(e.startNode[0]).toBeLessThan(3_700_000)
  })
})

describe('PD/83 against DB_REF, the same points in both', () => {
  it('lands within a decimetre on the 7-parameter shift alone', () => {
    // No grid loaded yet: both datums are on their EPSG parameter sets, and
    // the four points come out 5.6–5.8 cm apart.
    const d = spread()
    expect(d).toHaveLength(4)
    expect(Math.max(...d)).toBeLessThan(0.10)
  })

  describe('once the base grids are there', () => {
    beforeAll(async () => {
      globalThis.fetch = async (url) => {
        const file = new URL(`../../grids/${String(url).split('/').pop()}`, import.meta.url)
        if (!fs.existsSync(file)) return realFetch(url)
        const buf = fs.readFileSync(file)
        return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
      }
      await loadNtv2Grid()
    })
    afterAll(() => { globalThis.fetch = realFetch })

    it('lands within a few centimetres — Thüringen’s own grid against DB_REF', () => {
      // 2.8–2.9 cm, half of what the parameter set gets to. The file's own two
      // readings of these points are 28 cm apart in the plane, so this is the
      // datum shift doing its work, not two numbers that were close anyway.
      const d = spread()
      expect(Math.max(...d)).toBeLessThan(0.05)
    })
  })
})
