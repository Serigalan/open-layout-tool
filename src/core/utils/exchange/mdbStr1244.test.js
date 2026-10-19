import { describe, it, expect } from 'vitest'
import { parseMdbPayload, listMdbStrecken, buildAllTracksFromMdb, trackTypeFields } from './mdbImport'
import fixture from '../../test/fixtures/mdb_str1244.json'

/**
 * The Richtungskennzeichen, and a delivery without Gleisabschnitte.
 *
 * The fixture is the delivered STR_1244_KM_112-132 (GND-Edit, version 6) as
 * the converter hands it over: Satzarten 11–25 only — two lines, 1244 and
 * 6100, each with both its tracks, fifteen elements in `DA0`, the gradient in
 * `V00` and the kilometrage line of Satzart 24.
 */

const payload = parseMdbPayload(fixture)

describe('trackTypeFields', () => {
  it('makes 1 and 2 the two tracks of a line, with their side', () => {
    expect(trackTypeFields('1244', 1)).toEqual({ trackType: 1, lineNumber: 1244, side: 1 })
    expect(trackTypeFields('1244', 2)).toEqual({ trackType: 1, lineNumber: 1244, side: 2 })
  })

  it('makes 4 a station track, numbered where its number is one', () => {
    expect(trackTypeFields('14', 4)).toEqual({ trackType: 2, lineNumber: undefined, trackNumber: 14 })
    expect(trackTypeFields('1A', 4)).toEqual({ trackType: 2, lineNumber: undefined })
    expect(trackTypeFields('0', 4)).toEqual({ trackType: 2, lineNumber: undefined })
  })

  it('makes 5 a line track where the number is a line, else a station track', () => {
    expect(trackTypeFields('5546', 5)).toEqual({ trackType: 1, lineNumber: 5546 })
    expect(trackTypeFields('12', 5)).toMatchObject({ trackType: 2, trackNumber: 12 })
  })

  it('says nothing for a code it does not know', () => {
    expect(trackTypeFields('1244', 0)).toEqual({})
    expect(trackTypeFields('1244', 3)).toEqual({})
  })
})

describe('a delivery without Gleisabschnitte', () => {
  it('groups its elements by the line their points name', () => {
    expect(listMdbStrecken(payload)).toEqual([
      { strecke: '1244', count: 9 },
      { strecke: '6100', count: 6 },
    ])
    expect(buildAllTracksFromMdb(payload).errors.join(' '))
      .toMatch(/15 Elemente gehören zu keinem Gleisabschnitt \(Satzart 33\) – gruppiert nach der Strecke ihrer Punkte\./)
  })

  it('builds each line as its two tracks, Richtungsgleis and Gegenrichtungsgleis', () => {
    const { tracks } = buildAllTracksFromMdb(payload)
    expect(tracks.map(t => [t.name, t.trackType, t.lineNumber, t.side])).toEqual([
      ['1244.001', 1, 1244, 1],
      ['1244.002', 1, 1244, 2],
      ['6100.001', 1, 6100, 1],
      ['6100.002', 1, 6100, 2],
    ])
    expect(tracks.reduce((n, t) => n + t.elements.length, 0)).toBe(15)
  })

  it('gives the gradient its datum, DHHN12 for V00', () => {
    const { tracks } = buildAllTracksFromMdb(payload)
    const withHeights = tracks.filter(t => t.heights?.length)
    expect(withHeights.map(t => t.name)).toEqual(['1244.002', '6100.002'])
    expect(withHeights.every(t => t.heightEpsg === 7699)).toBe(true)
  })
})

describe('a delivery with Gleisabschnitte', () => {
  // The first two elements of line 1244 as a section of Satzart 33, the rest
  // left over as in a file whose sections do not cover everything.
  const first = fixture.elements[0]
  const sectioned = parseMdbPayload({
    ...fixture,
    tracks: [{ id: '1', strecke: '1244', richtung: 2, gleis: '', chain: [first.pad1, first.pad2] }],
  })

  it('takes the Richtungskennzeichen of the section', () => {
    const { tracks } = buildAllTracksFromMdb(sectioned)
    const own = tracks.find(t => t.lineNumber === 1244)
    expect(own).toMatchObject({ trackType: 1, side: 2 })
  })

  it('files the leftovers under their Trasse, not under the numbers of their points', () => {
    expect(listMdbStrecken(sectioned).map(s => s.strecke)).toEqual(
      expect.arrayContaining(['1244', expect.stringMatching(/^(1244UCS|6100)/)]))
    expect(listMdbStrecken(sectioned).some(s => /UCS|_247-273/.test(s.strecke))).toBe(true)
  })
})

describe('what the import measures about the file', () => {
  it('finds every element ending on its own end point, and no digitised point', () => {
    const { errors } = buildAllTracksFromMdb(payload)
    expect(errors.join(' ')).not.toMatch(/neben ihrem Endpunkt|digitalisierten Punkten/)
  })

  it('names an element that does not end where the file says', () => {
    // The end point of the first element, moved 5 mm east.
    const el = fixture.elements[0]
    const moved = parseMdbPayload({
      ...fixture,
      points: fixture.points.map(p => (p.pad === el.pad2 && p.sys === el.sys ? { ...p, y: p.y + 0.005 } : p)),
    })
    const note = buildAllTracksFromMdb(moved).errors.find(e => /neben ihrem Endpunkt/.test(e))
    // Two see it: the element that ends there, and the next one, which starts
    // there and so arrives 5 mm beside its own, unmoved end point.
    expect(note).toMatch(/^2 von 15 Elementen enden mehr als 2 mm neben ihrem Endpunkt in der Datei \(größte Abweichung 5\.0 mm\)/)
  })

  it('names the tracks laid on digitised points', () => {
    const el = fixture.elements.find(e => fixture.stations.find(s => s.pad === e.pad1)?.strecke === '6100')
    const coarse = parseMdbPayload({
      ...fixture,
      points: fixture.points.map(p => (p.pad === el.pad1 ? { ...p, mp: 2 } : p)),
    })
    const note = buildAllTracksFromMdb(coarse).errors.find(e => /digitalisierten Punkten/.test(e))
    expect(note).toMatch(/^1 Gleise liegen ganz oder teilweise auf digitalisierten Punkten .*: 6100\.00\d\.$/)
  })
})
