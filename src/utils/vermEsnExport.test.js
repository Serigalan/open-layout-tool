import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { parseRecords, buildElements, parseGradient } from './vermEsnImport'
import { traBytes, graBytes, traRecords, exportVermEsn } from './vermEsnExport'
import { lagesystemForEpsg, epsgForLagesystem } from './mdbImport'
import { recalcAbsLengths } from './trackModel'
import { tangentLength } from './heightUtils'
import { hasPekBestand, loadPekBestand } from '../test/pekFixture'

const EPSG = 5684
const bufferOf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

/** The elements a written TRA file reads back as. */
const readBack = (track) => buildElements(parseRecords(bufferOf(traBytes(track))), track.epsg)

/** Element by element, how far the read-back chain runs from the track's own [m]. */
function maxDeviation(a, b) {
  expect(b.length).toBe(a.length)
  return Math.max(...a.map((el, i) => Math.max(
    Math.hypot(el.startNode[0] - b[i].startNode[0], el.startNode[1] - b[i].startNode[1]),
    Math.hypot(el.endNode[0] - b[i].endNode[0], el.endNode[1] - b[i].endNode[1]),
  )))
}

describe('lagesystemForEpsg', () => {
  it('names the Gauss-Krüger planes the way the MDB does, and nothing else', () => {
    expect(lagesystemForEpsg(5684)).toBe('ER0')
    expect(lagesystemForEpsg(5678)).toBe('EA0')
    expect(lagesystemForEpsg(3397)).toBe('EB0')
    expect(lagesystemForEpsg(2399)).toBe('FC0')
    expect(lagesystemForEpsg(25832)).toBeNull()
    for (const code of ['CR0', 'DA0', 'DB0', 'EC0', 'FR0']) expect(lagesystemForEpsg(epsgForLagesystem(code))).toBe(code)
  })
})

describe('traBytes', () => {
  // Every element kind the file knows, cant on arcs and across transitions.
  const source = new Uint8Array(78 * 9)
  const view = new DataView(source.buffer)
  const rows = [
    // radiusB, radiusE, type, length, cantB, cantE
    [0, 0, 0, 100, 0, 0],
    [0, 600, 2, 80, 0, 90],
    [600, 600, 1, 120, 90, 90],
    [600, 0, 4, 60, 90, 0],
    [190, 190, 5, 50, 0, 0],      // a straight with a kink of −10 gon at its end
    [0, -900, 2, 40, 0, 0],
    [-900, -900, 1, 70, 0, 0],
  ]
  // Lay the records out along the chain the import builds, so every start is where the last ended.
  let at = { e: 4470000, n: 5332000, b: 1.2, s: 0 }
  view.setInt16(48, rows.length, true)
  const write = (i, [rb, re, type, length, cb, ce]) => {
    const o = 78 * i
    view.setFloat64(o, rb, true); view.setFloat64(o + 8, re, true)
    view.setFloat64(o + 16, at.e, true); view.setFloat64(o + 24, at.n, true)
    view.setFloat64(o + 32, at.b, true); view.setFloat64(o + 40, at.s, true)
    view.setInt16(o + 48, type, true); view.setFloat64(o + 50, length, true)
    view.setFloat64(o + 58, cb, true); view.setFloat64(o + 66, ce, true)
  }
  rows.forEach((row, i) => {
    write(i + 1, row)
    const part = parseRecords(source.buffer.slice(0, 78 * (i + 3)))
    part[i + 2] = { ...part[i + 1], type: 0, length: 0 }     // a closing record behind it
    const { elements } = buildElements(part, EPSG)
    const last = elements[elements.length - 1]
    at = { e: last.endNode[0], n: last.endNode[1], b: ((last.endBearing ?? last.bearing) * Math.PI) / 180, s: at.s + row[3] }
  })
  write(rows.length + 1, [0, 0, 0, 0, 0, 0])
  const { elements } = buildElements(parseRecords(source.buffer), EPSG)
  const track = { epsg: EPSG, elements: recalcAbsLengths(elements) }

  it('writes a header counting the elements, the elements and a closing record', () => {
    const bytes = traBytes(track)
    expect(bytes.byteLength).toBe(78 * (rows.length + 2))
    const out = parseRecords(bufferOf(bytes))
    expect(out[0].type).toBe(rows.length)
    expect(out.slice(1, -1).map(r => r.type)).toEqual(rows.map(r => r[2]))
    const close = out[out.length - 1]
    expect(close.length).toBe(0)
    expect(close.absLength).toBeCloseTo(rows.reduce((s, r) => s + r[3], 0), 6)
    expect(close.easting).toBeCloseTo(at.e, 6)
    expect(close.bearing).toBeCloseTo(at.b, 9)
  })

  it('states radii, kink angle and cants as the source did', () => {
    const out = parseRecords(bufferOf(traBytes(track))).slice(1, -1)
    out.forEach((r, i) => {
      const [rb, re, , length, cb, ce] = rows[i]
      expect(r.radiusB).toBeCloseTo(rb, 6)
      expect(r.radiusE).toBeCloseTo(re, 6)
      expect(r.length).toBeCloseTo(length, 9)
      expect([r.cantB, r.cantE]).toEqual([cb, ce])
    })
  })

  it('reads back to the same chain', () => {
    const back = readBack(track)
    expect(back.errors).toEqual([])
    expect(maxDeviation(track.elements, back.elements)).toBeLessThan(1e-6)
  })

  it('leaves out elements of no length and writes nothing for a track without any', () => {
    expect(traRecords({ elements: [{ ...track.elements[0], length: 0 }, track.elements[1]] })).toHaveLength(2)
    expect(traBytes({ elements: [] })).toBeNull()
  })
})

