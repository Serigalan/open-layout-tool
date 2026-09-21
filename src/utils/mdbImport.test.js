import { describe, it, expect } from 'vitest'
import {
  parseBauform, parseMdbPayload, splitKnoten, mdbRows,
  listMdbStrecken, buildTracksFromMdb, mdbSwitchInventory, epsgForLagesystem,
} from './mdbImport'
import { expectValidTrack } from '../test/chainInvariants'
import { recalcAbsLengths } from '../storage'
import fixture from '../test/fixtures/mdb_ausschnitt.json'

/**
 * AP 6.3 — the Access database of the DB ASCII interface.
 *
 * The fixture is a real slice of the delivered test database, cut small: one
 * Gleisabschnitt of four elements with its cant, and one node of every Bauart
 * the grouping has to tell apart — including a Kreuzungsweiche that is missing
 * one of its four nodes, which belongs on the report rather than in a record.
 */

const payload = parseMdbPayload(fixture)

describe('parseBauform', () => {
  it('reads prefix, rail, radius and slope from the usual spelling', () => {
    expect(parseBauform('EW 54-190-1:9'))
      .toMatchObject({ prefix: 'EW', kind: 'turnout', rail: 54, radius: 190, n: 9 })
  })

  it('takes the decimal comma the source mixes with the point', () => {
    expect(parseBauform('SYM ABW 49-215-1:4,8').n).toBe(4.8)
    expect(parseBauform('SYM ABW 54-215-1:4.8').n).toBe(4.8)
  })

  it('ignores the qualifiers that describe the alignment, not the form', () => {
    expect(parseBauform('tlw IBW 54-500-1:12 iU'))
      .toMatchObject({ prefix: 'IBW', kind: 'turnout', rail: 54, radius: 500, n: 12 })
    expect(parseBauform('IBW 54-500-1:14 z.T.i.U.').radius).toBe(500)
  })

  it('maps the Kreuzungsweichen onto their kinds, EABKW with EKW', () => {
    expect(parseBauform('DKW 49-190-1:9').kind).toBe('double_slip')
    expect(parseBauform('EKW 54-500-1:9').kind).toBe('single_slip')
    expect(parseBauform('EABKW 54-500-1:9').kind).toBe('single_slip')
    expect(parseBauform('Kr 54-1:9').kind).toBe('crossing')
    expect(parseBauform('BKr 54-1200/oo-1:11.515').kind).toBe('crossing')
  })

  it('leaves a crossing without a radius rather than inventing one', () => {
    expect(parseBauform('Kr 54-1:9')).toMatchObject({ rail: 54, radius: null, n: 9 })
  })

  it('does not read a number that is no rail profile as one', () => {
    // `140` in EW 140-190-1:7 is not a rail — 190 is still the radius.
    expect(parseBauform('EW 140-190-1:7')).toMatchObject({ rail: null, radius: 190, n: 7 })
  })

  it('reports nothing it cannot place', () => {
    expect(parseBauform('unbekannt')).toMatchObject({ kind: null, radius: null, n: null })
    expect(parseBauform('')).toMatchObject({ prefix: null, kind: null })
  })
})

describe('splitKnoten', () => {
  it('splits the fixed 15-character key into Betriebsstelle and number', () => {
    expect(splitKnoten('  20212746 504A')).toEqual({ bst: '20212746', nr: '504A' })
    expect(splitKnoten('  168591   301 ')).toEqual({ bst: '168591', nr: '301' })
  })
})

describe('mdbRows', () => {
  it('names the element types the geometry builder knows', () => {
    const { rows } = mdbRows(payload)
    expect(rows.length).toBe(payload.elements.length)
    expect(rows.map(r => r.typ)).toEqual(['Klothoide', 'Kreisbogen', 'Klothoide', 'Klothoide'])
  })

  it('converts the start bearing from gon and the cant from metres', () => {
    const { rows, cantRows } = mdbRows(payload)
    const el = payload.elements[0]
    expect(rows[0].bearing).toBeCloseTo(el.ariwi * 0.9, 9)
    const cant = payload.cants.find(c => c.p2 || c.p3)
    if (cant) {
      const row = cantRows.find(r => r.anf === cant.pad1 && r.end === cant.pad2)
      expect(row.u1).toBeCloseTo(Math.abs(cant.p2) * 1000, 6)
    }
  })

  it('places every element from the coordinates of its own Lagesystem', () => {
    const { rows, errors } = mdbRows(payload)
    expect(rows.every(r => Array.isArray(r.start) && r.start.length === 2)).toBe(true)
    expect(errors.filter(e => /ohne Koordinate/.test(e))).toHaveLength(0)
  })
})

