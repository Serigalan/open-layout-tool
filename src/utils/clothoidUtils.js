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
