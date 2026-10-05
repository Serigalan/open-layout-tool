import { describe, it, expect } from 'vitest'
import { detectTrack, topSurface, edgeCandidates } from './railDetect'
import { soHeight, cantMm } from './railTrace'
import { sliceFrame, tilesInSlice, sliceSegment, SlicePoints } from './cloudSlice'
import { importPointCloud } from './importPipeline'
import { readLasHeader } from './lasReader'
import { decodeCloudSegment, segmentPlacement } from './tiles'
import { hasLaz, LAZ_PATH, nodeFileSource, nodeLazPerf } from '../../test/pointCloudFixture'

/** A small deterministic noise source, so a test sees the same slice every run. */
function noise(seed = 1) {
  let s = seed
  return (amp) => {
    s = (s * 16807) % 2147483647
    return ((s / 2147483647) * 2 - 1) * amp
  }
}

/**
 * A slice through a ballasted track, as a mobile scanner running on it sees
 * it: ballast and sleeper, two heads of `head` width with the top `top` [m]
 * over the sleeper, their inner flanks seen down 50 mm, the outer not at all.
 * `axis` [m across], `z` the right head's top, `cant` the left one higher [m].
 */
function trackSlice({ axis = 0, z = 100, cant = 0, head = 0.067, gauge = 1.435, top = 0.17, jitter = 0.002, extra = [] } = {}) {
  const pts = []
  const rnd = noise(7)
  const add = (y, zz) => pts.push([y + rnd(jitter), zz + rnd(jitter)])
  const sleeper = z - top
  for (let y = axis - 2.5; y <= axis + 2.5; y += 0.01) {
    const d = Math.abs(y - axis)
    add(y, d < 1.3 ? sleeper : sleeper - 0.05 - (d - 1.3) * 0.3)
  }
  for (const side of [-1, +1]) {
    const inner = axis + side * gauge / 2          // the inner flank
    const centre = inner + side * head / 2
    const zTop = side < 0 ? z + cant : z
    for (let y = centre - head / 2; y <= centre + head / 2 + 1e-9; y += 0.005) {
      for (let along = 0; along < 5; along++) add(y, zTop - 0.002 * along / 5)
    }
    for (let dz = 0.005; dz <= 0.05; dz += 0.004) add(inner, zTop - dz)
  }
  for (const [y, zz] of extra) add(y, zz)
  const out = { count: pts.length, y: new Float32Array(pts.length), z: new Float64Array(pts.length) }
  pts.forEach(([y, zz], k) => { out.y[k] = y; out.z[k] = zz })
  return out
}

describe('detectTrack on a drawn slice', () => {
  it('finds the axis between the head centres, the top and the cant', () => {
    const det = detectTrack(trackSlice({ axis: 0.12, z: 100, cant: 0.05 }), { around: 0, window: 0.3, rail: '54E4' })
    expect(det.reason).toBeUndefined()
    expect(det.axis).toBeCloseTo(0.12, 2)
    expect(Math.abs(det.axis - 0.12)).toBeLessThan(0.003)
    expect(det.left.y).toBeCloseTo(0.12 - 0.7175 - 0.0335, 2)
    expect(det.gauge).toBeCloseTo(1.435, 2)
    expect(det.cant).toBeCloseTo(0.05, 2)
    expect(det.right.z).toBeCloseTo(100, 2)
    expect(det.quality).toBe('good')
  })

  it('keeps the axis where something leans against a head on its outside', () => {
    // a ramp of ghost points at nearly the head's height outside the left head
    const ramp = []
    for (let y = -0.85; y <= -0.76; y += 0.005) ramp.push([y, 100 - 0.01 - (-0.76 - y) * 0.6])
    const plain = detectTrack(trackSlice(), { rail: '54E4' })
    const cluttered = detectTrack(trackSlice({ extra: ramp }), { rail: '54E4' })
    expect(Math.abs(cluttered.axis - plain.axis)).toBeLessThan(0.002)
  })

  it('is not misled by a roof over the track', () => {
    const roof = []
    for (let y = -2.5; y <= 2.5; y += 0.01) roof.push([y, 105.5])
    const det = detectTrack(trackSlice({ extra: roof }), { rail: '54E4' })
    expect(Math.abs(det.axis)).toBeLessThan(0.003)
  })

  it('takes the head width of the profile', () => {
    const det = detectTrack(trackSlice({ head: 0.072 }), { rail: '60E2' })
    expect(Math.abs(det.axis)).toBeLessThan(0.003)
    expect(det.right.y).toBeCloseTo(0.7175 + 0.036, 2)
  })

  it('says so where there are no heads, or none at the gauge', () => {
    const ground = { count: 500, y: new Float32Array(500).map((_, k) => -2.5 + k * 0.01), z: new Float64Array(500).fill(99.8) }
    expect(detectTrack(ground, { rail: '54E4' }).reason).toBe('no_heads')
    const narrow = detectTrack(trackSlice({ gauge: 1.0 }), { rail: '54E4' })
    expect(narrow.reason).toBe('no_pair')
  })

  it('does not take a head lower over the ground than a worn rail is tall', () => {
    expect(detectTrack(trackSlice({ top: 0.10 }), { rail: '54E4' }).reason).toBe('no_pair')
    expect(detectTrack(trackSlice({ top: 0.14 }), { rail: '54E4' }).reason).toBeUndefined()
  })

  it('finds the inner edges facing each other', () => {
    const slice = trackSlice()
    const surface = topSurface(slice, -1.2, 1.2)
    const lefts = edgeCandidates(surface, -1.2, 1.2, 0.067, +1)
    const rights = edgeCandidates(surface, -1.2, 1.2, 0.067, -1)
    expect(lefts.some(e => Math.abs(e.y + 0.7175) < 0.01)).toBe(true)
    expect(rights.some(e => Math.abs(e.y - 0.7175) < 0.01)).toBe(true)
  })
})

