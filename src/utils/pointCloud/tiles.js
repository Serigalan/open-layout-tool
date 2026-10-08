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
 * - **Voxel** (the default; 2 cm): thinned to one point per voxel — the first
 *   to arrive. A segment stores, per point, x and y in units of the level
 *   (a millimetre at 2 cm) from the tile's corner and z in units over the
 *   segment's lowest point, each as Uint16, and the intensity as one byte —
 *   7 bytes, sorted by voxel and delta-coded so that zlib finds the
 *   regularity of the voxel grid. A segment taller than 65 535 units is split
 *   into height bands, each a segment of its own. The local import keeps it
 *   in the project's plane; the server in the file's (decision 205).
 * - **Original**: every point, in the file's plane, on the file's own
 *   integer grid (`grid`: scale and offset per axis — a LAS file's, 0.1 mm
 *   for E57) and with the intensity as stored. A segment stores, per point,
 *   x and y in grid steps from the tile's first grid line, z in grid steps
 *   over the segment's lowest point, each as Uint32, and the intensity as
 *   Uint16 — sorted and delta-coded the same way, the bytes of each column
 *   regrouped by significance before zlib.
 *
 * With colour (`rgb`, index version 3, decision 215) three byte columns
 * follow — red, green, blue on 8 bits, delta-coded in the same order; every
 * point keeps its own colour, nothing is averaged. A file without colour
 * costs nothing extra.
 *
 * On the server a cloud has five levels of detail (decision 206, LEVELS):
 * L0 the original, L1 the 2-cm voxel and L2–L4 coarser voxels in larger
 * tiles, each a cloud index of its own. A coarser level is a selection of the
 * finer one: a point is first in its coarse voxel only if it is first in the
 * fine voxel inside it.
 */

/** Edge of a tile [m]. */
export const TILE_SIZE = 2
/**
 * The levels of detail (decision 206): tile edge and voxel [m], and for a
 * voxel level the unit its coordinates are counted in — `perMetre` units a
 * metre, so a tile is `tileUnits` units wide (fits Uint16) and a voxel
 * `voxelUnits`. Every voxel level has 100 × 100 voxels a tile. L0 keeps the
 * file's own grid.
 */
export const LEVELS = [
  { level: 0, tileSize: 2, voxel: null },
  { level: 1, tileSize: 2, voxel: 0.02, perMetre: 1000, tileUnits: 2000, voxelUnits: 20 },
  { level: 2, tileSize: 8, voxel: 0.08, perMetre: 500, tileUnits: 4000, voxelUnits: 40 },
  { level: 3, tileSize: 32, voxel: 0.32, perMetre: 125, tileUnits: 4000, voxelUnits: 40 },
  { level: 4, tileSize: 128, voxel: 1.28, perMetre: 31.25, tileUnits: 4000, voxelUnits: 40 },
]
const VOXEL_DEFAULT = LEVELS[1]

const Z_SPAN_UNITS = 0xFFFF
/** Height a segment of the original resolution may span [grid steps]. */
const Z_SPAN_GRID = 0xFFFFFFFF
/** The grid an E57 file is kept on in the original resolution [m]: its floats have none. */
const E57_GRID_STEP = 0.0001

/** The tile holding a point [m] — integer indices. */
export const tileOf = (e, n) => [Math.floor(e / TILE_SIZE), Math.floor(n / TILE_SIZE)]

/** A Map key for tile (tx, ty), |tx|, |ty| < 2²⁵. */
const tileKey = (tx, ty) => (tx + 33554432) * 67108864 + (ty + 33554432)

/** Shift bringing 16-bit colours into one byte: none where they are 8-bit already. */
export const colorShift = (max) => (max > 255 ? 8 : 0)

/** Delta-code one byte column in `order` into `out`. */
function deltaBytes(out, values, order) {
  let p = 0
  order.forEach((k, n) => { out[n] = (values[k] - p) & 0xFF; p = values[k] })
}

