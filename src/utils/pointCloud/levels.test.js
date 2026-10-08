import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { importLevels, importPointCloud } from './importPipeline'
import { readLasHeader } from './lasReader'
import { readE57Header } from './e57Reader'
import {
  LEVELS, decodeCloudSegment, decodeSegment, decodeGridSegment, encodeGridSegment, encodeSegment, segmentPlacement,
} from './tiles'
import { E57_FIXTURES, bytesSource, makeLas } from '../../test/pointCloudFixture'

// The levels of detail and colour (AP 13.4, decisions 206, 215).

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

/** Every point of a level, absolute [mm, rounded], with intensity and colour. */
function readBack(index, bytes) {
  const pts = []
  for (const [tx, ty, segs] of index.tiles) {
    for (const [at, length, count, z0] of segs) {
      const s = decodeCloudSegment(index, bytes.subarray(at, at + length), count)
      const p = segmentPlacement(index, tx, ty, z0)
      for (let k = 0; k < count; k++) {
        pts.push({
          x: Math.round((p.ox + s.x[k] * p.sx) * 1000), y: Math.round((p.oy + s.y[k] * p.sy) * 1000),
          z: Math.round((p.oz + s.z[k] * p.sz) * 1000),
          i: s.intensity?.[k] ?? s.i[k], rgb: s.r ? [s.r[k], s.g[k], s.b[k]] : null,
        })
      }
    }
  }
  return pts
}

const key = (p) => `${p.x},${p.y},${p.z}`

describe('the levels of detail', () => {
  // Points on a 64-mm lattice, shifted by 32 mm: every level states them
  // exactly (its unit, at most 32 mm, divides both).
  const base = [4470000, 5332000, 500]
  const pts = []
  let seed = 7
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  for (let k = 0; k < 6000; k++) {
    const [a, b, c] = [rand(2500), rand(150), rand(120)]
    pts.push({
      x: base[0] + a * 0.064 + 0.032, y: base[1] + b * 0.064 + 0.032, z: base[2] + c * 0.064 + 0.032,
      intensity: rand(65536), red: rand(256) << 8, green: rand(256) << 8, blue: rand(256) << 8,
    })
  }

  async function run() {
    const source = bytesSource(makeLas(pts, { offset: base, format: 3 }))
    const header = await readLasHeader(source)
    const writers = Object.fromEntries(LEVELS.map(l => [l.level, memoryWriter()]))
    const index = await importLevels({ source, header, writers, levels: [0, 1, 2, 3, 4] })
    return { header, index, back: LEVELS.map(l => readBack(index[l.level], writers[l.level].bytes())) }
  }

  it('come out of one pass, each an index of version 3 with colour', async () => {
    const { header, index } = await run()
    expect(header.rgb).toBe(true)
    for (const l of LEVELS) {
      expect(index[l.level]).toMatchObject({ version: 3, level: l.level, tileSize: l.tileSize, rgb: true, sourcePoints: pts.length })
    }
    expect(index[0]).toMatchObject({ resolution: 'original', points: pts.length })
    expect(index[4]).toMatchObject({ resolution: 'voxel', voxel: 1.28, perMetre: 31.25 })
  })

  it('L0 keeps every point with intensity and colour; colour comes back on 8 bits unchanged', async () => {
    const { back } = await run()
    const want = pts.map(p => `${key({ x: Math.round(p.x * 1000), y: Math.round(p.y * 1000), z: Math.round(p.z * 1000) })}|${p.intensity}|${p.red >> 8},${p.green >> 8},${p.blue >> 8}`)
    const got = back[0].map(p => `${key(p)}|${p.i}|${p.rgb.join(',')}`)
    expect(got.sort()).toEqual(want.sort())
  })

  it('keep one point per voxel — as many as an independent count says', async () => {
    const { back } = await run()
    for (const l of LEVELS.slice(1)) {
      const mm = Math.round(l.voxel * 1000)
      const voxels = new Set(pts.map(p => [p.x, p.y, p.z].map(v => Math.floor(Math.round(v * 1000) / mm)).join(',')))
      expect(back[l.level], `L${l.level}`).toHaveLength(voxels.size)
    }
    expect(back[4].length).toBeLessThan(back[3].length)
  })

  it('each coarser level is a selection of the finer one, colour included', async () => {
    const { back } = await run()
    for (let l = 1; l < LEVELS.length; l++) {
      const finer = new Set(back[l - 1].map(p => `${key(p)}|${p.rgb.join(',')}`))
      for (const p of back[l]) expect(finer.has(`${key(p)}|${p.rgb.join(',')}`), `L${l}`).toBe(true)
    }
  })

  it('a file without colour costs nothing extra and says so', async () => {
    const plain = pts.map(({ red: _r, green: _g, blue: _b, ...p }) => p)
    const source = bytesSource(makeLas(plain, { offset: base }))
    const header = await readLasHeader(source)
    const writer = memoryWriter()
    const index = await importPointCloud({ source, header, writer })
    expect(index).toMatchObject({ version: 3, level: 1, rgb: false })
    expect(readBack(index, writer.bytes())[0].rgb).toBe(null)
  })
})

