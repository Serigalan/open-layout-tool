import { describe, it, expect } from 'vitest'
import { traceTrack, lineGuide, foresee, gapsOf, axisPointsCsv, AXIS_CSV_HEADER } from './railTrace'
import { detectTrack } from './railDetect'
import { sliceFrame, tilesInSlice, sliceSegment, SlicePoints } from './cloudSlice'
import { importPointCloud } from './importPipeline'
import { readLasHeader } from './lasReader'
import { decodeSegment } from './tiles'
import { hasLaz, LAZ_PATH, nodeFileSource, nodeLazPerf } from '../../test/pointCloudFixture'

const DEG = Math.PI / 180

/**
 * A detection standing in for the clouds: a straight track through (0, 0)
 * at grid bearing `bearing`, found wherever a slice crosses it within its
 * window and close enough to square — a slice more than 4° off smears the
 * heads too much (as in a real scan, railDetect).
 */
function straightTrack({ bearing = 30, missing = () => false } = {}) {
  const dir = [Math.sin(bearing * DEG), Math.cos(bearing * DEG)]
  return async (_project, _clouds, { origin, bearing: b, around, window }) => {
    const r = b * DEG
    const along = [Math.sin(r), Math.cos(r)], right = [Math.cos(r), -Math.sin(r)]
    // where the slice line (origin + q·right) meets the track (t·dir)
    const det = right[0] * dir[1] - right[1] * dir[0]
    const q = (origin.northing * dir[0] - origin.easting * dir[1]) / det
    const s = origin.easting * dir[0] + origin.northing * dir[1]
    const off = Math.acos(Math.min(1, Math.abs(along[0] * dir[0] + along[1] * dir[1]))) / DEG
    if (missing(s) || off > 4 || Math.abs(q - around) > window) return { reason: 'no_pair' }
    return {
      axis: q, left: { z: 100.004 }, right: { z: 100 }, cant: 0.004, gauge: 1.433,
      quality: off < 1 ? 'good' : 'doubtful',
    }
  }
}

/** Distance of a traced point from the straight track. */
const offTrack = (p, bearing) => p.easting * Math.cos(bearing * DEG) - p.northing * Math.sin(bearing * DEG)

