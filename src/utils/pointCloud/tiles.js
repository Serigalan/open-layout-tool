import { zlibSync, unzlibSync } from 'fflate'

/**
 * The tiles a point cloud is kept in after import (Entscheidungen 116, 117):
 * squares of 2 × 2 m in the project's plane, thinned to one point per 2-cm
 * voxel. A cross section reads only the tiles its plane passes through.
 *
 * A tile is written as one or more **segments**. Mobile-mapping data arrives
 * in the order it was scanned, so a tile is complete once the scanner has
 * moved on — it is written then and dropped from memory; if a later pass
 * (the way back) brings more points to it, they become a further segment.
 *
 * A segment stores, per point, x and y in millimetres from the tile's corner
 * and z in millimetres over the segment's lowest point, each as Uint16, and
 * the intensity as one byte — 7 bytes, sorted by voxel and delta-coded so
 * that zlib finds the regularity of the voxel grid. A segment taller than
 * 65.535 m is split into height bands, each a segment of its own.
 */

/** Edge of a tile [m]. */
export const TILE_SIZE = 2
/** Edge of the thinning voxel [m] (Entscheidung 117). */
export const VOXEL_SIZE = 0.02

const TILE_MM = TILE_SIZE * 1000
const VOXEL_MM = VOXEL_SIZE * 1000
const VOXELS_PER_TILE = TILE_MM / VOXEL_MM
const Z_SPAN_MM = 0xFFFF

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

/** Growable typed columns of one tile's points. */
class Columns {
  constructor() {
    this.count = 0
    this.x = new Uint16Array(64); this.y = new Uint16Array(64)
    this.z = new Int32Array(64); this.i = new Uint8Array(64)
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
 * The points of one tile cut into height bands of at most Z_SPAN_MM each, so
 * that every band fits the segment's Uint16 heights. A tile of the usual
 * kind is one band.
 */
export function splitIntoBands(cols) {
  let zMin = Infinity, zMax = -Infinity
  for (let k = 0; k < cols.count; k++) { zMin = Math.min(zMin, cols.z[k]); zMax = Math.max(zMax, cols.z[k]) }
  if (zMax - zMin <= Z_SPAN_MM) return [{ x: cols.x, y: cols.y, z: cols.z, i: cols.i, count: cols.count }]
  const bands = new Map()
  for (let k = 0; k < cols.count; k++) {
    const b = Math.floor((cols.z[k] - zMin) / (Z_SPAN_MM + 1))
    if (!bands.has(b)) bands.set(b, new Columns())
    bands.get(b).push(cols.x[k], cols.y[k], cols.z[k], cols.i[k])
  }
  return [...bands.values()].map(c => ({ x: c.x, y: c.y, z: c.z, i: c.i, count: c.count }))
}

/**
 * Sorts points into tiles and thins them on the way: of all points falling
 * into one 2-cm voxel the first is kept. `add` takes points in metres in the
 * project plane; a tile that has had no new point for `idlePoints` points is
 * handed to `onTile(tx, ty, columns)` and forgotten — its voxels too, so a
 * later pass over it starts a fresh segment.
 */
export class TileBuilder {
  constructor({ onTile, idlePoints = 2000000 }) {
    this.onTile = onTile
    this.idlePoints = idlePoints
    this.tiles = new Map()   // key → { tx, ty, cols, voxels: Set, last }
    this.seen = 0
    this.kept = 0
  }

  add(e, n, z, intensity) {
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
