import proj4 from 'proj4'
import { projStringFor } from './coordinateUtils'
import { SAGITTA_ELEMENT } from './mapConstants'

// Heading change Δφ(s) of a transition of length L between curvatures κ1 → κ2.
//   clothoid: κ linear in s      → Δφ(s) = κ1·s + (κ2−κ1)·s²/(2L)
//   bloss:    κ(s) = κ1 + (κ2−κ1)·(3(s/L)² − 2(s/L)³)
//             → Δφ(s) = κ1·s + (κ2−κ1)·(s³/L² − s⁴/(2L³))
// Both reach the same total angle Δφ(L) = (κ1+κ2)·L/2.
export function transitionHeading(type, kappa1, kappa2, length, s) {
  const dk = kappa2 - kappa1
  return type === 'bloss'
    ? kappa1 * s + dk * (s ** 3 / (length * length) - s ** 4 / (2 * length ** 3))
    : kappa1 * s + dk * s * s / (2 * length)
}

// Sign convention: κ = -1/signedR (signedR > 0 = RIGHT = CW = negative UTM angle),
// null/0 = straight.
const toKappa = (r) => (r !== null && r !== undefined && r !== 0) ? -1 / r : 0

// Sub-intervals of the composite Simpson rule per drawn segment — keeps the
// endpoint exact even when the sagitta logic yields very few segments.
const SUBDIV = 8

function clothoidSteps(kappa1, kappa2, length, maxDeviation) {
  const radii = [kappa1, kappa2].filter(k => Math.abs(k) > 1e-12).map(k => 1 / Math.abs(k))
  if (radii.length === 0) return 2
  const minR = Math.min(...radii)
  const totalAngle = Math.abs((kappa1 + kappa2) * length / 2)
  if (totalAngle < 1e-9) return 2
  const maxAngle = 2 * Math.acos(Math.min(1, Math.max(-1, 1 - maxDeviation / minR)))
  if (maxAngle < 1e-12) return 500
  return Math.max(2, Math.min(500, Math.ceil(totalAngle / maxAngle)))
}

const utmProjStr = (crs) => projStringFor(crs)

/**
 * March a transition of any curvature profile in the track's plane — the single
 * integrator every transition in the tool is built on.
 *
 * Each returned point is reached by `subdiv` composite-Simpson sub-intervals, so
 * it lies on the exact curve; `steps` only decides how densely the curve is
 * sampled. Integrating only up to `end` (≤ length) yields a point part-way
 * along the very same curve, since the heading profile keeps the full length.
 *
 * @param {{easting,northing}} startUtm  start point in the track's plane
 * @param {number} bearing   compass bearing at start (°, 0 = North, clockwise)
 * @param {number} length    arc length of the whole transition (m)
 * @param {number|null} signedR1  starting signed radius (null = straight)
 * @param {number|null} signedR2  ending signed radius   (null = straight)
 * @param {'clothoid'|'bloss'} type  curvature profile
 * @param {{steps?:number, subdiv?:number, end?:number}} opts  sampling controls
 * @returns {[number,number][]} [easting, northing] pairs, the start point first
 */
export function sampleTransitionUtm(startUtm, bearing, length, signedR1, signedR2, type = 'clothoid',
  { steps = 16, subdiv = 1, end = length } = {}) {
  const kappa1 = toKappa(signedR1)
  const kappa2 = toKappa(signedR2)
  const phi0   = (90 - bearing) * (Math.PI / 180)
  const ds     = end / steps

  let x = startUtm.easting
  let y = startUtm.northing
  const pts = [[x, y]]

  for (let i = 0; i < steps; i++) {
    const s0 = end * i / steps
    const h  = ds / subdiv
    for (let j = 0; j < subdiv; j++) {
      const a  = s0 + j * h
      const pa = phi0 + transitionHeading(type, kappa1, kappa2, length, a)
      const pm = phi0 + transitionHeading(type, kappa1, kappa2, length, a + h / 2)
      const pb = phi0 + transitionHeading(type, kappa1, kappa2, length, a + h)
      x += h / 6 * (Math.cos(pa) + 4 * Math.cos(pm) + Math.cos(pb))
      y += h / 6 * (Math.sin(pa) + 4 * Math.sin(pm) + Math.sin(pb))
    }
    pts.push([x, y])
  }
  return pts
}

