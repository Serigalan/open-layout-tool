import { zlibSync, unzlibSync } from 'fflate'

/**
 * The tiles a point cloud is kept in after import (Entscheidungen 116, 117,
 * 145): squares of 2 × 2 m in the cloud's plane. A cross section reads only
 * the tiles its plane passes through.
 *
 * A tile is written as one or more **segments**. Mobile-mapping data arrives
 * in the order it was scanned, so a tile is complete once the scanner has
 * moved on — it is written then and dropped from memory; if a later pass
 * (the way back) brings more points to it, they become a further segment.
 *
 * A cloud is kept in one of two resolutions:
 *
 * - **2-cm voxel** (the default): thinned to one point per voxel, converted
 *   into the project's plane. A segment stores, per point, x and y in
 *   millimetres from the tile's corner and z in millimetres over the
 *   segment's lowest point, each as Uint16, and the intensity as one byte —
 *   7 bytes, sorted by voxel and delta-coded so that zlib finds the
 *   regularity of the voxel grid. A segment taller than 65.535 m is split
 *   into height bands, each a segment of its own.
 * - **Original**: every point, in the file's plane, on the file's own
 *   integer grid (`grid`: scale and offset per axis — a LAS file's, 0.1 mm
 *   for E57) and with the intensity as stored. A segment stores, per point,
 *   x and y in grid steps from the tile's first grid line, z in grid steps
 *   over the segment's lowest point, each as Uint32, and the intensity as
 *   Uint16 — sorted and delta-coded the same way, the bytes of each column
 *   regrouped by significance before zlib.
 */

/** Edge of a tile [m]. */
export const TILE_SIZE = 2
/** Edge of the thinning voxel [m] (Entscheidung 117). */
export const VOXEL_SIZE = 0.02

const TILE_MM = TILE_SIZE * 1000
const VOXEL_MM = VOXEL_SIZE * 1000
const VOXELS_PER_TILE = TILE_MM / VOXEL_MM
const Z_SPAN_MM = 0xFFFF
/** Height a segment of the original resolution may span [grid steps]. */
const Z_SPAN_GRID = 0xFFFFFFFF
/** The grid an E57 file is kept on in the original resolution [m]: its floats have none. */
const E57_GRID_STEP = 0.0001

/** The tile holding a point [m] — integer indices. */
export const tileOf = (e, n) => [Math.floor(e / TILE_SIZE), Math.floor(n / TILE_SIZE)]

/** Shift bringing the intensities of a file into one byte, from the largest seen. */
export function intensityShift(maxIntensity) {
  let shift = 0
  while ((maxIntensity >> shift) > 255) shift++
  return shift
}

/**
 * One segment in bytes: `{ bytes, count, z0 }` with z0 the height its z
 * counts from [mm]. Input: `x`, `y` [mm within the tile, 0…1999], `z` [mm,
 * absolute], `i` [0…255], each an array of `count`; z is at most Z_SPAN_MM
 * over its smallest value (splitIntoBands sees to that).
 */
export function encodeSegment({ x, y, z, i, count }) {
  let z0 = Infinity
  for (let k = 0; k < count; k++) if (z[k] < z0) z0 = z[k]
  // Sorted by z, then y, then x: neighbours in the file are neighbours in
  // space, so the deltas stay small.
  const order = Array.from({ length: count }, (_, k) => k)
  order.sort((a, b) => (z[a] - z[b]) || (y[a] - y[b]) || (x[a] - x[b]))
  const raw = new Uint8Array(count * 7)
  const xs = new Uint16Array(raw.buffer, 0, count)
  const ys = new Uint16Array(raw.buffer, count * 2, count)
  const zs = new Uint16Array(raw.buffer, count * 4, count)
  const is = raw.subarray(count * 6)
  let px = 0, py = 0, pz = 0
  order.forEach((k, n) => {
    const zz = z[k] - z0
    xs[n] = (x[k] - px) & 0xFFFF
    ys[n] = (y[k] - py) & 0xFFFF
    zs[n] = (zz - pz) & 0xFFFF
    is[n] = i[k]
    px = x[k]; py = y[k]; pz = zz
  })
  return { bytes: zlibSync(raw, { level: 6 }), count, z0 }
}

