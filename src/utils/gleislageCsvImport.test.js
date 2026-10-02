import { describe, it, expect } from 'vitest'
import {
  CSV_EPSG, TYPE_STRAIGHT, TYPE_ARC, TYPE_CLOTHOID, CANT_CONSTANT,
  parseGleislageCsv, parseUeberhoehungCsv, listStrecken, buildTracksFromCsv,
} from './gleislageCsvImport'
import { arcFrom, straightFrom } from './elementFactory'

// A small export of line 6340 in DB_REF GK zone 3, written the way the
// Gleislage export writes it: one row per element, each with its own start
// vertex (northing first), start bearing in gon and length.
const START = { easting: 3500000, northing: 5700000, zone: CSV_EPSG }
const straight = straightFrom(START, 90, 100)
const at = (node) => ({ easting: node[0], northing: node[1], zone: CSV_EPSG })
const arc = arcFrom(at(straight.endNode), 90, 50, 500)

const HEADER = 'EELL_ELTYP_WL_TEXT_L,EELL_PKT_ADRESSE_ANF,EELL_PKT_ADRESSE_END,EELL_LSYS_WL_TEXT_KURZ,'
  + 'EELL_WINKEL_ANF,EELL_PARAM1,EELL_PARAM2,EELL_PARAM3,STR_STRECKENNUMMER,EELL_GEO_COMPOUND'
const geo = ([e, n]) => `"MULTILINESTRING((${n} ${e}, ${n + 1} ${e + 1}))"`
const row = (typ, anf, end, gon, p1, p2, p3, node, strecke = '6340', lsys = 'DR0') =>
  [typ, anf, end, lsys, gon, p1, p2, p3, strecke, geo(node)].join(',')

const CSV = '﻿' + [
  HEADER,
  row(TYPE_STRAIGHT, 'A', 'B', 100, 100, 0, 0, straight.startNode),
  row(TYPE_ARC, 'B', 'C', 100, 50, 500, 0, arc.startNode),
  // No start bearing: it carries on from the arc's end tangent.
  row(TYPE_CLOTHOID, 'C', 'D', 0, 30, 500, 0, arc.endNode),
  // The second leg of a switch at B — a chain of its own.
  row(TYPE_STRAIGHT, 'B', 'E', 100, 40, 0, 0, straight.endNode),
  // The same element once more in the second coordinate system.
  row(TYPE_STRAIGHT, 'A', 'B', 100, 100, 0, 0, straight.startNode, '6340', 'DA0'),
  row('Übergangsbogen S-Form', 'X', 'Y', 100, 20, 0, 0, straight.startNode),
  row(TYPE_STRAIGHT, 'P', 'Q', 100, 10, 0, 0, straight.startNode, '5550'),
].join('\r\n') + '\r\n'

const CANT_CSV = [
  'EELU_ELTYP_WL_TEXT_L,EELU_PKT_ADRESSE_ANF,EELU_PKT_ADRESSE_END,EELU_PARAM1,EELU_PARAM2,EELU_PARAM3,STR_STRECKENNUMMER',
  `${CANT_CONSTANT},B,C,50,60,60,6340`,
  'Rampe,C,D,30,60,0,6340',
].join('\n')