describe('segments with colour', () => {
  it('come back as they went in, voxel and grid alike', () => {
    const n = 3000
    const cols = (type) => ({
      count: n,
      x: type.from({ length: n }, (_, k) => (k * 37) % 2000), y: type.from({ length: n }, (_, k) => (k * 91) % 2000),
      i: Uint8Array.from({ length: n }, (_, k) => k % 256),
      r: Uint8Array.from({ length: n }, (_, k) => (k * 7) % 256), g: Uint8Array.from({ length: n }, (_, k) => (k * 11) % 256),
      b: Uint8Array.from({ length: n }, (_, k) => (k * 13) % 256),
    })
    const vox = { ...cols(Uint16Array), z: Int32Array.from({ length: n }, (_, k) => 500000 + (k * 13) % 7000) }
    const segV = encodeSegment(vox)
    const backV = decodeSegment(segV.bytes, n, true)
    const grid = { ...cols(Uint32Array), z: Float64Array.from({ length: n }, (_, k) => 5000000 + (k * 13) % 7000) }
    const segG = encodeGridSegment(grid)
    const backG = decodeGridSegment(segG.bytes, n, 0, true)
    for (const [input, seg, back] of [[vox, segV, backV], [grid, segG, backG]]) {
      const want = Array.from({ length: n }, (_, k) => [input.x[k], input.y[k], input.z[k] - seg.z0, input.r[k], input.g[k], input.b[k]].join())
      const got = Array.from({ length: n }, (_, k) => [back.x[k], back.y[k], back.z[k], back.r[k], back.g[k], back.b[k]].join())
      expect(got.sort()).toEqual(want.sort())
    }
  })
})

describe('E57 with colour', () => {
  const EXPECTED = JSON.parse(readFileSync(`${E57_FIXTURES}expected.json`, 'utf8'))['color_rgb.e57']

  it('carries its three channels into the tiles on 8 bits', async () => {
    const source = bytesSource(new Uint8Array(readFileSync(`${E57_FIXTURES}color_rgb.e57`)))
    const header = await readE57Header(source)
    expect(header.rgb).toBe(true)
    const writer = memoryWriter()
    const index = await importPointCloud({ source, header, writer, original: true })
    expect(index).toMatchObject({ rgb: true, points: EXPECTED.count })
    const back = readBack(index, writer.bytes())
    const sums = [0, 1, 2].map(c => back.reduce((s, p) => s + p.rgb[c], 0))
    expect(sums).toEqual(EXPECTED.rgbSum)
  })

  it('without all three channels it has no colour', async () => {
    const header = await readE57Header(bytesSource(new Uint8Array(readFileSync(`${E57_FIXTURES}scaled_pose.e57`))))
    expect(header.rgb).toBe(false)
  })
})