/** A segment back: `{ x, y, z, i }` — x, y [mm in the tile], z [mm over z0], i [byte]. */
export function decodeSegment(bytes, count) {
  const raw = unzlibSync(bytes)
  const xs = new Uint16Array(raw.buffer, raw.byteOffset, count)
  const ys = new Uint16Array(raw.buffer, raw.byteOffset + count * 2, count)
  const zs = new Uint16Array(raw.buffer, raw.byteOffset + count * 4, count)
  const x = new Uint16Array(count), y = new Uint16Array(count), z = new Uint16Array(count)
  let px = 0, py = 0, pz = 0
  for (let n = 0; n < count; n++) {
    px = (px + xs[n]) & 0xFFFF; x[n] = px
    py = (py + ys[n]) & 0xFFFF; y[n] = py
    pz = (pz + zs[n]) & 0xFFFF; z[n] = pz
  }
  return { x, y, z, i: raw.slice(count * 6, count * 7) }
}

/**
 * The grid the original resolution keeps a file's points on: `{ scale,
 * offset }`, each per axis [m]. A LAS file states its own, and its points are
 * integers on it — kept so, they come back to the bit. E57 coordinates are
 * floats, with a pose applied; they are kept to a tenth of a millimetre, or
 * to the file's finest scaled-integer step where that is finer.
 */
export function originalGrid(header) {
  if (header.format === 'e57') {
    const step = Math.min(E57_GRID_STEP, header.scale?.[0] || E57_GRID_STEP)
    return { scale: [step, step, step], offset: [0, 0, 0] }
  }
  return { scale: [...header.scale], offset: [...header.offset] }
}

/** The grid line a tile's points count from along one axis [grid steps]. */
const gridBase = (t, step, offset) => Math.floor((t * TILE_SIZE - offset) / step)

/**
 * Where a segment's points lie, as `{ ox, oy, oz, sx, sy, sz }`: a point
 * (x, y, z) of the decoded segment is at (ox + x·sx, oy + y·sy, oz + z·sz)
 * metres in the cloud's plane. `z0` is the segment's base as its index entry
 * states it.
 */
export function segmentPlacement(cloud, tx, ty, z0) {
  const grid = cloud.grid
  if (!grid) {
    const size = cloud.tileSize
    return { ox: tx * size, oy: ty * size, oz: z0 * 0.001, sx: 0.001, sy: 0.001, sz: 0.001 }
  }
  const [sx, sy, sz] = grid.scale, [gx, gy, gz] = grid.offset
  return {
    ox: gx + gridBase(tx, sx, gx) * sx, oy: gy + gridBase(ty, sy, gy) * sy, oz: gz + z0 * sz,
    sx, sy, sz,
  }
}

/** Byte planes: the k-th byte of every value together, so the zero high bytes of small deltas form runs. */
function shuffle(raw, columns, count) {
  const out = new Uint8Array(raw.length)
  let o = 0, start = 0
  for (const width of columns) {
    for (let b = 0; b < width; b++) for (let k = 0; k < count; k++) out[o++] = raw[start + k * width + b]
    start += count * width
  }
  return out
}

function unshuffle(bytes, columns, count) {
  const out = new Uint8Array(bytes.length)
  let o = 0, start = 0
  for (const width of columns) {
    for (let b = 0; b < width; b++) for (let k = 0; k < count; k++) out[start + k * width + b] = bytes[o++]
    start += count * width
  }
  return out
}

const GRID_COLUMNS = [4, 4, 4, 2]

/**
 * One segment of the original resolution in bytes: `{ bytes, count, z0 }`
 * with z0 the height its z counts from [grid steps]. Input: `x`, `y` [grid
 * steps from the tile's base, ≥ 0], `z` [grid steps, absolute], `i` [as
 * stored, 0…65535]; z spans at most Z_SPAN_GRID.
 */