describe('traceTrack', () => {
  it('follows a track from a guide drawn askew and beside it', async () => {
    // the guide starts 1.2 m right of the track and runs 5° off it
    const start = [Math.cos(30 * DEG) * 1.2, -Math.sin(30 * DEG) * 1.2]
    const g = 35 * DEG
    const guide = lineGuide([start, [start[0] + Math.sin(g) * 20, start[1] + Math.cos(g) * 20]], 5678)
    const { points, gaps, epsg } = await traceTrack({ guide, detect: straightTrack() })
    expect(epsg).toBe(5678)
    expect(gaps).toEqual([])
    expect(points).toHaveLength(41)
    for (const p of points) expect(Math.abs(offTrack(p, 30))).toBeLessThan(1e-6)
    // after the first points the slice is turned square to the track
    expect(points.at(-1).turn).toBeCloseTo(-5, 1)
  })

  it('reports where the track is not found, and picks it up again after', async () => {
    const guide = lineGuide([[0, 0], [Math.sin(30 * DEG) * 20, Math.cos(30 * DEG) * 20]], 5678)
    const { points, gaps } = await traceTrack({ guide, detect: straightTrack({ missing: s => s > 6.2 && s < 9.8 }) })
    expect(gaps).toEqual([{ from: 6.5, to: 9.5 }])
    expect(points).toHaveLength(41 - 7)
  })

  it('stops when aborted', async () => {
    const ctl = new AbortController()
    ctl.abort()
    const guide = lineGuide([[0, 0], [0, 10]], 5678)
    await expect(traceTrack({ guide, detect: straightTrack(), signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('the parts of a trace', () => {
  it('walks a drawn line by its length, with the bearing of each leg', () => {
    const g = lineGuide([[0, 0], [0, 10], [0, 10], [10, 10]], 5678)
    expect(g.length).toBe(20)
    expect(g.at(5)).toMatchObject({ easting: 0, northing: 5, bearing: 0 })
    expect(g.at(15)).toMatchObject({ easting: 5, northing: 10, bearing: 90 })
  })

  it('foresees from the last points on a line, or from one along its turn', () => {
    const pts = [0, 0.5, 1, 1.5].map(s => ({ station: s, offset: 0.1 + 0.02 * s }))
    expect(foresee(pts, 2).offset).toBeCloseTo(0.14, 9)
    expect(foresee(pts, 2).slope).toBeCloseTo(0.02, 9)
    expect(foresee([{ station: 0, offset: 0.3, turn: 45 }], 1).offset).toBeCloseTo(1.3, 9)
    expect(foresee(pts, 10)).toBeNull()
  })

  it('groups the stations without a track', () => {
    expect(gapsOf([1, 1.5, 2, 5, 7, 7.5])).toEqual([{ from: 1, to: 2 }, { from: 5, to: 5 }, { from: 7, to: 7.5 }])
  })

  it('writes the point file: top of rail by the rule chosen, cant with its sign', () => {
    const points = [
      { station: 0, easting: 4470682.03421, northing: 5332200.97264, zLeft: 531.512, zRight: 531.508, cant: 0.004, quality: 'good' },
      { station: 0.5, easting: 4470682.4, northing: 5332201.3, zLeft: 531.5, zRight: 531.56, cant: -0.06, quality: 'doubtful' },
    ]
    const lines = axisPointsCsv(points).trim().split('\r\n')
    expect(lines[0]).toBe(AXIS_CSV_HEADER)
    expect(lines[1]).toBe('1;0.000;4470682.0342;5332200.9726;531.5080;4;gut')
    expect(lines[2]).toBe('2;0.500;4470682.4000;5332201.3000;531.5000;-60;fraglich')
    expect(axisPointsCsv(points, { soReference: 'axis' }).split('\r\n')[1]).toContain(';531.5100;')
  })
})

describe.skipIf(!hasLaz)('traceTrack on the LAZ sample', () => {
  it('finds the scanned track from a line 1.3 m beside it and 5° askew', async () => {
    const source = await nodeFileSource(LAZ_PATH)
    let index, bytes
    try {
      const header = await readLasHeader(source)
      const parts = []
      let at = 0
      const writer = { append(b) { const o = at; parts.push(b); at += b.length; return o } }
      index = await importPointCloud({ source, header, writer, lazPerf: await nodeLazPerf() })
      bytes = new Uint8Array(at)
      let o = 0
      for (const p of parts) { bytes.set(p, o); o += p.length }
    } finally {
      await source.close()
    }
    const detect = async (_p, _c, { origin, bearing, around, window, rail }) => {
      const frame = sliceFrame({ easting: origin.easting, northing: origin.northing, bearing, halfWidth: Math.abs(around) + window + 1.2, thickness: 0.5 })
      const out = new SlicePoints()
      for (const [tx, ty, segs] of tilesInSlice(index, frame)) {
        for (const [offset, length, count, z0] of segs) {
          sliceSegment(out, decodeSegment(bytes.subarray(offset, offset + length), count),
            { tx, ty, z0, tileSize: index.tileSize }, frame)
        }
      }
      return detectTrack(out, { around, window, rail })
    }
    // the line through (4470687, 5332208) at 45.35°, the track ~1.52 m right of it
    const b0 = 45.35 * DEG, b1 = (45.35 + 5) * DEG
    const at = (s, q) => [4470687 + Math.sin(b0) * s + Math.cos(b0) * q, 5332208 + Math.cos(b0) * s - Math.sin(b0) * q]
    const a = at(-9, 1.52 + 1.3)
    const guide = lineGuide([a, [a[0] + Math.sin(b1) * 16, a[1] + Math.cos(b1) * 16]], 5678)
    const { points } = await traceTrack({ guide, rail: '54E4', detect })
    expect(points.length).toBeGreaterThanOrEqual(29)
    for (const p of points.slice(0, -1)) {
      const q = (p.easting - 4470687) * Math.cos(b0) - (p.northing - 5332208) * Math.sin(b0)
      expect(q).toBeGreaterThan(1.505)
      expect(q).toBeLessThan(1.535)
      expect(p.quality).toBe('good')
    }
  }, 120000)
})