/**
 * Compute a transition curve (clothoid or Bloss) from radius R1 to R2, from a
 * start point in the track's plane.
 *
 * Total angle: Δφ(L) = (κ1 + κ2)·L/2 — the same for both profiles.
 *
 * Sign convention: κ = -1/signedR  (signedR > 0 = RIGHT = CW = negative UTM angle)
 * Use null for straight (κ = 0, i.e. R = ∞).
 *
 * Special cases:
 *   signedR1 = null, signedR2 = r  →  entry transition (∞ → R)
 *   signedR1 = r,    signedR2 = null → exit transition  (R → ∞)
 *
 * @param {{easting,northing,zone}} startUtm  start point in the track's plane
 * @param {number}    bearing   Compass bearing at start (°, 0 = North, clockwise)
 * @param {number}    length    Arc length of the transition segment (m)
 * @param {number|null} signedR1  Starting signed radius (null = straight)
 * @param {number|null} signedR2  Ending signed radius   (null = straight)
 * @param {number}      maxDeviation  Sagitta for step sizing of the drawn polyline
 * @param {'clothoid'|'bloss'} type   Curvature profile of the transition
 * @returns {{ coords: [lng,lat][], endUtm: {easting,northing,zone}, endBearing: number }}
 */
export function computeClothoidUtm(startUtm, bearing, length, signedR1, signedR2, maxDeviation = SAGITTA_ELEMENT, type = 'clothoid') {
  const kappa1 = toKappa(signedR1)
  const kappa2 = toKappa(signedR2)

  const steps = clothoidSteps(kappa1, kappa2, length, maxDeviation)
  const pts   = sampleTransitionUtm(startUtm, bearing, length, signedR1, signedR2, type, { steps, subdiv: SUBDIV })
  const proj  = utmProjStr(startUtm.zone)

  const coords = pts.map(([x, y]) => proj4(proj, 'EPSG:4326', [x, y]))
  const [endE, endN] = pts[pts.length - 1]

  const phi0       = (90 - bearing) * (Math.PI / 180)
  const dphiEnd    = (kappa1 + kappa2) * length / 2
  const endBearing = ((90 - (phi0 + dphiEnd) * (180 / Math.PI)) % 360 + 360) % 360

  return {
    coords,
    endUtm: { easting: endE, northing: endN, zone: startUtm.zone },
    endBearing,
  }
}

/**
 * Point of a transition at station `s` (0 ≤ s ≤ length) in the plane — the
 * same integral taken up to s, so it sits on the very curve
 * computeClothoidUtm draws.
 */
export function transitionPointAtUtm(startUtm, bearing, length, signedR1, signedR2, type = 'clothoid', s = length) {
  const end = Math.min(Math.max(s, 0), length)
  const n   = Math.max(8, Math.ceil(end / length * 512))
  const pts = sampleTransitionUtm(startUtm, bearing, length, signedR1, signedR2, type, { steps: 1, subdiv: n, end })
  const [x, y] = pts[pts.length - 1]
  return { easting: x, northing: y, zone: startUtm.zone }
}

/**
 * Compass bearing of a transition at station `s` — the start bearing turned by
 * the heading the profile has accumulated. Plane angles grow counter-clockwise
 * while bearings grow clockwise, hence the sign.
 */
export function transitionBearingAtUtm(bearing, length, signedR1, signedR2, type = 'clothoid', s = length) {
  const dphi = transitionHeading(type, toKappa(signedR1), toKappa(signedR2), length, s)
  return ((bearing - dphi * (180 / Math.PI)) % 360 + 360) % 360
}

/**
 * Shift parameters of a straight ↔ arc transition of length L into radius R > 0:
 *   p   offset of the shifted arc from the straight tangent (Abrücken)
 *   t   distance from the transition start to the foot of the perpendicular
 *       from the arc centre onto the tangent
 *   phi deflection angle of the transition = L/(2R), identical for both types
 *
 * p and t come from the same integrator, so they are exact for any L/R — no
 * series truncation (clothoid series: p ≈ L²/24R, t ≈ L/2 − L³/240R²;
 * Bloss series: p ≈ L²/40R, t ≈ L/2 − L³/504R²).
 */
export function transitionShift(L, R, type = 'clothoid') {
  if (!(L > 0)) return { p: 0, t: 0, phi: 0 }
  // Bearing 90° puts the tangent on the +easting axis, so the marched point is
  // (t-axis, p-axis) of the shift geometry directly.
  const pts = sampleTransitionUtm({ easting: 0, northing: 0 }, 90, L, null, -R, type, { steps: 1, subdiv: 1000 })
  const [x, y] = pts[pts.length - 1]
  const phi = L / (2 * R)
  return { p: y + R * Math.cos(phi) - R, t: x - R * Math.sin(phi), phi }
}