export function encodeGridSegment({ x, y, z, i, count }) {
  let z0 = Infinity
  for (let k = 0; k < count; k++) if (z[k] < z0) z0 = z[k]
  const order = Array.from({ length: count }, (_, k) => k)
  order.sort((a, b) => (z[a] - z[b]) || (y[a] - y[b]) || (x[a] - x[b]))
  const raw = new Uint8Array(count * 14)
  const xs = new Uint32Array(raw.buffer, 0, count)
  const ys = new Uint32Array(raw.buffer, count * 4, count)
  const zs = new Uint32Array(raw.buffer, count * 8, count)
  const is = new Uint16Array(raw.buffer, count * 12, count)
  let px = 0, py = 0, pz = 0
  order.forEach((k, n) => {
    const zz = z[k] - z0
    xs[n] = (x[k] - px) >>> 0
    ys[n] = (y[k] - py) >>> 0
    zs[n] = (zz - pz) >>> 0
    is[n] = i[k]
    px = x[k]; py = y[k]; pz = zz
  })
  return { bytes: zlibSync(shuffle(raw, GRID_COLUMNS, count), { level: 6 }), count, z0 }
}

/**
 * A segment of the original resolution back: `{ x, y, z, i, intensity }` —
 * x, y [grid steps from the tile's base], z [grid steps over z0], `i` the
 * intensity brought into a byte by `shift` (what the section paints),
 * `intensity` as stored.
 */
export function decodeGridSegment(bytes, count, shift = 0) {
  const raw = unshuffle(unzlibSync(bytes), GRID_COLUMNS, count)
  const xs = new Uint32Array(raw.buffer, 0, count)
  const ys = new Uint32Array(raw.buffer, count * 4, count)
  const zs = new Uint32Array(raw.buffer, count * 8, count)
  const intensity = new Uint16Array(raw.buffer, count * 12, count)
  const x = new Uint32Array(count), y = new Uint32Array(count), z = new Uint32Array(count)
  const i = new Uint8Array(count)
  let px = 0, py = 0, pz = 0
  for (let n = 0; n < count; n++) {
    px = (px + xs[n]) >>> 0; x[n] = px
    py = (py + ys[n]) >>> 0; y[n] = py
    pz = (pz + zs[n]) >>> 0; z[n] = pz
    i[n] = Math.min(255, intensity[n] >> shift)
  }
  return { x, y, z, i, intensity }
}

/** A segment of `cloud` back, in whichever of the two layouts the cloud has. */
export const decodeCloudSegment = (cloud, bytes, count) => (cloud.grid
  ? decodeGridSegment(bytes, count, cloud.intensityShift ?? 0)
  : decodeSegment(bytes, count))

/** Growable typed columns of one tile's points — millimetres, or grid steps where `grid`. */
class Columns {
  constructor(grid = false) {
    this.count = 0
    this.grid = grid
    if (grid) {
      this.x = new Uint32Array(64); this.y = new Uint32Array(64)
      this.z = new Float64Array(64); this.i = new Uint16Array(64)
    } else {
      this.x = new Uint16Array(64); this.y = new Uint16Array(64)
      this.z = new Int32Array(64); this.i = new Uint8Array(64)
    }
  }

  push(x, y, z, i) {
    if (this.count === this.x.length) {
      const grow = (a) => { const b = new a.constructor(a.length * 2); b.set(a); return b }
      this.x = grow(this.x); this.y = grow(this.y); this.z = grow(this.z); this.i = grow(this.i)
    }
    const n = this.count++
    this.x[n] = x; this.y[n] = y; this.z[n] = z; this.i[n] = i
  }
}

/**
 * The points of one tile cut into height bands of at most Z_SPAN_MM each (in
 * the original resolution Z_SPAN_GRID), so that every band fits the
 * segment's heights. A tile of the usual kind is one band.
 */
