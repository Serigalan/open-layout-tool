import { planeCoordsToWgs84 } from './coordinateUtils'
import { SAGITTA_ELEMENT } from './geometryPrecision'

// Heading change Δφ(s) of a transition of length L between curvatures κ1 → κ2.
//   clothoid: κ linear in s      → Δφ(s) = κ1·s + (κ2−κ1)·s²/(2L)
//   bloss:    κ(s) = κ1 + (κ2−κ1)·(3(s/L)² − 2(s/L)³)
//             → Δφ(s) = κ1·s + (κ2−κ1)·(s³/L² − s⁴/(2L³))
// Both reach the same total angle Δφ(L) = (κ1+κ2)·L/2.
function transitionHeading(type, kappa1, kappa2, length, s) {
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
 * Plane points of a transition, as many as the sagitta `maxDeviation` asks at
 * its smallest radius and at least `minSteps` segments — each on the exact
 * curve (SUBDIV Simpson sub-intervals per step).
 */
export function transitionPlanePoints(startUtm, bearing, length, signedR1, signedR2, type, maxDeviation, minSteps = 2) {
  const steps = Math.max(minSteps, clothoidSteps(toKappa(signedR1), toKappa(signedR2), length, maxDeviation))
  return sampleTransitionUtm(startUtm, bearing, length, signedR1, signedR2, type, { steps, subdiv: SUBDIV })
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

  const pts = transitionPlanePoints(startUtm, bearing, length, signedR1, signedR2, type, maxDeviation)

  const coords = planeCoordsToWgs84(pts, startUtm.zone)
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
 * Cant at the two ends of a transition [mm, signed like `cant`]. Across it the
 * cant ramps between the elements it joins, so each end takes the cant of its
 * neighbour there — unless it states its own as cantStart / cantEnd, which
 * win: a cut transition (a turnout laid into it) keeps the ramp's value at its
 * pieces' ends, an import or the element table may give it any (decision 355).
 */
export function transitionCantEnds(elements, i) {
  const el = elements[i]
  return {
    start: el.cantStart ?? endCant(elements[i - 1], 'end'),
    end:   el.cantEnd   ?? endCant(elements[i + 1], 'start'),
  }
}

/**
 * The cant an element states at `end` itself — its own end where it has one
 * (an arc or a straight the cant changes along, a transition's own), else its
 * one `cant`; 0 for a transition without one of its own, or no element.
 */
function endCant(el, end) {
  if (!el) return 0
  return (end === 'start' ? el.cantStart : el.cantEnd) ?? el.cant ?? 0
}

/**
 * Cant at the two ends of any element [mm, signed like `cant`]: a
 * transition's as transitionCantEnds reads them; an arc or a straight carries
 * one `cant`, or — where the cant changes along it, as an import may bring —
 * its own cantStart / cantEnd, between which it ramps linearly (decision 355).
 */
export function cantEnds(elements, i) {
  const el = elements[i]
  if (el.elementType === 2) return transitionCantEnds(elements, i)
  return { start: endCant(el, 'start'), end: endCant(el, 'end') }
}

/** Two cants this close are one [mm] — the thousandth a record keeps. */
const SAME_CANT = 0.001

/**
 * An arc or a straight with the cant `start` at its start and `end` at its
 * end: one `cant` where they agree, else both as cantStart / cantEnd and, as
 * its `cant`, the one the physics goes by — on an arc the end that helps the
 * curve least, so the deficiency and the speed it allows are the worst along
 * it; on a straight its start (decision 355).
 */
export function withCantRamp(el, start, end) {
  const { cantStart: _s, cantEnd: _e, cant: _c, ...rest } = el
  if (Math.abs(start - end) <= SAME_CANT) return start || el.radius ? { ...rest, cant: start || 0 } : rest
  const side = el.radius < 0 ? -1 : 1
  const cant = el.radius && side * end < side * start ? end : start
  return { ...rest, cant, cantStart: start, cantEnd: end }
}

/**
 * An element's cant as a record keeps it (Entscheidung 369): `cant` says the
 * cant is the same at both ends, `cantStart` + `cantEnd` that it changes along
 * the element — never both. An arc or a straight whose two ends agree keeps one
 * `cant`; one with a ramp keeps its two ends, and its `cant` (the one the
 * physics goes by, withCantRamp) is derived again on load (loadedCants). A
 * transition keeps its ends as it states them, also two equal ones, since a
 * `cant` on it would not say which ends are its own; a stray `cant` beside them
 * goes.
 */
function storedCants(el) {
  const { cant: _c, ...rest } = el
  const hasStart = el.cantStart != null, hasEnd = el.cantEnd != null
  if (el.elementType === 2) return hasStart || hasEnd ? rest : el
  if (!hasStart || !hasEnd) return el
  const { cantStart, cantEnd, ...bare } = rest
  if (Math.abs(cantStart - cantEnd) > SAME_CANT) return rest
  return cantStart || el.radius ? { ...bare, cant: cantStart } : bare
}

/**
 * A track's elements with their cant as a record keeps it (oltjson-1.1,
 * Entscheidung 371): an arc or a straight as storedCants keeps it, a
 * transition always with both its ends — what transitionCantEnds reads,
 * whether it states them itself or takes them from its neighbours — so the
 * file says every cant there is, and an absent one is 0.
 */
export function storedTrackCants(elements = []) {
  return elements.map((el, i) => {
    if (el.elementType !== 2) return storedCants(el)
    const { cant: _c, ...rest } = el
    const ends = transitionCantEnds(elements, i)
    return { ...rest, cantStart: ends.start || 0, cantEnd: ends.end || 0 }
  })
}

/**
 * A track's elements as the model reads them from a record (storedTrackCants):
 * each as loadedCants gives it, and a transition — an end it does not state
 * being 0, as the record has it — without the ends its neighbours give it
 * anyway, so that in the model it follows them when their cant changes; only
 * an end that differs stays its own.
 */
export function loadedTrackCants(elements = []) {
  return followingCants(elements.map(el => (el.elementType === 2
    ? { ...el, cantStart: el.cantStart ?? 0, cantEnd: el.cantEnd ?? 0 }
    : loadedCants(el))))
}

/** A transition's ends left out where they are what its neighbours give it anyway. */
function followingCants(elements) {
  const out = elements.slice()
  out.forEach((el, i) => {
    if (el.elementType !== 2) return
    let next = el
    if (next.cantStart != null && Math.abs(next.cantStart - endCant(out[i - 1], 'end')) <= SAME_CANT) {
      const { cantStart: _s, ...rest } = next
      next = rest
    }
    if (next.cantEnd != null && Math.abs(next.cantEnd - endCant(out[i + 1], 'start')) <= SAME_CANT) {
      const { cantEnd: _e, ...rest } = next
      next = rest
    }
    out[i] = next
  })
  return out
}

/**
 * Does the element state its cant at its two ends — a transition always, an
 * arc or a straight where the cant changes along it — rather than as one
 * `cant`? What the element table shows and lets be typed for it (Entscheidung
 * 373): one or the other, never both.
 */
export const hasCantEnds = (el) => el?.elementType === 2 || el?.cantStart != null || el?.cantEnd != null

/** An element with its cant at `end` ('start' or 'end') set to `value`: one with ends as a ramp, the other its one cant. */
function withEndCant(el, end, value) {
  if (el.elementType === 2) return { ...el, [end === 'start' ? 'cantStart' : 'cantEnd']: value }
  if (!hasCantEnds(el)) return { ...el, cant: value }
  const start = end === 'start' ? value : (el.cantStart ?? el.cant ?? 0)
  const last = end === 'end' ? value : (el.cantEnd ?? el.cant ?? 0)
  return withCantRamp(el, start, last)
}

/**
 * Carry the cant `v` over a joint into `out` (in place), from element `from`
 * on in direction `step` (−1 backwards, +1 forwards): an element of one cant
 * takes it all along and passes it on, one with ends takes it at the near end
 * and stops it there.
 */
function carryCant(out, from, step, v) {
  for (let j = from; j >= 0 && j < out.length; j += step) {
    const own = hasCantEnds(out[j])
    out[j] = withEndCant(out[j], step < 0 ? 'end' : 'start', v)
    if (own) return
  }
}

/**
 * The elements of a track with the cant `v` at its end `endpoint` ('BEGIN' or
 * 'END') — carried in from there over the elements of one cant to the first
 * that states its ends (carryCant). What a track meeting a turnout's toe takes
 * from it (Entscheidung 376).
 */
export function withCantAtEnd(elements, endpoint, v) {
  if (!elements?.length) return elements
  const out = elements.slice()
  if (endpoint === 'END') carryCant(out, out.length - 1, -1, v)
  else carryCant(out, 0, 1, v)
  return followingCants(out)
}

/**
 * The elements with the cant of the run `from`–`to` set at both ends of each
 * — `ends` [[start, end], …] in the order of the elements — and carried on
 * over the joints at either end of the run (carryCant). An element of one
 * radius whose two ends agree keeps one `cant`; a transition states both.
 * What a turnout's route takes from the other route beside it (switch
 * coupleSwitchCants, Entscheidung 376).
 */
export function withCantsOver(elements, from, to, ends) {
  const out = elements.slice()
  for (let i = from; i <= to; i++) {
    const [start, end] = ends[i - from]
    const el = out[i]
    out[i] = el.elementType === 2 ? { ...el, cantStart: start, cantEnd: end } : withCantRamp(el, start, end)
  }
  carryCant(out, from - 1, -1, ends[0][0])
  carryCant(out, to + 1, 1, ends[ends.length - 1][1])
  return followingCants(out)
}

/**
 * The elements with one cant typed in the element table (Entscheidung 373):
 * `key` 'cant' (an element of one cant), 'cantStart' or 'cantEnd' (one that
 * states its ends), `value` the cant [mm] as it is to be stored. The cant
 * stays continuous: what an element now has at an end, the element beyond
 * that joint takes at its end there — an element of one cant all along, and
 * so on to the next joint; one with ends only at that end, where the carrying
 * stops. A transition's end that is now its neighbour's is left to follow it.
 */
export function withCantEdit(elements, i, key, value) {
  const out = elements.slice()
  const el = out[i]
  if (!el) return elements
  const carry = (from, step, v) => carryCant(out, from, step, v)
  if (key === 'cant') {
    if (hasCantEnds(el)) return elements
    out[i] = withEndCant(el, 'start', value)
    carry(i - 1, -1, value)
    carry(i + 1, 1, value)
  } else {
    if (!hasCantEnds(el)) return elements
    const end = key === 'cantStart' ? 'start' : 'end'
    out[i] = withEndCant(el, end, value)
    if (end === 'start') carry(i - 1, -1, value)
    else carry(i + 1, 1, value)
  }
  return followingCants(out)
}

/**
 * An element's cant as the model reads it, from a record (storedCants): an arc
 * or a straight with a ramp gets its `cant` back — the end that helps the curve
 * least (withCantRamp).
 */
function loadedCants(el) {
  if (el.elementType === 2 || el.cant != null || el.cantStart == null || el.cantEnd == null) return el
  return withCantRamp(el, el.cantStart, el.cantEnd)
}