describe('buildTracksFromMdb', () => {
  const strecke = fixture.tracks[0].strecke

  it('lists the line numbers the elements belong to', () => {
    expect(listMdbStrecken(payload)).toEqual([{ strecke, count: 4 }])
  })

  it('builds one chain that satisfies the model invariants', () => {
    const { tracks } = buildTracksFromMdb(payload, strecke)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].elements).toHaveLength(4)
    // Same contract as the CSV path: the running station is the caller's, and
    // every caller in the app sets it with `recalcAbsLengths`.
    expectValidTrack({ ...tracks[0], elements: recalcAbsLengths(tracks[0].elements) })
  })

  it('keeps the plane the elements were surveyed in', () => {
    const { tracks } = buildTracksFromMdb(payload, strecke)
    expect(tracks[0].lagesystem).toBe('EA0')
    expect(tracks[0].epsg).toBe(epsgForLagesystem('EA0'))
  })

  it('transforms only when a target plane is asked for', () => {
    const { tracks } = buildTracksFromMdb(payload, strecke, { targetEpsg: 5684 })
    expect(tracks[0].epsg).toBe(5684)
    expect(tracks[0].elements[0].startNode)
      .not.toEqual(buildTracksFromMdb(payload, strecke).tracks[0].elements[0].startNode)
  })

  it('says so instead of throwing when the line number is unknown', () => {
    const { tracks, errors } = buildTracksFromMdb(payload, '9999')
    expect(tracks).toHaveLength(0)
    expect(errors.join(' ')).toMatch(/Keine Elemente/)
  })
})

describe('mdbSwitchInventory', () => {
  const { units, errors } = mdbSwitchInventory(payload)

  it('makes one unit out of the four nodes of a Kreuzungsweiche', () => {
    const dkw = units.filter(u => u.kind === 'double_slip')
    expect(dkw).toHaveLength(1)
    expect(dkw[0].pads).toHaveLength(4)
  })

  it('makes one unit out of the two nodes of an einfache Kreuzungsweiche', () => {
    const ekw = units.filter(u => u.kind === 'single_slip')
    expect(ekw).toHaveLength(1)
    expect(ekw[0].pads).toHaveLength(2)
  })

  it('leaves Gleisende and Streckenwechsel out — they are no Bauteil', () => {
    const ends = payload.nodes.filter(n => n.typ === 2 || n.typ === 3)
    expect(ends.length).toBeGreaterThan(0)
    const endPads = new Set(ends.map(n => n.pad))
    expect(units.some(u => endPads.has(u.pad))).toBe(false)
  })

  it('reports the incomplete group instead of building a short record', () => {
    expect(errors.some(e => /3 Knoten, erwartet 4/.test(e))).toBe(true)
    // …and none of its nodes reached the inventory.
    expect(units.filter(u => u.kind === 'double_slip')).toHaveLength(1)
  })

  it('takes a form without a Kennbuchstabe as what its node type says, and says so', () => {
    const noted = errors.find(e => /ohne Kennbuchstaben/.test(e))
    expect(noted).toBeTruthy()
    expect(noted).toMatch(/als Weiche übernommen/)
  })

  it('carries the rail profile over under the name gaugeProfiles uses', () => {
    expect(units.find(u => u.label.startsWith('EW')).rail).toBe('S54')
  })

  it('keeps the point address as the identity, not the number', () => {
    expect(units.every(u => typeof u.pad === 'string' && u.pad.length > 0)).toBe(true)
    expect(new Set(units.map(u => u.pad)).size).toBe(units.length)
  })
})
