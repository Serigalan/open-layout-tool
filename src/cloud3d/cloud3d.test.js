import { describe, it, expect } from 'vitest'
import { buildTree, selectNodes } from './lod'
import { trackSamples, trackLines, nearestOnTracks, sectionPlane } from './trackGeometry'

// A cloud of 256 × 64 m, its levels as indexes: every tile holds points.
function levels() {
  const out = {}
  for (const [l, size, per] of [[4, 128, 10], [3, 32, 100], [2, 8, 1000], [1, 2, 5000]]) {
    const tiles = []
    for (let x = 0; x < 256 / size; x++) for (let y = 0; y < 64 / size; y++) tiles.push([x, y, [[0, 10, per, 0]]])
    out[l] = { tileSize: size, tiles, bounds: { minZ: 0, maxZ: 10 } }
  }
  return out
}

describe('the tree of the levels (AP 13.9)', () => {
  it('hangs every tile under the one of the next coarser level that holds it', () => {
    const { roots, nodes } = buildTree('c', levels())
    expect(roots).toHaveLength(2)
    expect(roots[0].children).toHaveLength(8)          // 4 × 2 of 32 m under 128 × 64 m
    expect(roots[0].children[0].children).toHaveLength(16)
    expect(nodes.filter(n => n.level === 1)).toHaveLength(128 * 32)
    expect(new Set(nodes.map(n => n.id)).size).toBe(nodes.length)
  })

  const camera = (at) => ({
    visible: () => true,
    distance: ({ box: b }) => Math.hypot(Math.max(b[0] - at[0], 0, at[0] - b[3]), Math.max(b[1] - at[1], 0, at[1] - b[4]), Math.max(b[2] - at[2], 0, at[2] - b[5])),
    projScale: 1000,
  })

  it('asks for the coarsest tiles first and draws nothing it does not have', () => {
    const { roots } = buildTree('c', levels())
    const r = selectNodes(roots, { ...camera([10, 10, 50]), isLoaded: () => false, budget: 1e6 })
    expect(r.draw).toEqual([])
    expect(r.load.map(n => n.level)).toEqual([4, 4])
  })

  it('draws a tile instead of its children, finer near the camera, within the budget', () => {
    const { roots, nodes } = buildTree('c', levels())
    const all = () => true
    const near = selectNodes(roots, { ...camera([10, 10, 5]), isLoaded: all, budget: 3e5 })
    expect(near.points).toBeLessThanOrEqual(3e5)
    const levelsDrawn = new Set(near.draw.map(n => n.level))
    expect(levelsDrawn.has(1)).toBe(true)
    // Nothing is drawn together with an ancestor of it.
    const drawn = new Set(near.draw)
    for (const n of nodes) if (drawn.has(n)) for (const c of n.children) expect(drawn.has(c)).toBe(false)
    // Far away the coarse levels do.
    const far = selectNodes(roots, { ...camera([10, 10, 5000]), isLoaded: all, budget: 3e5 })
    expect(Math.min(...far.draw.map(n => n.level))).toBeGreaterThanOrEqual(3)
  })
})

const track = {
  id: 't', epsg: 25832,
  elements: [{ elementType: 0, bearing: 0, length: 100, absLength: 100, startNode: [500000, 5700000], endNode: [500000, 5700100], cant: 100 }],
  heights: [{ station: 0, z: 100 }, { station: 100, z: 110 }],
}

describe('the tracks in 3D (AP 13.10, 13.11)', () => {
  it('samples a track along its axis at the height of its gradient', () => {
    const s = trackSamples(track, { tracks: [track] })
    expect(s).toHaveLength(201)
    expect(s[100]).toMatchObject({ s: 50, e: 500000, cant: 100 })
    expect(s[100].n).toBeCloseTo(5700050, 6)
    expect(s[100].z).toBeCloseTo(105, 6)
  })

  it('lifts the left running circle by a positive cant', () => {
    const lines = trackLines(trackSamples(track, { tracks: [track] }))
    const [l] = lines.left, [r] = lines.right
    expect(l[0][0]).toBeCloseTo(499999.25, 6)   // heading north, left is west
    expect(r[0][0]).toBeCloseTo(500000.75, 6)
    expect(l[0][2] - r[0][2]).toBeCloseTo(0.1, 6)
  })

  it('says where a point lies along the nearest track, right of it positive', () => {
    const t = { id: 't', samples: trackSamples(track, { tracks: [track] }) }
    const hit = nearestOnTracks([t], 500001.5, 5700020.25)
    expect(hit.station).toBeCloseTo(20.25, 6)
    expect(hit.offset).toBeCloseTo(1.5, 6)
    expect(hit.z).toBeCloseTo(102.025, 6)
    expect(nearestOnTracks([t], 500100, 5700020)).toBe(null)
  })

  it('stands the section plane square on the track at the station, the outline on SO', () => {
    const plane = sectionPlane(trackSamples(track, { tracks: [track] }), 30, { ring: [[-1000, 0], [1000, 0], [0, 4000]], halfWidth: 10 })
    expect(plane.at.z).toBeCloseTo(103, 6)
    expect(plane.quad[0][0]).toBeCloseTo(499990, 6)
    expect(plane.quad[0][1]).toBeCloseTo(5700030, 6)
    expect(plane.outline).toHaveLength(3)
    expect(plane.outline[2][2]).toBeGreaterThan(106.9)
  })
})

describe('measuring (AP 13.11)', async () => {
  const { between, measurementsCsv, originalPoint } = await import('./measure')
  const { encodeGridSegment } = await import('../utils/pointCloud/tiles')

  it('takes the original point nearest to the one picked, within 10 cm', async () => {
    // One tile of the original on a millimetre grid: three points.
    const grid = { scale: [0.001, 0.001, 0.001], offset: [0, 0, 0] }
    const pts = [[100, 200, 531000], [130, 200, 531010], [1900, 1900, 531500]]
    const seg = encodeGridSegment({
      count: 3, x: Uint32Array.from(pts.map(p => p[0])), y: Uint32Array.from(pts.map(p => p[1])),
      z: Float64Array.from(pts.map(p => p[2])), i: Uint16Array.from([1000, 2000, 3000]),
    })
    const bytes = seg.bytes
    const l0 = {
      id: 'c', tileSize: 2, grid, intensityShift: 8, tiles: [[1000, 2000, [[0, bytes.length, 3, seg.z0]]]],
      source: { readMany: async (ranges) => ranges.map(([o, l]) => bytes.subarray(o, o + l)) },
    }
    const hit = await originalPoint('p', l0, [2000.128, 4000.2, 531.012])
    expect(hit.e).toBeCloseTo(2000.130, 9)
    expect(hit.z).toBeCloseTo(531.010, 9)
    expect(hit.intensity).toBe(2000)
    expect(await originalPoint('p', l0, [2001.5, 4001.5, 531.0])).toBe(null)
  })

  it('states distances between points and writes them as CSV', () => {
    const a = { e: 0, n: 0, z: 100 }, b = { e: 3, n: 4, z: 112 }
    expect(between(a, b)).toEqual({ distance: 13, dh: 12, horizontal: 5 })
    const csv = measurementsCsv([{ ...a, track: 'G1', station: 10, offset: -1.5, overSo: 0.2 }, b], { crs: 5678 })
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[2]).toBe('1;0.000;0.000;100.000;;G1;10.000;-1.500;0.200;;;')
    expect(lines[3].endsWith(';13.000;12.000;5.000')).toBe(true)
  })
})
