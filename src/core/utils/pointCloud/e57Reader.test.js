import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { readE57Header, readE57Points, isE57 } from './e57Reader'
import { readCloudHeader, readCloudPoints, readFirstPoints } from './cloudReader'
import { importPointCloud } from './importPipeline'
import { readLasHeader } from './lasReader'
import { pointsAsText } from './lasText'
import {
  E57_FIXTURES, E57_SAMPLE_PATH, LAZ_PATH, bytesSource, makeLas, nodeFileSource, nodeLazPerf,
} from '../../test/pointCloudFixture'

// What libE57Format wrote and numpy computed from it (tools/e57fixtures.py).
const EXPECTED = JSON.parse(readFileSync(`${E57_FIXTURES}expected.json`, 'utf8'))
const fixture = (name) => bytesSource(new Uint8Array(readFileSync(E57_FIXTURES + name)))

async function readAll(source, header, options) {
  const pts = []
  for await (const b of readCloudPoints(source, header, options)) {
    for (let i = 0; i < b.count; i++) pts.push([b.x[i], b.y[i], b.z[i], b.intensity[i]])
  }
  return pts
}

/** The points against the expectation: count, sums, every sampled point. */
function expectMatches(pts, exp, { withIntensity }) {
  expect(pts).toHaveLength(exp.count)
  for (let k = 0; k < 3; k++) {
    const sum = pts.reduce((s, p) => s + p[k], 0)
    expect(Math.abs(sum - exp.sum[k]) / exp.count).toBeLessThan(1e-6)
  }
  if (withIntensity) expect(pts.reduce((s, p) => s + p[3], 0)).toBe(exp.intensitySum)
  for (const [i, x, y, z, intensity] of exp.sample) {
    expect(pts[i][0]).toBeCloseTo(x, 6)
    expect(pts[i][1]).toBeCloseTo(y, 6)
    expect(pts[i][2]).toBeCloseTo(z, 6)
    if (withIntensity) expect(pts[i][3]).toBe(intensity)
  }
}

