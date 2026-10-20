import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import {
  parseRecords, buildElements, parseGradient, gradientHeights, gradientHeightCode, readVermEsnArchive, buildVermEsnBatch,
  readAxis, gradientReferences, referencedHeights, readKmLines, batchReferences, kmLineEntries, kmLineNumber,
} from './vermEsnImport'

/** A GRA file: header (num = number of points), then station, height, radius, tangent length, point number. */
function graBuffer(rows, num = rows.length) {
  const buf = new ArrayBuffer(36 * (rows.length + 1))
  const view = new DataView(buf)
  view.setFloat64(0, num, true)
  rows.forEach(([station, z, rv = 0, t = 0, nr = 0], i) => {
    const o = 36 * (i + 1)
    view.setFloat64(o, station, true)
    view.setFloat64(o + 8, z, true)
    view.setFloat64(o + 16, rv, true)
    view.setFloat64(o + 24, t, true)
    view.setInt32(o + 32, nr, true)
  })
  return buf
}

/**
 * A TRA file of straights due north (or due south with `south`), each record
 * { station, length }; the last one closes the axis. It begins at (`easting`, `northing`).
 */
function traBuffer(rows, { easting = 700000, northing = 5700000, south = false } = {}) {
  const buf = new ArrayBuffer(78 * rows.length)
  const view = new DataView(buf)
  rows.forEach(({ station, length }, i) => {
    const o = 78 * i
    view.setFloat64(o + 16, easting, true)
    view.setFloat64(o + 24, northing + (south ? -1 : 1) * (station - rows[0].station), true)
    view.setFloat64(o + 32, south ? Math.PI : 0, true)
    view.setFloat64(o + 40, station, true)
    view.setInt16(o + 48, 0, true)
    view.setFloat64(o + 50, length, true)
  })
  return buf
}

describe('parseGradient', () => {
  it('reads the tangent polygon after the header, radius as magnitude', () => {
    const points = parseGradient(graBuffer([[1000, 80], [1200, 82, -5000, 20], [1500, 79]]))
    expect(points).toEqual([
      { station: 1000, z: 80 },
      { station: 1200, z: 82, rv: 5000 },
      { station: 1500, z: 79 },
    ])
  })

  it('leaves out the closing record behind the gradient', () => {
    // As in the delivered files: num points, then a record whose station
    // jumps back (and a padding record).
    const rows = [[0, 508.032], [164, 508.36, -2037.351, 25], [404, 502.95],
      [1426.98, 1460.58, 1516.58, 2060, 1000], [0, 0]]
    expect(parseGradient(graBuffer(rows, 3)).map(p => p.station)).toEqual([0, 164, 404])
    // A header that counts the closing record as well still ends at the last point.
    rows[3][0] = 100
    expect(parseGradient(graBuffer(rows, 4)).map(p => p.station)).toEqual([0, 164, 404])
  })

  it('stops at the end of the file when the header promises more', () => {
    const buf = graBuffer([[0, 1], [10, 2]])
    new DataView(buf).setFloat64(0, 9, true)
    expect(parseGradient(buf)).toHaveLength(2)
  })
})

describe('gradientHeights — the gradient on the imported track', () => {
  const tra = traBuffer([
    { station: 1100, length: 200 },
    { station: 1300, length: 100 },
    { station: 1400, length: 0 },
  ])

  it('stations the heights from the track begin', () => {
    const { elements, errors, startStation } = buildElements(parseRecords(tra), 25832)
    expect(errors).toEqual([])
    expect(startStation).toBe(1100)
    const length = elements.reduce((s, el) => s + el.length, 0)
    const points = parseGradient(graBuffer([[1000, 80], [1200, 82, 5000], [1500, 79]]))
    const { heights, notes } = gradientHeights(points, startStation, length)
    expect(notes).toEqual([])
    expect(heights.map(p => p.station)).toEqual([0, 100, 300])
    expect(heights[0].z).toBeCloseTo(81)
    expect(heights[1]).toEqual({ station: 100, z: 82, rv: 5000 })
    expect(heights[2].z).toBeCloseTo(80)
  })

  it('notes a gradient that covers only part of the track', () => {
    const points = parseGradient(graBuffer([[1200, 82], [1300, 83]]))
    const { heights, notes } = gradientHeights(points, 1100, 300)
    expect(heights.map(p => p.station)).toEqual([100, 200])
    expect(notes).toHaveLength(1)
  })

  it('refuses a gradient outside the axis', () => {
    const points = parseGradient(graBuffer([[5000, 82], [5300, 83]]))
    const { heights, notes } = gradientHeights(points, 1100, 300)
    expect(heights).toBeNull()
    expect(notes[0]).toMatch(/nicht im Stationsbereich/)
  })
})

