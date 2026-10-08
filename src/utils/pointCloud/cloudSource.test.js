import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importLevels, importPointCloud } from './importPipeline'
import { readLasHeader } from './lasReader'
import { bytesSource, makeLas } from '../../test/pointCloudFixture'

// The server's tile files, as the mocked API serves them: "cloudId|level" → bytes.
const served = new Map()
const calls = []
vi.mock('../../api/client', () => ({
  api: {
    cloudRanges: async (projectId, cloudId, level, ranges) => {
      calls.push(ranges.length)
      const file = served.get(`${cloudId}|${level}`)
      const out = new Uint8Array(ranges.reduce((n, r) => n + r[1], 0))
      let at = 0
      for (const [o, l] of ranges) { out.set(file.subarray(o, o + l), at); at += l }
      return out
    },
  },
}))

const { sourceOf } = await import('./cloudSource')
const { transformMatrix, applyMatrix, invertMatrix } = await import('./registration')
const { cloudSectionPoints } = await import('./cloudSection')

const memoryWriter = () => {
  const parts = []
  let at = 0
  return {
    append(bytes) { const o = at; parts.push(bytes); at += bytes.length; return o },
    bytes() {
      const out = new Uint8Array(at)
      let o = 0
      for (const p of parts) { out.set(p, o); o += p.length }
      return out
    },
  }
}

const memorySource = (bytes) => ({
  readMany: async (ranges) => ranges.map(([o, l]) => bytes.subarray(o, o + l)),
  read: async (o, l) => bytes.subarray(o, o + l),
})

// A track's surroundings: 6000 points over 30 × 10 m, mixed heights.
const PTS = Array.from({ length: 6000 }, (_, k) => ({
  x: 4470000 + (k % 300) * 0.1 + (k % 7) * 0.003, y: 5332000 + Math.floor(k / 300) * 0.5, z: 530 + (k % 13) * 0.17,
  intensity: (k * 101) % 65536, red: (k % 200) << 8, green: 7 << 8, blue: 9 << 8,
}))

beforeEach(() => { calls.length = 0 })

describe('a cloud read from the server (AP 13.6)', () => {
  it('asks for at most 64 ranges a request and gives the bytes back in the order asked', async () => {
    const file = Uint8Array.from({ length: 100000 }, (_, k) => k % 251)
    served.set('c1|1', file)
    const ranges = Array.from({ length: 150 }, (_, k) => [(k * 613) % 99000, 1 + (k % 50)]).reverse()
    const got = await sourceOf('p', { id: 'c1', server: { level: 1 } }).readMany(ranges)
    expect(calls).toEqual([64, 64, 22])
    ranges.forEach(([o, l], k) => expect(Array.from(got[k])).toEqual(Array.from(file.subarray(o, o + l))))
  })

  it('a range asked for twice at once goes over the network once', async () => {
    served.set('c2|1', Uint8Array.from({ length: 5000 }, (_, k) => k % 7))
    const src = sourceOf('p', { id: 'c2', server: { level: 1 } })
    const [a, b] = await Promise.all([src.readMany([[0, 100], [200, 50]]), src.readMany([[200, 50], [400, 10]])])
    expect(calls).toEqual([2, 1])
    expect(Array.from(b[0])).toEqual(Array.from(a[1]))
  })

  it('gives the same points at a station as the same file read in on this device', async () => {
    const source = bytesSource(makeLas(PTS, { offset: [4470000, 5332000, 500], format: 3 }))
    const header = await readLasHeader(source)
    const local = memoryWriter(), remote = memoryWriter()
    const localIndex = await importPointCloud({ source, header, writer: local })
    const remoteIndex = (await importLevels({ source, header, writers: { 1: remote }, levels: [1] }))[1]
    served.set('srv|1', remote.bytes())
    const frame = { origin: { easting: 4470015.03, northing: 5332005.1 }, bearing: 80, crs: 5678, halfWidth: 8, thickness: 0.1 }
    const a = await cloudSectionPoints('p', { ...localIndex, id: 'loc', crs: 5678, source: memorySource(local.bytes()) }, frame)
    const b = await cloudSectionPoints('p', { ...remoteIndex, id: 'srv', crs: 5678, server: { level: 1 } }, frame)
    expect(a.count).toBeGreaterThan(15)
    const rows = (p) => Array.from({ length: p.count }, (_, k) => [p.y[k], p.z[k], p.i[k], ...p.rgb.subarray(3 * k, 3 * k + 3)].join()).sort()
    expect(rows(b)).toEqual(rows(a))
    expect(calls.length).toBe(1)
  })
})

describe('a re-referenced cloud (AP 13.13, 13.15)', () => {
  /** The points of PTS carried by `m`, as the file of a cloud that T = m⁻¹ puts back. */
  const moved = (m) => PTS.map(p => { const [x, y, z] = applyMatrix(m, [p.x, p.y, p.z]); return { ...p, x, y, z } })
  const original = async (points, offset) => {
    const source = bytesSource(makeLas(points, { offset, format: 3 }))
    const header = await readLasHeader(source)
    const w = memoryWriter()
    const index = (await importLevels({ source, header, writers: { 0: w }, levels: [0] }))[0]
    return { ...index, source: memorySource(w.bytes()) }
  }
  const rows = (p) => Array.from({ length: p.count }, (_, k) => [p.y[k], p.z[k]])
  const frame = { origin: { easting: 4470015.03, northing: 5332005.1 }, bearing: 80, crs: 5678, halfWidth: 8, thickness: 0.1 }

  it.each([
    ['a residual offset in the same plane', 5678, { tE: 0.3, tN: -0.2, tH: 0.05, kappa: 0.0008 }, [4470000, 5332000, 500]],
    ['a scan in a local system, turned', null, { tE: -4470000, tN: -5332000, tH: -500, kappa: 1.2 }, [0, 0, 0]],
  ])('reads %s as the cloud it was fitted to', async (_, crs, params, offset) => {
    const toFile = transformMatrix(params, [4470015, 5332005, 531])
    const ref = await original(PTS, [4470000, 5332000, 500])
    const fitted = await original(moved(toFile), offset)
    const a = await cloudSectionPoints('p', { ...ref, id: `ref${crs}`, crs: 5678 }, frame)
    const b = await cloudSectionPoints('p', {
      ...fitted, id: `fit${crs}`, crs, transform: { matrix: invertMatrix(toFile), crs: 5678 },
    }, frame)
    expect(a.count).toBeGreaterThan(15)
    expect(Math.abs(b.count - a.count)).toBeLessThanOrEqual(2)
    for (const [y, z] of rows(a)) {
      expect(rows(b).some(([y2, z2]) => Math.abs(y2 - y) < 0.002 && Math.abs(z2 - z) < 0.002)).toBe(true)
    }
  })
})
