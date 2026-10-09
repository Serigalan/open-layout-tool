import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  REFERENCE_MAX_LENGTH, axisOutline, axisRange, buildReferenceAxis, referenceAxisDefect, referencePoints, sampleAlong,
} from './referenceAxis'
import { straightElement, arcFrom, transitionElement } from './elementFactory'
import { endPointStraightUtm } from './elementUtils'
import { recalcAbsLengths } from './trackModel'
import { pointOnElement } from './platformUtils'
import { gradientAt } from './heightUtils'
import { buildElements, parseGradient, parseRecords } from './vermEsnImport'

const EPSG = 25832
const P = (x, y) => ({ easting: 500000 + x, northing: 5700000 + y, zone: EPSG })

// Straight 100 m east, a 60 m transition into R 500 right, 200 m of it.
const chain = () => {
  const s = straightElement(P(0, 0), P(100, 0))
  const t = transitionElement(P(100, 0), 90, 60, null, 500).element
  const end = { easting: t.endNode[0], northing: t.endNode[1], zone: EPSG }
  const a = arcFrom(end, t.endBearing, 200, 500)
  return recalcAbsLengths([s, t, a])
}
// The point at a station of the chain, from the app's own geometry.
const pointAt = (els, s, epsg = EPSG) => {
  let start = 0
  for (const el of els) {
    if (s <= start + el.length + 1e-9) return pointOnElement(el, epsg, s - start).utm
    start += el.length
  }
  return null
}

describe('sampling an axis', () => {
  it('puts a point on every centimetre of its stationing, between the stations asked for', () => {
    const els = [straightElement(P(0, 0), P(100, 0))]
    const { offset, e, n } = sampleAlong(els, EPSG, 10.005, 20)
    expect(offset).toBeCloseTo(10.01, 9)
    expect(e.length).toBe(1000)
    expect(e[0] - 500000).toBeCloseTo(10.01, 6)
    expect(e.at(-1) - 500000).toBeCloseTo(20, 6)
    expect(n.every(v => Math.abs(v - 5700000) < 1e-6)).toBe(true)
  })

  it('lies on the elements to well under a millimetre, across their joints', () => {
    const els = chain()
    const { offset, e, n } = sampleAlong(els, EPSG, 90, 300)
    for (let i = 0; i < e.length; i += 1237) {
      const p = pointAt(els, offset + i * 0.01)
      expect(Math.hypot(e[i] - p.easting, n[i] - p.northing)).toBeLessThan(2e-4)
    }
  })
})