describe('what an axis point states', () => {
  const det = { left: { z: 100.05 }, right: { z: 100 }, cant: 0.05 }
  it('takes the lower head for the top of rail by DB, or the one chosen', () => {
    expect(soHeight(det)).toBe(100)
    expect(soHeight(det, 'axis')).toBeCloseTo(100.025, 6)
    expect(soHeight(det, 'left')).toBe(100.05)
    expect(soHeight(det, 'right')).toBe(100)
  })
  it('gives the cant in millimetres and none under the noise', () => {
    expect(cantMm(det)).toBe(50)
    expect(cantMm({ cant: -0.002 })).toBe(0)
    expect(cantMm({ cant: -0.004 })).toBe(-4)
  })
})

// The sample: a station, scanned from a train on the track whose axis runs
// about 1.52 m right of the line through (4470687, 5332208) at 45.35°.
describe.skipIf(!hasLaz)('detectTrack on the LAZ sample', () => {
  it('finds the track the scanner ran on at every station, its axis smooth', async () => {
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
    const rad = 45.35 * Math.PI / 180
    const axes = []
    for (let s = -8; s <= 6; s += 0.5) {
      const frame = sliceFrame({
        easting: 4470687 + Math.sin(rad) * s, northing: 5332208 + Math.cos(rad) * s,
        bearing: 45.35, halfWidth: 3, thickness: 0.5,
      })
      const out = new SlicePoints()
      for (const [tx, ty, segs] of tilesInSlice(index, frame)) {
        for (const [offset, length, count, z0] of segs) {
          sliceSegment(out, decodeCloudSegment(index, bytes.subarray(offset, offset + length), count),
            segmentPlacement(index, tx, ty, z0), frame)
        }
      }
      const det = detectTrack(out, { around: 1.53, window: 0.3, rail: '54E4' })
      expect(det.reason).toBeUndefined()
      expect(det.quality).toBe('good')
      expect(det.gauge).toBeGreaterThan(1.42)
      expect(det.gauge).toBeLessThan(1.435)
      expect(det.right.z).toBeCloseTo(531.51, 1)
      axes.push(det.axis)
    }
    // The track runs a little oblique to the line; what is left after a
    // straight line through the axis points is the measurement's scatter.
    const n = axes.length, xs = axes.map((_, i) => i)
    const mx = (n - 1) / 2, my = axes.reduce((a, b) => a + b) / n
    const slope = xs.reduce((a, x, i) => a + (x - mx) * (axes[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0)
    const residuals = axes.map((y, i) => y - (my + slope * (i - mx)))
    expect(Math.max(...residuals.map(Math.abs))).toBeLessThan(0.006)
    const rms = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / n)
    expect(rms).toBeLessThan(0.002)
  }, 60000)
})
