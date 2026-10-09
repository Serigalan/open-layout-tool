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

/**
 * Growable output of a slice: y [m], z [m, absolute], intensity [byte] and,
 * with `rgb`, the colour as three bytes a point (`rgb[3k…3k+2]`).
 */
export class SlicePoints {
  constructor(rgb = false) {
    this.count = 0
    this.y = new Float32Array(1024)
    this.z = new Float64Array(1024)
    this.i = new Uint8Array(1024)
    this.rgb = rgb ? new Uint8Array(3072) : null
  }

  push(y, z, i, r = 0, g = 0, b = 0) {
    if (this.count === this.y.length) {
      const grow = (a) => { const c = new a.constructor(a.length * 2); c.set(a); return c }
      this.y = grow(this.y); this.z = grow(this.z); this.i = grow(this.i)
      if (this.rgb) this.rgb = grow(this.rgb)
    }
    const k = this.count++
    this.y[k] = y; this.z[k] = z; this.i[k] = i
    if (this.rgb) { this.rgb[3 * k] = r; this.rgb[3 * k + 1] = g; this.rgb[3 * k + 2] = b }
  }
}

/**
 * Add the points of one decoded segment that lie in the slice to `out`.
 * `place` (segmentPlacement) says where the segment's points lie; `toPlane`,
 * where given, carries a point `(e, n, z)` from the cloud's plane into the
 * frame's (the track's) — `[e, n]`, or `[e, n, z]` where the height changes
 * too (a re-referenced cloud, cloudToPlane).
 */
export function sliceSegment(out, seg, place, frame, toPlane = null) {
  const { e, n, along, right, halfWidth, half } = frame
  const { ox, oy, oz, sx, sy, sz } = place
  const { x, y, z, i, r, g, b } = seg
  const color = !!(r && out.rgb)
  for (let k = 0; k < x.length; k++) {
    let pe = ox + x[k] * sx, pn = oy + y[k] * sy, pz = oz + z[k] * sz
    if (toPlane) {
      const p = toPlane(pe, pn, pz)
      pe = p[0]; pn = p[1]
      if (p.length > 2) pz = p[2]
    }
    const de = pe - e, dn = pn - n
    const d = de * along[0] + dn * along[1]
    if (d > half || d < -half) continue
    const q = de * right[0] + dn * right[1]
    if (q > halfWidth || q < -halfWidth) continue
    if (color) out.push(q, pz, i[k], r[k], g[k], b[k])
    else out.push(q, pz, i[k])
  }
}