describe('gradientHeightCode — the height status the file names', () => {
  it('reads it from the header after num', () => {
    const buf = graBuffer([[0, 1], [10, 2]])
    new Uint8Array(buf).set([0x56, 0x30, 0x30, 0], 8)   // 'V00'
    expect(gradientHeightCode(buf, 'x.GRA')).toBe('V00')
  })

  it('falls back to the file name where the header holds something else', () => {
    const buf = graBuffer([[0, 1], [10, 2]])
    new Uint8Array(buf).set([0x00, 0x7e, 0x70, 0x01], 8)
    expect(gradientHeightCode(buf, '5550R000_EA0_V00_VR.GRA')).toBe('V00')
    expect(gradientHeightCode(buf, 'gradient.gra')).toBeNull()
  })
})

describe('Verm.ESN batch — TRA and GRA pairs from one zip', () => {
  const tra = () => new Uint8Array(traBuffer([{ station: 1000, length: 100 }, { station: 1100, length: 50 }, { station: 1150, length: 0 }]))
  const gra = () => new Uint8Array(graBuffer([[1000, 80], [1150, 81.5]]))
  const zip = zipSync({
    'Lage/5550L.TRA': tra(), 'Hoehe/5550l.gra': gra(),
    '5550R.tra': tra(),
    '6340.GRA': gra(),
    '__MACOSX/Lage/._5550L.TRA': new Uint8Array(4), 'liesmich.txt': new Uint8Array(1),
  })

  it('pairs a GRA with the TRA of the same name, case and folders ignored', () => {
    const { pairs, orphans, duplicates } = readVermEsnArchive(zip)
    expect(pairs.map(p => [p.name, p.traFile, p.graFile])).toEqual([
      ['5550L', '5550L.TRA', '5550l.gra'], ['5550R', '5550R.tra', null],
    ])
    expect(orphans).toEqual(['6340.GRA'])
    expect(duplicates).toEqual([])
    expect(parseRecords(pairs[0].tra)).toHaveLength(3)
  })

  it('reads a name that comes twice once', () => {
    const { pairs, duplicates } = readVermEsnArchive(zipSync({ 'a/X.TRA': tra(), 'b/x.tra': tra() }))
    expect(pairs).toHaveLength(1)
    expect(duplicates).toEqual(['x.tra'])
  })

  it('builds one track per pair in the chosen plane and height datum, named after the file', () => {
    const { pairs } = readVermEsnArchive(zip)
    const { tracks, files } = buildVermEsnBatch(pairs, { epsg: 5683, heightEpsg: 7837, takenNames: ['5550R'] })
    expect(tracks.map(t => [t.name, t.epsg, t.heightEpsg])).toEqual([['5550L', 5683, 7837], ['5550R.001', 5683, undefined]])
    expect(tracks[0].elements).toHaveLength(2)
    expect(tracks[0].heights[0]).toMatchObject({ station: 0, z: 80 })
    expect(files.map(f => [f.name, f.imported, f.count, f.heights > 0])).toEqual([['5550L', true, 2, true], ['5550R.001', true, 2, false]])
  })

  it('leaves out a TRA whose elements do not join, as the single import refuses it', () => {
    const buf = traBuffer([{ station: 0, length: 100 }, { station: 100, length: 50 }, { station: 150, length: 0 }])
    new DataView(buf).setFloat64(78 + 24, 5700100.5, true)   // second element 0.5 m off
    const { tracks, files } = buildVermEsnBatch([{ name: 'bad', traFile: 'bad.TRA', tra: buf, gra: null }], { epsg: 5683 })
    expect(tracks).toEqual([])
    expect(files[0]).toMatchObject({ imported: false })
    expect(files[0].errors[0]).toMatch(/Anschluss-Abweichung/)
  })
})

