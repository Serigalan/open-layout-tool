/**
 * Painting a cloud slice into the cross section's canvas, in the drawing's
 * own transform (fitSection: x = cx + y·k, y = cy − z·k, both in mm with z
 * over the reference height). Points are drawn as small squares in colour
 * buckets — one fillStyle per bucket, not per point — so tens of thousands
 * of points paint in a few milliseconds.
 */

/** The colourings on offer, the first the default. */
export const CLOUD_COLORINGS = ['intensity', 'height']

/** Points inside the clearance outline (AP 11.5). */
export const INTRUSION_COLOR = '#e0201b'
/** Points in an area the outline allows to be reached into. */
const ALLOWED_COLOR = '#e08a1b'

const BUCKETS = 32

// Intensity: light grey for weak returns, near black for strong ones.
const GREYS = Array.from({ length: BUCKETS }, (_, k) => {
  const v = Math.round(200 - 170 * k / (BUCKETS - 1))
  return `rgb(${v},${v},${v})`
})

// Height: blue at the bottom through green and yellow to red at the top.
const RAMP = Array.from({ length: BUCKETS }, (_, k) => {
  const hue = 240 - 240 * k / (BUCKETS - 1)
  return `hsl(${Math.round(hue)},75%,42%)`
})

/**
 * Paint `parts` — `[{ points: { count, y, z, i }, flags? }]`, y [m] across and
 * z [m] absolute; `flags[k]` 1 for a point inside the clearance outline, 2 for
 * one in an allowed area — onto `ctx` (already sized `w × h` CSS pixels at
 * `dpr`). Returns how many points were painted.
 */
export function drawCloudPoints(ctx, { w, h, dpr = 1, k, cx, cy, zRef, parts, coloring = 'intensity' }) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (zRef == null || !parts?.length) return 0
  let zLo = Infinity, zHi = -Infinity
  if (coloring === 'height') {
    for (const { points: p } of parts) {
      for (let n = 0; n < p.count; n++) { if (p.z[n] < zLo) zLo = p.z[n]; if (p.z[n] > zHi) zHi = p.z[n] }
    }
  }
  const span = Math.max(zHi - zLo, 0.01)
  const palette = coloring === 'height' ? RAMP : GREYS
  const buckets = Array.from({ length: BUCKETS + 2 }, () => [])
  const size = 1.6
  let painted = 0
  for (const { points: p, flags } of parts) {
    for (let n = 0; n < p.count; n++) {
      const px = cx + p.y[n] * 1000 * k
      const py = cy - (p.z[n] - zRef) * 1000 * k
      if (px < -2 || py < -2 || px > w + 2 || py > h + 2) continue
      let b
      if (flags?.[n] === 1) b = BUCKETS
      else if (flags?.[n] === 2) b = BUCKETS + 1
      else if (coloring === 'height') b = Math.min(BUCKETS - 1, Math.floor((p.z[n] - zLo) / span * BUCKETS))
      else b = p.i[n] >> 3
      buckets[b].push(px, py)
      painted++
    }
  }
  const fills = [...palette, INTRUSION_COLOR, ALLOWED_COLOR]
  buckets.forEach((xy, b) => {
    if (!xy.length) return
    // Intrusions a little larger, so a single point in the profile is seen.
    const s = b >= BUCKETS ? 3 : size
    ctx.fillStyle = fills[b]
    for (let m = 0; m < xy.length; m += 2) ctx.fillRect(xy[m] - s / 2, xy[m + 1] - s / 2, s, s)
  })
  return painted
}

/**
 * The canvas under the cross section: sized to `w × h` CSS pixels at the
 * device's pixel ratio, cleared, and the cloud painted in the drawing's own
 * transform (`k`, `cx`, `cy`) — or left empty without one.
 */
export function paintCloudCanvas(canvas, { w, h, view, zRef, parts, coloring }) {
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const ctx = canvas.getContext('2d')
  if (!view || !parts.length) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    return 0
  }
  return drawCloudPoints(ctx, { w, h, dpr, k: view.k, cx: view.cx, cy: view.cy, zRef, parts, coloring })
}