// ── Pieces of a clothoid ─────────────────────────────────────────────────────

/**
 * Below this a curvature is float noise, not a radius (R > 10⁶ km). Kept far
 * below STRAIGHT_CURVATURE on purpose: a piece of a clothoid has to keep the
 * curvature it really has, or its neighbours stop meeting it tangentially.
 */
const CURVATURE_ZERO = 1e-12

/** Curvature 1/r of a signed radius, in the radius' own sign; 0 for a straight. */
export const curvatureOf = (r) => (r ? 1 / r : 0)

/** Signed radius of a curvature; null where it is none. */
export const radiusOfCurvature = (k) => (Math.abs(k) < CURVATURE_ZERO ? null : 1 / k)

/**
 * Signed radius of a clothoid at station `s`. Its curvature runs linearly from
 * 1/r1 to 1/r2 (0 at a straight end), so every piece of it is a clothoid of the
 * same parameter again — which is what lets one be cut, and a turnout be laid
 * into one. A Bloss curve has no such property; this is for clothoids only.
 *
 * The ends come back as stored, so a piece reaching an end carries that end's
 * radius exactly instead of its reciprocal taken twice. Null where the
 * curvature vanishes: at a straight end, or where a reverse clothoid inflects.
 */
export function clothoidRadiusAt(r1, r2, length, s) {
  if (s <= 0) return r1 ?? null
  if (s >= length) return r2 ?? null
  const k1 = curvatureOf(r1)
  return radiusOfCurvature(k1 + (curvatureOf(r2) - k1) * s / length)
}

/**
 * Offset of a plane point from a transition leaving `startUtm` on `bearing`:
 * `along` is the station of its foot on the curve (clamped to the element),
 * `perp` the offset from there, positive to the right of the running direction
 * — the same convention as projectOnBearingUtm / projectOnArcUtm.
 *
 * The nearest chord of a 1 m sampling gives the start, a few Newton steps on
 * the tangential offset put the foot on the exact curve.
 */
export function projectOnTransitionUtm(startUtm, pointUtm, bearing, length, r1, r2, type = 'clothoid') {
  if (!(length > 0)) {
    return { along: 0, perp: 0 }
  }
  const px = pointUtm.easting
  const py = pointUtm.northing
  const steps = Math.max(16, Math.ceil(length))
  const pts = sampleTransitionUtm(startUtm, bearing, length, r1, r2, type, { steps, subdiv: 4 })

  let best = { d2: Infinity, s: 0 }
  for (let i = 0; i < steps; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[i + 1]
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    const u  = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
    const ex = ax + u * dx - px, ey = ay + u * dy - py
    const d2 = ex * ex + ey * ey
    if (d2 < best.d2) best = { d2, s: length * (i + u) / steps }
  }

  const DEG = Math.PI / 180
  let s = best.s
  let foot = null
  for (let it = 0; it < 6; it++) {
    foot = transitionPointAtUtm(startUtm, bearing, length, r1, r2, type, s)
    const b  = transitionBearingAtUtm(bearing, length, r1, r2, type, s) * DEG
    const ds = (px - foot.easting) * Math.sin(b) + (py - foot.northing) * Math.cos(b)
    const next = Math.min(length, Math.max(0, s + ds))
    const done = Math.abs(next - s) < 1e-10
    s = next
    if (done) break
  }
  foot = transitionPointAtUtm(startUtm, bearing, length, r1, r2, type, s)
  const b = transitionBearingAtUtm(bearing, length, r1, r2, type, s) * DEG
  const dE = px - foot.easting, dN = py - foot.northing
  return { along: s, perp: dE * Math.cos(b) - dN * Math.sin(b) }
}

/**
 * Cant at the two ends of a transition [mm, signed like `cant`]. A transition
 * carries none of its own: across it the cant ramps between the elements it
 * joins, so each end takes the cant of its neighbour there. A transition that
 * was cut — a turnout laid into it — no longer has both of those beside it
 * (the cut ends the track, or the next piece is a transition too), so its
 * pieces keep the ramp's value at their ends as cantStart / cantEnd, which win
 * over the neighbours.
 */
export function transitionCantEnds(elements, i) {
  const el = elements[i]
  return {
    start: el.cantStart ?? elements[i - 1]?.cant ?? 0,
    end:   el.cantEnd   ?? elements[i + 1]?.cant ?? 0,
  }
}