describe('a reference axis', () => {
  const gradient = [{ station: 1000, z: 100 }, { station: 1150, z: 101.5, rv: 8000 }, { station: 1400, z: 100.5 }]
  const axis = buildReferenceAxis({
    name: 'A', epsg: EPSG, elements: chain(), startStation: 1000, from: 1050, to: 1300,
    gradient, heightEpsg: 7837, tra: 'a.TRA', gra: 'a.GRA', id: 'x', importedAt: '2026-10-07T00:00:00Z',
  })

  it('keeps the points every centimetre in its own stationing, as whole millimetres', () => {
    expect(axis.points.s0).toBe(1050)
    expect(axis.points.de.length).toBe(25001)
    expect(axisRange(axis)).toEqual({ from: 1050, to: 1050 + 25000 * 0.01 })
    const { e, n, z } = referencePoints(axis)
    const els = chain()
    for (const i of [0, 4999, 5000, 11111, 25000]) {
      const p = pointAt(els, 50 + i * 0.01)
      expect(Math.abs(e[i] - p.easting)).toBeLessThanOrEqual(0.0005 + 1e-9)
      expect(Math.abs(n[i] - p.northing)).toBeLessThanOrEqual(0.0005 + 1e-9)
      expect(Math.abs(z[i] - gradientAt(gradient, 1050 + i * 0.01))).toBeLessThanOrEqual(0.0005 + 1e-9)
    }
    expect(axis).toMatchObject({ heightEpsg: 7837, source: { tra: 'a.TRA', gra: 'a.GRA' } })
    expect(referenceAxisDefect(axis)).toBe(null)
  })

  it('decodes once per axis', () => {
    expect(referencePoints(axis)).toBe(referencePoints(axis))
  })

  it('has heights only where the gradient reaches', () => {
    const short = buildReferenceAxis({
      name: 'B', epsg: EPSG, elements: chain(), startStation: 1000, from: 1000, to: 1200,
      gradient: [{ station: 1100, z: 50 }, { station: 1150, z: 51 }], heightEpsg: 7837, tra: 'b.TRA',
    })
    const { z } = referencePoints(short)
    expect(Number.isNaN(z[9999])).toBe(true)
    expect(z[10000]).toBeCloseTo(50, 3)
    expect(z[15000]).toBeCloseTo(51, 3)
    expect(Number.isNaN(z[15001])).toBe(true)
  })

  it('takes no more than the longest stretch, and nothing backwards', () => {
    expect(() => buildReferenceAxis({ name: 'C', epsg: EPSG, elements: chain(), from: 0, to: REFERENCE_MAX_LENGTH + 1, tra: 'c' })).toThrow()
    expect(() => buildReferenceAxis({ name: 'C', epsg: EPSG, elements: chain(), from: 100, to: 50, tra: 'c' })).toThrow()
  })

  it('is small enough to live in the project: 2 km with heights under 2 MB of JSON', () => {
    const far = endPointStraightUtm(P(0, 0), 80, 2100)
    const long = buildReferenceAxis({
      name: 'D', epsg: EPSG, elements: [straightElement(P(0, 0), far)], from: 0, to: 2000,
      gradient: [{ station: 0, z: 100 }, { station: 2100, z: 121 }], heightEpsg: 7837, tra: 'd',
    })
    expect(long.points.de.length).toBe(200001)
    expect(JSON.stringify(long).length).toBeLessThan(2 * 1024 * 1024)
  })

  it('draws as a line with a vertex every metre', () => {
    expect(axisOutline(axis, 1).length).toBe(251)
  })

  it('names what is wrong with a broken one', () => {
    expect(referenceAxisDefect({ ...axis, id: undefined })).toBe('id')
    expect(referenceAxisDefect({ ...axis, points: { ...axis.points, dn: [] } })).toBe('points')
    expect(referenceAxisDefect({ ...axis, points: { ...axis.points, z: { i0: 0, z0: 0, dz: new Array(30000).fill(0) } } })).toBe('z')
  })
})

// The Verm.ESN files of line 5550 (left track, ~4 km), kept outside the repository.
const DATA = join(homedir(), '.claude/projects/-root-open-layout-tool/memory/testdata')
const TRA = join(DATA, '5550L000_EA0_VR.TRA'), GRA = join(DATA, '5550L000_EA0_V00_VR.GRA')
const buffer = (path) => { const b = readFileSync(path); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }

describe.skipIf(!existsSync(TRA) || !existsSync(GRA))('a real Verm.ESN axis', () => {
  it('reads 2 km of it with heights, on the elements the track import builds', () => {
    const { elements, startStation } = buildElements(parseRecords(buffer(TRA)), 5684)
    const gradient = parseGradient(buffer(GRA))
    const from = startStation + 500, to = startStation + 2500
    const axis = buildReferenceAxis({ name: '5550L', epsg: 5684, elements, startStation, from, to, gradient, heightEpsg: 7837, tra: '5550L' })
    expect(axis.points.de.length).toBe(200001)
    const { e, n, z } = referencePoints(axis)
    // Station 1000 m along the track is point (1000 − 500) / 0,01 of the axis.
    const p = pointAt(recalcAbsLengths(elements).map(el => ({ ...el })), 1000, 5684)
    expect(Math.hypot(e[50000] - p.easting, n[50000] - p.northing)).toBeLessThan(0.001)
    expect(z.every(Number.isFinite)).toBe(true)
  })
})
