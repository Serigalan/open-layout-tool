/**
 * The slice of a point cloud a cross section shows: the points at most half
 * a thickness before or behind the section plane, within the drawing's width,
 * projected onto the plane as (y across, z up) — y positive to the right of
 * the running direction, as everywhere in the section (crossSectionUtils).
 *
 * Pure geometry on decoded tiles; reading them is cloudSection's job.
 */

/**
 * The frame of a section in a plane: origin [m], bearing [degrees from grid
 * north], how far either side it reaches and how thick the slice is [m].
 */
export function sliceFrame({ easting, northing, bearing, halfWidth, thickness }) {
  const rad = bearing * Math.PI / 180
  return {
    e: easting, n: northing,
    along: [Math.sin(rad), Math.cos(rad)],
    right: [Math.cos(rad), -Math.sin(rad)],
    halfWidth, half: thickness / 2,
  }
}

/**
 * The tiles of `index` the slice can reach — `[tx, ty, segments]` entries.
 * A tile is a square, the slice a thin rectangle at any angle; they meet
 * unless one of the four axes separates them, and the square's two axes are
 * the box test.
 */
export function tilesInSlice(index, frame) {
  const size = index.tileSize
  const { e, n, along, right, halfWidth, half } = frame
  const ext = (axis) => (Math.abs(axis[0]) + Math.abs(axis[1])) * size / 2
  const extAlong = ext(along), extRight = ext(right)
  const bx = Math.abs(right[0]) * halfWidth + Math.abs(along[0]) * half
  const by = Math.abs(right[1]) * halfWidth + Math.abs(along[1]) * half
  return index.tiles.filter(([tx, ty]) => {
    const cx = (tx + 0.5) * size - e, cy = (ty + 0.5) * size - n
    if (Math.abs(cx) > bx + size / 2 || Math.abs(cy) > by + size / 2) return false
    if (Math.abs(cx * along[0] + cy * along[1]) > half + extAlong) return false
    return Math.abs(cx * right[0] + cy * right[1]) <= halfWidth + extRight
  })
}

/** Growable output of a slice: y [m], z [m, absolute], intensity [byte]. */
export class SlicePoints {
  constructor() {
    this.count = 0
    this.y = new Float32Array(1024)
    this.z = new Float64Array(1024)
    this.i = new Uint8Array(1024)
  }

  push(y, z, i) {
    if (this.count === this.y.length) {
      const grow = (a) => { const b = new a.constructor(a.length * 2); b.set(a); return b }
      this.y = grow(this.y); this.z = grow(this.z); this.i = grow(this.i)
    }
    const k = this.count++
    this.y[k] = y; this.z[k] = z; this.i[k] = i
  }
}

/**
 * Add the points of one decoded segment of tile (tx, ty) that lie in the
 * slice to `out`. `toPlane`, where given, carries a point from the cloud's
 * plane into the frame's (the track's), when the two differ.
 */
export function sliceSegment(out, seg, { tx, ty, z0, tileSize }, frame, toPlane = null) {
  const { e, n, along, right, halfWidth, half } = frame
  const ox = tx * tileSize, oy = ty * tileSize
  const { x, y, z, i } = seg
  for (let k = 0; k < x.length; k++) {
    let pe = ox + x[k] * 0.001, pn = oy + y[k] * 0.001
    if (toPlane) [pe, pn] = toPlane(pe, pn)
    const de = pe - e, dn = pn - n
    const d = de * along[0] + dn * along[1]
    if (d > half || d < -half) continue
    const q = de * right[0] + dn * right[1]
    if (q > halfWidth || q < -halfWidth) continue
    out.push(q, (z0 + z[k]) * 0.001, i[k])
  }
}