describe('graBytes', () => {
  const heights = [
    { station: 0, z: 100 },
    { station: 200, z: 102, rv: 5000 },        // crest: +1 % to −0.5 %
    { station: 400, z: 101, rv: 8000 },        // sag: −0.5 % to +0.5 %
    { station: 600, z: 102 },
  ]

  it('signs the radius by crest and sag and states the tangent length', () => {
    const bytes = graBytes({ heights })
    const view = new DataView(bufferOf(bytes))
    expect(view.getFloat64(0, true)).toBe(4)
    expect(view.getFloat64(36 + 36 + 16, true)).toBe(-5000)
    expect(view.getFloat64(36 * 3 + 16, true)).toBe(8000)
    expect(view.getFloat64(36 + 36 + 24, true)).toBeCloseTo(tangentLength(heights, 1), 9)
    expect(parseGradient(bufferOf(bytes))).toEqual(heights)
  })

  it('writes nothing for fewer than two points', () => {
    expect(graBytes({ heights: [{ station: 0, z: 1 }] })).toBeNull()
    expect(graBytes({})).toBeNull()
  })
})

describe('exportVermEsn', () => {
  const straight = { elementType: 0, startNode: [4470000, 5332000], endNode: [4470100, 5332000], bearing: 90, length: 100 }

  it('names the files after the track — its own name first, in ASCII — and its Lagesystem, and notes plane and datum', () => {
    const tracks = [
      { id: 'a', lineNumber: '6344', trackNumber: '1', epsg: 5684, elements: [straight],
        heights: [{ station: 0, z: 90 }, { station: 100, z: 91 }], heightEpsg: 5783 },
      { id: 'b', lineNumber: '6344', trackNumber: '1', epsg: 5684, elements: [straight] },
      { id: 'c', name: 'Wildeck-Hönebach 3', lineNumber: '6340', epsg: 25832, elements: [straight] },
      { id: 'd', name: 'leer', epsg: 5684, elements: [] },
    ]
    const { zip, files, skipped } = exportVermEsn(tracks, { title: 'PEK' })
    const entries = unzipSync(zip)
    expect(Object.keys(entries).sort()).toEqual([
      '6344_1_ER0-2.TRA', '6344_1_ER0.GRA', '6344_1_ER0.TRA', 'Verm.ESN-Export.txt', 'Wildeck-Hoenebach_3.TRA',
    ])
    expect(files.map(f => f.gra)).toEqual(['6344_1_ER0.GRA', null, null])
    expect(skipped).toEqual(['leer'])
    const note = strFromU8(entries['Verm.ESN-Export.txt'])
    expect(note).toContain('EPSG 5684 (ER0)')
    expect(note).toContain('EPSG 25832')
    expect(note).toContain('DHHN92')
    expect(note).toContain('leer')
  })
})

const TESTDATA = join(homedir(), '.claude/projects/-root-open-layout-tool/memory/testdata')
const realFiles = ['5550L000_EA0_VR.TRA', '5550R000_EA0_VR.TRA'].map(f => join(TESTDATA, f)).filter(existsSync)

describe.skipIf(!realFiles.length)('the Verm.ESN files of line 5550 (memory/testdata)', () => {
  it.each(realFiles)('%s goes out as it came in', (path) => {
    const bytes = readFileSync(path)
    const source = parseRecords(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const { elements } = buildElements(source, 5684)
    const track = { epsg: 5684, elements: recalcAbsLengths(elements) }
    const out = parseRecords(bufferOf(traBytes(track)))
    // Records of no length are not elements of the model and are not written back.
    // The import keeps radii and transition lengths to the millimetre, so
    // those — and the stations summed from the lengths — come back to that.
    const kept = source.slice(1).filter((r, i, all) => r.length > 0 || i === all.length - 1)
    expect(out).toHaveLength(kept.length + 1)
    out.slice(1).forEach((r, i) => {
      const s = kept[i]
      expect(r.type).toBe(s.type)
      expect(r.easting).toBeCloseTo(s.easting, 3)
      expect(r.northing).toBeCloseTo(s.northing, 3)
      expect(r.bearing).toBeCloseTo(s.bearing, 6)
      expect(r.absLength).toBeCloseTo(s.absLength, 2)
      expect(r.length).toBeCloseTo(s.length, 3)
      if (s.type === 1) expect(r.radiusB).toBeCloseTo(s.radiusB, 3)
      if (s.type === 1) expect(r.cantB).toBeCloseTo(s.cantB, 6)
    })
  })
})

describe.skipIf(!hasPekBestand)('PEK Bestand', () => {
  it('every track reads back to its own chain within a tenth of a millimetre', () => {
    const { tracks } = loadPekBestand()
    let worst = 0
    for (const track of tracks.filter(t => t.elements?.length)) {
      const back = readBack(track)
      const own = track.elements.filter(el => el.length > 0)
      worst = Math.max(worst, maxDeviation(own, back.elements))
    }
    expect(worst).toBeLessThan(1e-4)
  })
})