describe('reading the export', () => {
  it('keeps the columns it needs, strips a BOM and reads quoted fields', () => {
    const rows = parseGleislageCsv(CSV)
    expect(rows).toHaveLength(7)
    expect(rows[0]).toMatchObject({ typ: TYPE_STRAIGHT, anf: 'A', end: 'B', lsys: 'DR0', strecke: '6340', length: 100 })
    expect(rows[0].bearing).toBeCloseTo(90, 12)
    expect(rows[0].start[0]).toBeCloseTo(START.easting, 6)       // easting first again
    expect(rows[0].start[1]).toBeCloseTo(START.northing, 6)
    expect(rows[1]).toMatchObject({ p2: 500, p3: 0 })
  })

  it('names the columns a file lacks', () => {
    expect(() => parseGleislageCsv('EELL_ELTYP_WL_TEXT_L,STR_STRECKENNUMMER\nGerade,1\n'))
      .toThrow(/Spalten fehlen: EELL_PKT_ADRESSE_ANF/)
  })

  it('reads a cant export', () => {
    expect(parseUeberhoehungCsv(CANT_CSV)[0]).toEqual({
      typ: CANT_CONSTANT, anf: 'B', end: 'C', strecke: '6340', length: 50, u1: 60, u2: 60,
    })
  })

  it('lists the lines in numeric order with their row counts', () => {
    const rows = [...parseGleislageCsv(CSV), { strecke: '10000' }, { strecke: '' }]
    expect(listStrecken(rows)).toEqual([
      { strecke: '5550', count: 1 }, { strecke: '6340', count: 6 }, { strecke: '10000', count: 1 },
    ])
  })
})

describe('building the tracks of one line', () => {
  const rows = parseGleislageCsv(CSV)

  it('orders the rows into chains, the switch leg as a chain of its own', () => {
    const { tracks } = buildTracksFromCsv(rows, '6340')
    expect(tracks.map(t => [t.name, t.elements.length])).toEqual([['6340.001', 3], ['6340.002', 1]])
    expect(tracks[0]).toMatchObject({ lineNumber: '6340', epsg: CSV_EPSG })
    const [s, a, c] = tracks[0].elements
    expect(s).toMatchObject({ elementType: 0, length: 100 })
    expect(a).toMatchObject({ elementType: 1, radius: 500 })
    expect(c).toMatchObject({ elementType: 2, r1: 500, r2: null, transitionType: 'clothoid' })
    // The clothoid took the arc's end tangent, so it meets it without a gap.
    expect(c.bearing).toBeCloseTo(arc.endBearing, 6)
  })

  it('reports what it skipped or derived, and no junction gaps', () => {
    const { errors } = buildTracksFromCsv(rows, '6340')
    expect(errors.some(e => /1 doppelte Elemente/.test(e))).toBe(true)
    expect(errors.some(e => /1 Elemente mit S-Form/.test(e))).toBe(true)
    expect(errors.some(e => /^1 Elemente ohne Richtungswinkel/.test(e))).toBe(true)
    expect(errors.some(e => /Anschluss-Abweichung/.test(e))).toBe(false)
  })

  it('puts a constant cant on the arc, signed by its curve', () => {
    const { tracks, errors } = buildTracksFromCsv(rows, '6340', parseUeberhoehungCsv(CANT_CSV))
    expect(tracks[0].elements[1].cant).toBe(60)
    expect(tracks[0].elements[0].cant ?? 0).toBe(0)
    expect(errors.some(e => /2 von 4 Elementen ohne Überhöhungssatz/.test(e))).toBe(true)
  })

  it('refuses coordinates that do not belong to the declared plane', () => {
    const { tracks, errors } = buildTracksFromCsv(rows, '6340', null, { sourceEpsg: 25832 })
    expect(tracks).toEqual([])
    expect(errors.at(-1)).toMatch(/sehen nicht nach EPSG 25832 aus/)
  })

  it('says so when the line is not in the file', () => {
    expect(buildTracksFromCsv(rows, '9999')).toEqual({ tracks: [], errors: ['Keine Zeilen für Strecke 9999 gefunden.'] })
  })

  it('hands each chain to heightsFor and keeps what it returns', () => {
    const { tracks } = buildTracksFromCsv(rows, '6340', null, {
      heightsFor: (chain) => (chain[0].anf === 'A' ? [{ station: 0, height: 100 }] : []),
    })
    expect(tracks[0].heights).toEqual([{ station: 0, height: 100 }])
    expect(tracks[1]).not.toHaveProperty('heights')
  })
})