describe('Verm.ESN gradient along the kilometrage line', () => {
  // The kilometrage line runs north from km 165400.0 for 400 m; the track lies
  // 4.5 m east of it, from km 165450 for 200 m.
  const kmTra = traBuffer([{ station: 165400, length: 400 }, { station: 165800, length: 0 }])
  const trackTra = traBuffer([{ station: 0, length: 120 }, { station: 120, length: 80 }, { station: 200, length: 0 }],
    { easting: 700004.5, northing: 5700050 })
  const kmGra = graBuffer([[165450, 100], [165550, 101, 5000, 10], [165650, 100.5]])
  const km = () => ({ ...readAxis(kmTra, 5683), name: '6340S' })

  it('carries the points over at right angles to the line, the track ends taking the gradient ends', () => {
    const axis = readAxis(trackTra, 5683)
    const [best, own] = gradientReferences(axis, parseGradient(kmGra), [km()])
    expect(best.ref).toBe('6340S')
    expect(own.ref).toBeNull()
    expect(best.points.map(p => p.station)).toEqual([expect.closeTo(0, 6), expect.closeTo(100, 6), expect.closeTo(200, 6)])
    const { heights, notes } = referencedHeights(best, axis)
    expect(heights.map(h => [Math.round(h.station * 1000) / 1000, h.z])).toEqual([[0, 100], [100, 101], [200, 100.5]])
    expect(heights[1].rv).toBe(5000)
    expect(notes).toEqual([])
  })

  it('takes the points in the direction of a track that runs against the kilometrage', () => {
    const back = readAxis(traBuffer([{ station: 0, length: 200 }, { station: 200, length: 0 }],
      { easting: 699996, northing: 5700250, south: true }), 5683)
    const [best] = gradientReferences(back, parseGradient(kmGra), [km()])
    expect(best.ref).toBe('6340S')
    expect(best.points.map(p => [Math.round(p.station * 1000) / 1000, p.z])).toEqual([[0, 100.5], [100, 101], [200, 100]])
  })

  it('counts gradient and track ends up to 2 cm apart as the same, and says where the gradient falls short', () => {
    const axis = readAxis(trackTra, 5683)
    const near = gradientReferences(axis, parseGradient(graBuffer([[165450.015, 100], [165649.99, 100.5]])), [km()])[0]
    const { heights, notes } = referencedHeights(near, axis)
    expect([heights[0].station, heights[heights.length - 1].station]).toEqual([0, 200])
    expect(notes).toEqual([])
    const short = gradientReferences(axis, parseGradient(graBuffer([[165450.05, 100], [165649.99, 100.5]])), [km()])[0]
    expect(referencedHeights(short, axis).notes[0]).toMatch(/nicht ganz ab/)
  })

  it('keeps a gradient along the track where it fits there best', () => {
    const own = gradientReferences(readAxis(trackTra, 5683), parseGradient(graBuffer([[0, 100], [200, 101]])), [km()])
    expect(own[0].ref).toBeNull()
  })

  it('makes the line a project kilometrage line under the number its name starts with', () => {
    expect(kmLineNumber('63400164S')).toBe(6340)
    expect(kmLineNumber('6311-001S')).toBe(6311)
    const [entry] = kmLineEntries([km()])
    expect(entry).toMatchObject({ id: 'km-6340', lineNumber: 6340, source: 'vermesn' })
    expect(entry.runs).toHaveLength(1)
    expect(entry.runs[0][0][2]).toBe(165400)
    expect(entry.runs[0][entry.runs[0].length - 1][2]).toBe(165800)
  })

  it('in a batch: an S file is a kilometrage line, the track takes its number and the line goes along', () => {
    const archive = readVermEsnArchive(zipSync({
      '6340S.TRA': new Uint8Array(kmTra), 'Gleis_1.TRA': new Uint8Array(trackTra), 'Gleis_1.GRA': new Uint8Array(kmGra),
      'Gleis_links.TRA': new Uint8Array(trackTra),
    }))
    expect(archive.pairs.map(p => p.name)).toEqual(['Gleis_1', 'Gleis_links'])
    expect(archive.kmLines.map(k => k.name)).toEqual(['6340S'])
    const { axes } = readKmLines(archive.kmLines, 5683)
    expect(batchReferences(archive.pairs, axes, 5683).get('Gleis_1')).toEqual(['6340S', null])
    const { tracks, kmLines, files } = buildVermEsnBatch(archive.pairs, { epsg: 5683, heightEpsg: 7837, kmAxes: axes })
    expect(tracks[0]).toMatchObject({ name: 'Gleis_1', lineNumber: 6340 })
    expect(tracks[0].heights[0]).toMatchObject({ station: 0, z: 100 })
    expect(tracks[1].lineNumber).toBeUndefined()
    expect(files[0].reference).toBe('6340S')
    expect(kmLines.map(l => l.lineNumber)).toEqual([6340])
    // Chosen otherwise: along the track, whose stationing the gradient misses.
    const own = buildVermEsnBatch(archive.pairs, { epsg: 5683, kmAxes: axes, references: new Map([['Gleis_1', null]]) })
    expect(own.tracks[0].heights).toBeUndefined()
    expect(own.kmLines).toEqual([])
  })
})