/** The byte column back from its deltas. */
function undeltaBytes(deltas, count) {
  const out = new Uint8Array(count)
  let p = 0
  for (let n = 0; n < count; n++) { p = (p + deltas[n]) & 0xFF; out[n] = p }
  return out
}

/** Shift bringing the intensities of a file into one byte, from the largest seen. */
export function intensityShift(maxIntensity) {
  let shift = 0
  while ((maxIntensity >> shift) > 255) shift++
  return shift
}

/**
 * One segment in bytes: `{ bytes, count, z0 }` with z0 the height its z
 * counts from [units]. Input: `x`, `y` [units within the tile, below
 * 65 536], `z` [units, absolute], `i` [0…255] and, with colour, `r`, `g`, `b`
 * [0…255], each an array of `count`; z is at most Z_SPAN_UNITS over its
 * smallest value (splitIntoBands sees to that).
 */
export function encodeSegment({ x, y, z, i, r, g, b, count }) {
  let z0 = Infinity
  for (let k = 0; k < count; k++) if (z[k] < z0) z0 = z[k]
  // Sorted by z, then y, then x: neighbours in the file are neighbours in
  // space, so the deltas stay small.
  const order = Array.from({ length: count }, (_, k) => k)
  order.sort((a, b) => (z[a] - z[b]) || (y[a] - y[b]) || (x[a] - x[b]))
  const rgb = !!r
  const raw = new Uint8Array(count * (rgb ? 10 : 7))
  const xs = new Uint16Array(raw.buffer, 0, count)
  const ys = new Uint16Array(raw.buffer, count * 2, count)
  const zs = new Uint16Array(raw.buffer, count * 4, count)
  const is = raw.subarray(count * 6, count * 7)
  let px = 0, py = 0, pz = 0
  order.forEach((k, n) => {
    const zz = z[k] - z0
    xs[n] = (x[k] - px) & 0xFFFF
    ys[n] = (y[k] - py) & 0xFFFF
    zs[n] = (zz - pz) & 0xFFFF
    is[n] = i[k]
    px = x[k]; py = y[k]; pz = zz
  })
  if (rgb) {
    deltaBytes(raw.subarray(count * 7, count * 8), r, order)
    deltaBytes(raw.subarray(count * 8, count * 9), g, order)
    deltaBytes(raw.subarray(count * 9, count * 10), b, order)
  }
  return { bytes: zlibSync(raw, { level: 6 }), count, z0 }
}

/**
 * A segment back: `{ x, y, z, i }` — x, y [units in the tile], z [units over
 * z0], i [byte] — and with `rgb` its colour `r`, `g`, `b` [byte].
 */