describe('readE57Points — files written by libE57Format', () => {
  it('reads scaled integers of odd widths, the pose turned and shifted, invalid points left out', async () => {
    const source = fixture('scaled_pose.e57')
    const header = await readCloudHeader(source)
    expect(header).toMatchObject({ format: 'e57', version: '1.0', pointCount: 30000, coordinateMetadata: 'EPSG:5678' })
    expect(header.scale).toEqual([0.0001, 0.0001, 0.0001])
    const exp = EXPECTED['scaled_pose.e57']
    // The stated box, turned by the pose, holds every point.
    for (let k = 0; k < 3; k++) {
      expect(header.min[k]).toBeLessThanOrEqual(exp.min[k])
      expect(header.max[k]).toBeGreaterThanOrEqual(exp.max[k])
      expect(exp.min[k] - header.min[k]).toBeLessThan(10)
    }
    expectMatches(await readAll(source, header), exp, { withIntensity: true })
  })

  it('reads spherical doubles and Cartesian singles, scan after scan, each with its pose', async () => {
    const source = fixture('spherical_two_scans.e57')
    const header = await readE57Header(source)
    expect(header.scans.map(s => [s.coords, s.recordCount])).toEqual([['spherical', 6000], ['cartesian', 6000]])
    const pts = await readAll(source, header)
    const [first, second] = EXPECTED['spherical_two_scans.e57'].scans
    expectMatches(pts.slice(0, first.count), first, { withIntensity: true })
    expectMatches(pts.slice(first.count), second, { withIntensity: false })
    // Without an intensity field the points come with none.
    expect(pts.slice(first.count).every(p => p[3] === 0)).toBe(true)
    for (let k = 0; k < 3; k++) {
      expect(header.min[k]).toBeLessThanOrEqual(Math.min(first.min[k], second.min[k]) + 1e-6)
      expect(header.max[k]).toBeGreaterThanOrEqual(Math.max(first.max[k], second.max[k]) - 1e-6)
    }
  })

  it('counts records in its progress and ends at all of them', async () => {
    const source = fixture('scaled_pose.e57')
    const header = await readE57Header(source)
    let last = null
    for await (const b of readE57Points(source, header, { onProgress: (p) => { last = p } })) expect(b.count).toBeGreaterThan(0)
    expect(last).toMatchObject({ points: 30000, totalPoints: 30000 })
    expect(last.bytes).toBe(last.totalBytes)
  })

  it('gives the first points for the text view', async () => {
    const source = fixture('scaled_pose.e57')
    const header = await readCloudHeader(source)
    const pts = await readFirstPoints(source, header, 5)
    expect(pts).toHaveLength(5)
    expect(pts[0].x).toBeCloseTo(EXPECTED['scaled_pose.e57'].sample[0][1], 6)
    const text = pointsAsText(header, pts, { name: 'scaled_pose.e57' }).split('\n')
    expect(text.slice(1, 3)).toEqual(['# E57 1.0, scans: 1, 30000 points', '# coordinate system: EPSG:5678'])
    // Four decimals, the step of the file's integers.
    expect(text.at(-1).split('\t')[2]).toMatch(/^\d+\.\d{4}$/)
  })

  it('stops at the next window once aborted', async () => {
    const source = fixture('scaled_pose.e57')
    const header = await readE57Header(source)
    const ctl = new AbortController()
    ctl.abort()
    await expect(readAll(source, header, { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('readCloudHeader', () => {
  it('tells E57 from LAS by the first bytes', async () => {
    expect(isE57(new TextEncoder().encode('ASTM-E57'))).toBe(true)
    const las = await readCloudHeader(bytesSource(makeLas([{ x: 1, y: 2, z: 3 }])))
    expect(las.format).toBeUndefined()
    expect(las.pointCount).toBe(1)
  })

  it('refuses a file cut short', async () => {
    const bytes = new Uint8Array(readFileSync(`${E57_FIXTURES}scaled_pose.e57`))
    await expect(readE57Header(bytesSource(bytes.subarray(0, 100000)))).rejects.toThrow(/incomplete/)
  })

  it('refuses what is not an E57 file', async () => {
    await expect(readE57Header(bytesSource(new Uint8Array(400)))).rejects.toThrow(/not an E57/)
  })
})

// The sample cloud written as E57 imports to the same tiles as the LAZ file it came from.
describe.skipIf(!E57_SAMPLE_PATH)('importPointCloud — the sample as E57', () => {
  const memoryWriter = () => {
    let at = 0
    return { append(bytes) { const o = at; at += bytes.length; return o } }
  }

  it('gives the tiles the LAZ file gives', async () => {
    const e57 = await nodeFileSource(E57_SAMPLE_PATH)
    const laz = await nodeFileSource(LAZ_PATH)
    try {
      const fromE57 = await importPointCloud({ source: e57, header: await readCloudHeader(e57), writer: memoryWriter() })
      const fromLaz = await importPointCloud({
        source: laz, header: await readLasHeader(laz), writer: memoryWriter(), lazPerf: await nodeLazPerf(),
      })
      expect(fromE57.sourcePoints).toBe(3239356)
      expect(fromE57.points).toBe(fromLaz.points)
      expect(fromE57.intensityShift).toBe(fromLaz.intensityShift)
      for (const k of Object.keys(fromLaz.bounds)) expect(fromE57.bounds[k]).toBeCloseTo(fromLaz.bounds[k], 6)
      // Tiles are written as the reader moves on, so their order and segments follow
      // the batches; what each tile holds does not.
      const perTile = (index) => Object.fromEntries(index.tiles.map(([tx, ty, segs]) => [`${tx},${ty}`, segs.reduce((n, g) => n + g[2], 0)]))
      expect(perTile(fromE57)).toEqual(perTile(fromLaz))
    } finally {
      await e57.close()
      await laz.close()
    }
  }, 60000)
})