export function splitIntoBands(cols) {
  const span = cols.grid ? Z_SPAN_GRID : Z_SPAN_MM
  let zMin = Infinity, zMax = -Infinity
  for (let k = 0; k < cols.count; k++) { zMin = Math.min(zMin, cols.z[k]); zMax = Math.max(zMax, cols.z[k]) }
  if (zMax - zMin <= span) return [{ x: cols.x, y: cols.y, z: cols.z, i: cols.i, count: cols.count }]
  const bands = new Map()
  for (let k = 0; k < cols.count; k++) {
    const b = Math.floor((cols.z[k] - zMin) / (span + 1))
    if (!bands.has(b)) bands.set(b, new Columns(cols.grid))
    bands.get(b).push(cols.x[k], cols.y[k], cols.z[k], cols.i[k])
  }
  return [...bands.values()].map(c => ({ x: c.x, y: c.y, z: c.z, i: c.i, count: c.count }))
}

/**
 * Sorts points into tiles and thins them on the way: of all points falling
 * into one 2-cm voxel the first is kept. `add` takes points in metres in the
 * cloud's plane; a tile that has had no new point for `idlePoints` points is
 * handed to `onTile(tx, ty, columns)` and forgotten — its voxels too, so a
 * later pass over it starts a fresh segment.
 *
 * With a `grid` (originalGrid) nothing is thinned: every point is kept, in
 * grid steps, its intensity as given.
 */
export class TileBuilder {
  constructor({ onTile, idlePoints = 2000000, grid = null }) {
    this.onTile = onTile
    this.idlePoints = idlePoints
    this.grid = grid
    this.tiles = new Map()   // key → { tx, ty, cols, voxels: Set, last } (bx, by instead of voxels on a grid)
    this.seen = 0
    this.kept = 0
  }

  add(e, n, z, intensity) {
    if (this.grid) { this.addOnGrid(e, n, z, intensity); return }
    const X = Math.round(e * 1000), Y = Math.round(n * 1000), Z = Math.round(z * 1000)
    const tx = Math.floor(X / TILE_MM), ty = Math.floor(Y / TILE_MM)
    const lx = X - tx * TILE_MM, ly = Y - ty * TILE_MM
    const key = `${tx},${ty}`
    let tile = this.tiles.get(key)
    if (!tile) {
      tile = { tx, ty, cols: new Columns(), voxels: new Set(), last: 0 }
      this.tiles.set(key, tile)
    }
    tile.last = ++this.seen
    const voxel = Math.floor(Z / VOXEL_MM) * VOXELS_PER_TILE * VOXELS_PER_TILE
      + Math.floor(ly / VOXEL_MM) * VOXELS_PER_TILE + Math.floor(lx / VOXEL_MM)
    if (tile.voxels.has(voxel)) return
    tile.voxels.add(voxel)
    tile.cols.push(lx, ly, Z, intensity)
    this.kept++
  }

  addOnGrid(e, n, z, intensity) {
    const { scale: [sx, sy, sz], offset: [gx, gy, gz] } = this.grid
    const u = Math.round((e - gx) / sx), v = Math.round((n - gy) / sy), w = Math.round((z - gz) / sz)
    const tx = Math.floor((gx + u * sx) / TILE_SIZE), ty = Math.floor((gy + v * sy) / TILE_SIZE)
    const key = `${tx},${ty}`
    let tile = this.tiles.get(key)
    if (!tile) {
      tile = { tx, ty, cols: new Columns(true), bx: gridBase(tx, sx, gx), by: gridBase(ty, sy, gy), last: 0 }
      this.tiles.set(key, tile)
    }
    tile.last = ++this.seen
    tile.cols.push(u - tile.bx, v - tile.by, w, intensity)
    this.kept++
  }

  /** Hand on every tile nobody has added to for a while. */
  flushIdle() {
    for (const [key, tile] of this.tiles) {
      if (this.seen - tile.last > this.idlePoints) this.emit(key, tile)
    }
  }

  /** Hand on every tile still held — at the end of the file. */
  flushAll() {
    for (const [key, tile] of this.tiles) this.emit(key, tile)
  }

  emit(key, tile) {
    this.tiles.delete(key)
    if (tile.cols.count) this.onTile(tile.tx, tile.ty, tile.cols)
  }
}