export function decodeSegment(bytes, count, rgb = false) {
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
  const seg = { x, y, z, i: raw.slice(count * 6, count * 7) }
  if (rgb) {
    seg.r = undeltaBytes(raw.subarray(count * 7, count * 8), count)
    seg.g = undeltaBytes(raw.subarray(count * 8, count * 9), count)
    seg.b = undeltaBytes(raw.subarray(count * 9, count * 10), count)
  }
  return seg
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
    const unit = 1 / (cloud.perMetre ?? 1000)
    return { ox: tx * size, oy: ty * size, oz: z0 * unit, sx: unit, sy: unit, sz: unit }
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
const GRID_RGB_COLUMNS = [4, 4, 4, 2, 1, 1, 1]

/**
 * One segment of the original resolution in bytes: `{ bytes, count, z0 }`
 * with z0 the height its z counts from [grid steps]. Input: `x`, `y` [grid
 * steps from the tile's base, ≥ 0], `z` [grid steps, absolute], `i` [as
 * stored, 0…65535] and, with colour, `r`, `g`, `b` [0…255]; z spans at most
 * Z_SPAN_GRID.
 */
export function encodeGridSegment({ x, y, z, i, r, g, b, count }) {
  let z0 = Infinity
  for (let k = 0; k < count; k++) if (z[k] < z0) z0 = z[k]
  const order = Array.from({ length: count }, (_, k) => k)
  order.sort((a, b) => (z[a] - z[b]) || (y[a] - y[b]) || (x[a] - x[b]))
  const rgb = !!r
  const raw = new Uint8Array(count * (rgb ? 17 : 14))
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
  if (rgb) {
    deltaBytes(raw.subarray(count * 14, count * 15), r, order)
    deltaBytes(raw.subarray(count * 15, count * 16), g, order)
    deltaBytes(raw.subarray(count * 16, count * 17), b, order)
  }
  return { bytes: zlibSync(shuffle(raw, rgb ? GRID_RGB_COLUMNS : GRID_COLUMNS, count), { level: 6 }), count, z0 }
}

/**
 * A segment of the original resolution back: `{ x, y, z, i, intensity }` —
 * x, y [grid steps from the tile's base], z [grid steps over z0], `i` the
 * intensity brought into a byte by `shift` (what the section paints),
 * `intensity` as stored — and with `rgb` its colour `r`, `g`, `b` [byte].
 */
export function decodeGridSegment(bytes, count, shift = 0, rgb = false) {
  const raw = unshuffle(unzlibSync(bytes), rgb ? GRID_RGB_COLUMNS : GRID_COLUMNS, count)
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
  const seg = { x, y, z, i, intensity }
  if (rgb) {
    seg.r = undeltaBytes(raw.subarray(count * 14, count * 15), count)
    seg.g = undeltaBytes(raw.subarray(count * 15, count * 16), count)
    seg.b = undeltaBytes(raw.subarray(count * 16, count * 17), count)
  }
  return seg
}

/** A segment of `cloud` back, in whichever of the two layouts the cloud has. */
export const decodeCloudSegment = (cloud, bytes, count) => (cloud.grid
  ? decodeGridSegment(bytes, count, cloud.intensityShift ?? 0, !!cloud.rgb)
  : decodeSegment(bytes, count, !!cloud.rgb))

/** Growable typed columns of one tile's points — units of the level, or grid steps where `grid`; colour with `rgb`. */
class Columns {
  constructor(grid = false, rgb = false) {
    this.count = 0
    this.grid = grid
    if (grid) {
      this.x = new Uint32Array(64); this.y = new Uint32Array(64)
      this.z = new Float64Array(64); this.i = new Uint16Array(64)
    } else {
      this.x = new Uint16Array(64); this.y = new Uint16Array(64)
      this.z = new Int32Array(64); this.i = new Uint8Array(64)
    }
    if (rgb) { this.r = new Uint8Array(64); this.g = new Uint8Array(64); this.b = new Uint8Array(64) }
  }

  push(x, y, z, i, r = 0, g = 0, b = 0) {
    if (this.count === this.x.length) {
      const grow = (a) => { const c = new a.constructor(a.length * 2); c.set(a); return c }
      this.x = grow(this.x); this.y = grow(this.y); this.z = grow(this.z); this.i = grow(this.i)
      if (this.r) { this.r = grow(this.r); this.g = grow(this.g); this.b = grow(this.b) }
    }
    const n = this.count++
    this.x[n] = x; this.y[n] = y; this.z[n] = z; this.i[n] = i
    if (this.r) { this.r[n] = r; this.g[n] = g; this.b[n] = b }
  }
}

/**
 * The points of one tile cut into height bands of at most Z_SPAN_UNITS each
 * (in the original resolution Z_SPAN_GRID), so that every band fits the
 * segment's heights. A tile of the usual kind is one band.
 */
export function splitIntoBands(cols) {
  const span = cols.grid ? Z_SPAN_GRID : Z_SPAN_UNITS
  const asBand = (c) => ({ x: c.x, y: c.y, z: c.z, i: c.i, count: c.count, ...(c.r ? { r: c.r, g: c.g, b: c.b } : {}) })
  let zMin = Infinity, zMax = -Infinity
  for (let k = 0; k < cols.count; k++) { zMin = Math.min(zMin, cols.z[k]); zMax = Math.max(zMax, cols.z[k]) }
  if (zMax - zMin <= span) return [asBand(cols)]
  const bands = new Map()
  for (let k = 0; k < cols.count; k++) {
    const b = Math.floor((cols.z[k] - zMin) / (span + 1))
    if (!bands.has(b)) bands.set(b, new Columns(cols.grid, !!cols.r))
    bands.get(b).push(cols.x[k], cols.y[k], cols.z[k], cols.i[k], cols.r?.[k], cols.g?.[k], cols.b?.[k])
  }
  return [...bands.values()].map(asBand)
}

/**
 * Sorts points into tiles and thins them on the way: of all points falling
 * into one voxel of `level` (LEVELS; the 2-cm one unless said) the first is
 * kept. `add` takes points in metres in the cloud's plane; a tile that has had
 * no new point for `idlePoints` points is handed to `onTile(tx, ty, columns)`
 * and forgotten — its voxels too, so a later pass over it starts a fresh
 * segment.
 *
 * With a `grid` (originalGrid) nothing is thinned: every point is kept, in
 * grid steps, its intensity as given. With `rgb` every point carries its
 * colour [0…255] along.
 */
export class TileBuilder {
  constructor({ onTile, idlePoints = 2000000, grid = null, level = VOXEL_DEFAULT, rgb = false }) {
    this.onTile = onTile
    this.idlePoints = idlePoints
    this.grid = grid
    this.level = level
    this.rgb = rgb
    this.tiles = new Map()   // tileKey → { tx, ty, cols, voxels: Set, last } (bx, by instead of voxels on a grid)
    this.seen = 0
    this.kept = 0
  }

  add(e, n, z, intensity, r = 0, g = 0, b = 0) {
    if (this.grid) { this.addOnGrid(e, n, z, intensity, r, g, b); return }
    const { perMetre, tileUnits, voxelUnits } = this.level
    const X = Math.round(e * perMetre), Y = Math.round(n * perMetre), Z = Math.round(z * perMetre)
    const tx = Math.floor(X / tileUnits), ty = Math.floor(Y / tileUnits)
    const lx = X - tx * tileUnits, ly = Y - ty * tileUnits
    const key = tileKey(tx, ty)
    let tile = this.tiles.get(key)
    if (!tile) {
      tile = { tx, ty, cols: new Columns(false, this.rgb), voxels: new Set(), last: 0 }
      this.tiles.set(key, tile)
    }
    tile.last = ++this.seen
    const per = tileUnits / voxelUnits
    const voxel = Math.floor(Z / voxelUnits) * per * per + Math.floor(ly / voxelUnits) * per + Math.floor(lx / voxelUnits)
    if (tile.voxels.has(voxel)) return
    tile.voxels.add(voxel)
    tile.cols.push(lx, ly, Z, intensity, r, g, b)
    this.kept++
  }

  addOnGrid(e, n, z, intensity, r, g, b) {
    const { scale: [sx, sy, sz], offset: [gx, gy, gz] } = this.grid
    const u = Math.round((e - gx) / sx), v = Math.round((n - gy) / sy), w = Math.round((z - gz) / sz)
    const tx = Math.floor((gx + u * sx) / TILE_SIZE), ty = Math.floor((gy + v * sy) / TILE_SIZE)
    const key = tileKey(tx, ty)
    let tile = this.tiles.get(key)
    if (!tile) {
      tile = { tx, ty, cols: new Columns(true, this.rgb), bx: gridBase(tx, sx, gx), by: gridBase(ty, sy, gy), last: 0 }
      this.tiles.set(key, tile)
    }
    tile.last = ++this.seen
    tile.cols.push(u - tile.bx, v - tile.by, w, intensity, r, g, b)
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
