import { describe, it, expect } from 'vitest'
import {
  parseMdbPayload, mdbRows, listMdbStrecken, buildAllTracksFromMdb, epsgForLagesystem,
} from './mdbImport'
import { crsName, utmToWgs84 } from './coordinateUtils'
import fixture from '../test/fixtures/mdb_ohne_abschnitt.json'

/**
 * An export without Satzart 33.
 *
 * The delivered GND_6403_AS-AT carries Satzarten 11 to 25 and nothing else:
 * points, elements, cant — the alignment, but no Gleisabschnitt, no Knoten, no
 * Strecke. Every element in it used to be counted as "gehört zu keinem
 * Gleisabschnitt" and dropped, so the file imported as nothing at all.
 *
 * The fixture is two Trassen of that file: `6857000S` in `EC9` — 42/83, the
 * Krassowski frame of the eastern states — and `Gleis_5` in `ER0`, DB_REF, in
 * the same 12° strip. Nine of its eleven points are stated in both systems.
 */

const payload = parseMdbPayload(fixture)

describe('an element that belongs to no Gleisabschnitt', () => {
  it('is filed under the Trasse the file names, not thrown away', () => {
    const { rows, errors } = mdbRows(payload)
    expect(rows).toHaveLength(9)
    expect(new Set(rows.map(r => r.strecke))).toEqual(new Set(['6857000S', 'Gleis_5']))
    expect(errors.join(' ')).toMatch(/9 Elemente gehören zu keinem Gleisabschnitt/)
  })

  it('offers those names in the line picker, with what hangs on each', () => {
    expect(listMdbStrecken(payload)).toEqual([
      { strecke: '6857000S', count: 5 },
      { strecke: 'Gleis_5', count: 4 },
    ])
  })

  it('falls back to the Betriebsstelle where the file names no Trasse', () => {
    const bare = parseMdbPayload({
      ...fixture,
      elements: fixture.elements.map(e => ({ ...e, text: 'interaktive GT' })),
    })
    expect(listMdbStrecken(bare).map(s => s.strecke)).toEqual(['Bst 6403'])
  })

  it('builds the chains the addresses describe, in the plane each states', () => {
    const { tracks } = buildAllTracksFromMdb(payload)
    expect(tracks).toHaveLength(2)
    const byName = Object.fromEntries(tracks.map(t => [t.lineNumber, t]))
    expect(byName['6857000S'].elements).toHaveLength(5)
    expect(byName['6857000S'].epsg).toBe(epsgForLagesystem('EC9'))
    expect(crsName(byName['6857000S'].epsg)).toBe('42/83 / GK Zone 4')
    expect(byName.Gleis_5.elements).toHaveLength(4)
    expect(byName.Gleis_5.epsg).toBe(5684)
  })

  it('loses nothing on the way in', () => {
    const { tracks } = buildAllTracksFromMdb(payload)
    const built = tracks.reduce((n, t) => n + t.elements.length, 0)
    expect(built).toBe(payload.elements.length)
  })
})

describe('42/83 against DB_REF, the same points in both', () => {
  const by = new Map()
  for (const p of payload.points) {
    if (!by.has(p.pad)) by.set(p.pad, {})
    by.get(p.pad)[p.sys] = [p.y, p.x]
  }
  const apart = [...by.values()].filter(v => v.EC9 && v.ER0).map((v) => {
    const a = utmToWgs84(v.EC9[0], v.EC9[1], epsgForLagesystem('EC9'))
    const b = utmToWgs84(v.ER0[0], v.ER0[1], epsgForLagesystem('ER0'))
    return Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 111320)
  }).sort((x, y) => x - y)

  it('lands within a decimetre, which is what EPSG rates the shift at', () => {
    // 42/83 is the Krassowski frame and DB_REF is Bessel: in the plane the
    // same point sits 22 m east and 585 m south of itself. Converted to WGS84
    // from either side it has to come back together, and does — 8.9 cm over
    // the 228 shared points of the whole file, flat across the area. The
    // parameter set is EPSG's "Pulkovo 1942(83) to ETRS89 (2)", rated 0.1 m;
    // the older one (1674) lands at 0.30 m here and the 3-parameter shift
    // epsg.io hands out at 3.10 m.
    expect(apart).toHaveLength(9)
    expect(apart[Math.floor(apart.length / 2)]).toBeLessThan(0.10)
  })

  it('leaves the two points the file itself disagrees on standing', () => {
    // 6403AS 1877 and 1878 come back 3.34 m apart: their two records describe
    // different positions, 2 m beyond what the datum accounts for. Five of the
    // file's 228 shared points are like that, two of them by 590 m — a DB_REF
    // value filed under the 42/83 key. Nothing a transformation can mend, and
    // nothing this may quietly average away either.
    expect(apart.filter(d => d > 0.10)).toHaveLength(2)
    expect(Math.max(...apart)).toBeLessThan(4)
  })
})

describe('two elements that start at the same point', () => {
  // A switch: one address, two legs. Both are alignment, and the chain builder
  // used to keep one row per address — the second leg was overwritten before
  // the walk began and vanished without a word.
  const fork = parseMdbPayload({
    points: [
      { pad: 'A', sys: 'ER0', y: 4480000, x: 5765000 },
      { pad: 'B', sys: 'ER0', y: 4480100, x: 5765000 },
      { pad: 'C', sys: 'ER0', y: 4480200, x: 5765000 },
      { pad: 'D', sys: 'ER0', y: 4480200, x: 5765100 },
    ],
    elements: [
      { pad1: 'A', pad2: 'B', sys: 'ER0', typ: 0, p1: 100, ariwi: 100, text: 'Trasse:X', err: 0 },
      { pad1: 'B', pad2: 'C', sys: 'ER0', typ: 0, p1: 100, ariwi: 100, text: 'Trasse:X', err: 0 },
      { pad1: 'B', pad2: 'D', sys: 'ER0', typ: 0, p1: 141.42, ariwi: 50, text: 'Trasse:X', err: 0 },
    ],
  })

  it('keeps both legs', () => {
    const { tracks } = buildAllTracksFromMdb(fork)
    const built = tracks.reduce((n, t) => n + t.elements.length, 0)
    expect(built).toBe(3)
    expect(tracks.length).toBeGreaterThan(1)
  })
})
