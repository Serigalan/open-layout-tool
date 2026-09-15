import { wgs84ToUTM, utmToWgs84 } from './coordinateUtils'
import { STRAIGHT_VERTEX_SPACING } from './mapConstants'

// Every function here works in the track's own projected plane on
// { easting, northing, zone } points (zone = the track's epsg). WGS84 is only
// ever produced — for the display geometry — and never taken as an input: a
// WGS84 round trip is not exact (the GK/DB_REF datum shift alone is ~0.6 mm
// off), and a zone guessed from a point can be the wrong plane altogether.

// Trims float noise (1e-9 m) so a derived length reads like the design value
// it is; nothing below that is geometry.
const trimNoise = (x) => Math.round(x * 1e9) / 1e9

/**
 * An element's stored plane node ([E, N] in `epsg`) as a plane point. Falls
 * back to projecting a WGS84 vertex into `epsg` for a record that has no nodes.
 */
export function nodeUtm(node, wgsFallback, epsg) {
  return Array.isArray(node) && Number.isFinite(node[0]) && Number.isFinite(node[1])
    ? { easting: node[0], northing: node[1], zone: epsg }
    : wgs84ToUTM(wgsFallback, epsg)
}

// ── Shared arc center computation ──

export function arcCenter(sE, sN, eE, eN, signedR) {
  const dx = eE - sE
  const dy = eN - sN
  const chord = Math.sqrt(dx * dx + dy * dy)
  const absR = Math.abs(signedR)
  if (chord < 1e-6 || absR < chord / 2) return null

  const rpx = dy / chord
  const rpy = -dx / chord
  const h = Math.sqrt(absR * absR - (chord / 2) * (chord / 2))
  const sgn = signedR >= 0 ? -1 : 1
  const cx = (sE + eE) / 2 - sgn * h * rpx
  const cy = (sN + eN) / 2 - sgn * h * rpy
  return { cx, cy, chord, absR }
}

function tangentBearing(pE, pN, cx, cy, signedR) {
  const rE = pE - cx
  const rN = pN - cy
  const tE = signedR >= 0 ? rN : -rN
  const tN = signedR >= 0 ? -rE : rE
  return (Math.atan2(tE, tN) * 180 / Math.PI + 360) % 360
}

// ── Element values from plane points ──

export function computeStraightValuesUtm(startUtm, endUtm) {
  const dx = endUtm.easting - startUtm.easting
  const dy = endUtm.northing - startUtm.northing
  const length = Math.sqrt(dx * dx + dy * dy)
  const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360
  return {
    startNode: [startUtm.easting, startUtm.northing],
    endNode:   [endUtm.easting,   endUtm.northing],
    epsg:      startUtm.zone,
    length:    trimNoise(length),
    bearing,
  }
}

export function computeCurvedValuesUtm(startUtm, endUtm, signedR) {
  const ac = arcCenter(startUtm.easting, startUtm.northing, endUtm.easting, endUtm.northing, signedR)
  let length = 0, bearing = 0, endBearing = 0
  if (ac) {
    const { cx, cy, absR } = ac
    const norm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const a1 = Math.atan2(startUtm.northing - cy, startUtm.easting - cx)
    const a2 = Math.atan2(endUtm.northing   - cy, endUtm.easting   - cx)
    const sweep = signedR >= 0
      ? -((norm(a1) - norm(a2) + 2 * Math.PI) % (2 * Math.PI))
      :   (norm(a2) - norm(a1) + 2 * Math.PI) % (2 * Math.PI)
    length     = absR * Math.abs(sweep)
    bearing    = tangentBearing(startUtm.easting, startUtm.northing, cx, cy, signedR)
    endBearing = tangentBearing(endUtm.easting,   endUtm.northing,   cx, cy, signedR)
  }
  return {
    startNode:  [startUtm.easting, startUtm.northing],
    endNode:    [endUtm.easting,   endUtm.northing],
    epsg:       startUtm.zone,
    length:     trimNoise(length),
    bearing,
    endBearing,
    radius:     signedR,
  }
}

/** Arc polyline (WGS84, for the geometry) between two plane points with a signed radius. */
export function arcCoordsFromRadiusUtm(startUtm, endUtm, signedR, maxDeviation = 0.2) {
  return arcPlanePoints(startUtm, endUtm, signedR, maxDeviation)
    ?.map(([e, n]) => utmToWgs84(e, n, startUtm.zone)) ?? null
}

/** The same arc polyline in the plane: [[E, N], …]. */
export function arcPlanePoints(startUtm, endUtm, signedR, maxDeviation = 0.2) {
  const ac = arcCenter(startUtm.easting, startUtm.northing, endUtm.easting, endUtm.northing, signedR)
  if (!ac) return null
  const { cx, cy, absR } = ac
  const norm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const a1 = Math.atan2(startUtm.northing - cy, startUtm.easting - cx)
  const a2 = Math.atan2(endUtm.northing   - cy, endUtm.easting   - cx)
  const sweep = signedR >= 0
    ? -((norm(a1) - norm(a2) + 2 * Math.PI) % (2 * Math.PI))
    :   (norm(a2) - norm(a1) + 2 * Math.PI) % (2 * Math.PI)
  const maxAngle = 2 * Math.acos(1 - maxDeviation / absR)
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / maxAngle))
  const points = []
  for (let i = 0; i <= n; i++) {
    const angle = a1 + (i / n) * sweep
    points.push([cx + absR * Math.cos(angle), cy + absR * Math.sin(angle)])
  }
  return points
}

/**
 * Polyline an element is drawn with (WGS84). Arcs and transitions already carry
 * a dense polyline and come back as stored. A straight is stored as its two end
 * points only, and a Web Mercator map draws that chord as a straight line —
 * which the true straight (straight in the track's plane) is not: at 50° N an
 * east–west 1 km straight bends 23 mm away from its chord, growing with the
 * square of the length. So a straight longer than `spacing` gets intermediate
 * vertices every ≤ `spacing` metres, stepped along the element in its own plane
 * from the stored nodes. The stored end points are kept as they are, so the
 * joins with the neighbouring elements are untouched.
 */
export function displayCoords(el, epsg, spacing = STRAIGHT_VERTEX_SPACING) {
  const coords = el.geometry?.coordinates ?? []
  if (el.radius != null || el.elementType === 2 || coords.length !== 2 || !epsg) return coords
  const [sE, sN] = el.startNode ?? []
  const [eE, eN] = el.endNode ?? []
  if (![sE, sN, eE, eN].every(Number.isFinite)) return coords
  const n = Math.ceil(Math.hypot(eE - sE, eN - sN) / spacing)
  if (n < 2) return coords
  const out = [coords[0]]
  for (let i = 1; i < n; i++) {
    out.push(utmToWgs84(sE + (eE - sE) * i / n, sN + (eN - sN) * i / n, epsg))
  }
  out.push(coords[1])
  return out
}

export function endPointStraightUtm(startUtm, bearing_deg, length_m) {
  const rad = bearing_deg * Math.PI / 180
  return {
    easting:  startUtm.easting  + length_m * Math.sin(rad),
    northing: startUtm.northing + length_m * Math.cos(rad),
    zone:     startUtm.zone,
  }
}

export function endPointCurvedUtm(startUtm, bearing_deg, arcLength_m, signedR_m) {
  const absR = Math.abs(signedR_m)
  const rad  = bearing_deg * Math.PI / 180
  const sgn  = signedR_m >= 0 ? -1 : 1
  const tE   = Math.sin(rad), tN = Math.cos(rad)
  const cx   = startUtm.easting  + sgn * absR * (-tN)
  const cy   = startUtm.northing + sgn * absR * tE
  const a1   = Math.atan2(startUtm.northing - cy, startUtm.easting - cx)
  const a2   = a1 + sgn * arcLength_m / absR
  return {
    easting:  cx + absR * Math.cos(a2),
    northing: cy + absR * Math.sin(a2),
    zone:     startUtm.zone,
  }
}

/** Along/perpendicular offset of a point from a line through startUtm with the given bearing. */
export function projectOnBearingUtm(startUtm, mouseUtm, bearing_deg) {
  const rad  = bearing_deg * Math.PI / 180
  const dirE = Math.sin(rad), dirN = Math.cos(rad)
  const dE   = mouseUtm.easting  - startUtm.easting
  const dN   = mouseUtm.northing - startUtm.northing
  return { along: dE * dirE + dN * dirN, perp: dE * dirN - dN * dirE }
}

/**
 * Tangent bearing after running `length_m` from `bearing_deg` on a route with
 * signed radius `signedR_m` (positive = right-hand curve). Null or zero radius
 * is a straight, which keeps its bearing.
 */
export function bearingAfterUtm(bearing_deg, length_m, signedR_m) {
  const b = signedR_m ? bearing_deg + (length_m / signedR_m) * 180 / Math.PI : bearing_deg
  return ((b % 360) + 360) % 360
}

/**
 * The same as projectOnBearingUtm for an arc: the offset of a point from the
 * arc that leaves startUtm on `bearing_deg` with signed radius `signedR_m`.
 * `along` is the arc length from the start (negative behind it), `perp` the
 * offset from the arc, positive to the right of the running direction — the
 * same sign convention as the straight case, which a null radius falls back to.
 * A point more than half a turn along the arc reads as being behind the start;
 * over a track element's sweep that is out of reach.
 */
export function projectOnArcUtm(startUtm, mouseUtm, bearing_deg, signedR_m) {
  if (!signedR_m) return projectOnBearingUtm(startUtm, mouseUtm, bearing_deg)
  const absR = Math.abs(signedR_m)
  const rad  = bearing_deg * Math.PI / 180
  const sgn  = signedR_m >= 0 ? -1 : 1
  const cx   = startUtm.easting  + sgn * absR * (-Math.cos(rad))
  const cy   = startUtm.northing + sgn * absR *   Math.sin(rad)
  const a1   = Math.atan2(startUtm.northing - cy, startUtm.easting - cx)
  const aP   = Math.atan2(mouseUtm.northing - cy, mouseUtm.easting - cx)
  const d    = ((aP - a1 + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
  const r    = Math.hypot(mouseUtm.easting - cx, mouseUtm.northing - cy)
  return { along: sgn * d * absR, perp: sgn * (r - absR) }
}

export function signedRadiusFrom3PointsUtm(p1, p2, p3) {
  const D = 2 * (p1.easting * (p2.northing - p3.northing) + p2.easting * (p3.northing - p1.northing) + p3.easting * (p1.northing - p2.northing))
  if (Math.abs(D) < 1e-10) return null
  const s1 = p1.easting ** 2 + p1.northing ** 2
  const s2 = p2.easting ** 2 + p2.northing ** 2
  const s3 = p3.easting ** 2 + p3.northing ** 2
  const cx = (s1 * (p2.northing - p3.northing) + s2 * (p3.northing - p1.northing) + s3 * (p1.northing - p2.northing)) / D
  const cy = (s1 * (p3.easting  - p2.easting)  + s2 * (p1.easting  - p3.easting)  + s3 * (p2.easting  - p1.easting))  / D
  const R  = Math.sqrt((p1.easting - cx) ** 2 + (p1.northing - cy) ** 2)
  const dx = p2.easting - p1.easting, dy = p2.northing - p1.northing
  return (dx * (cy - p1.northing) - dy * (cx - p1.easting)) > 0 ? -R : R
}

/**
 * End bearing of a stored element: the stored one when present (arcs,
 * transitions, kinked straights), otherwise derived from an arc's nodes and
 * radius, otherwise the element's own bearing (a plain straight).
 */
export function resolveEndBearing(element, epsg = null) {
  if (element.endBearing != null) return element.endBearing
  if (element.radius && element.startNode && element.endNode) {
    const s = { easting: element.startNode[0], northing: element.startNode[1], zone: epsg }
    const e = { easting: element.endNode[0],   northing: element.endNode[1],   zone: epsg }
    return computeCurvedValuesUtm(s, e, element.radius).endBearing
  }
  return element.bearing ?? 0
}

export function reverseElement(el) {
  const newBearing    = ((el.endBearing ?? el.bearing) + 180) % 360
  const newEndBearing = el.endBearing != null ? ((el.bearing + 180) % 360) : undefined
  const coords        = el.geometry?.coordinates ?? []
  const flipR         = (r) => (r == null ? null : -r)
  return {
    ...el,
    startNode:  el.endNode,
    endNode:    el.startNode,
    bearing:    newBearing,
    ...(newEndBearing !== undefined ? { endBearing: newEndBearing } : {}),
    ...(el.radius != null ? { radius: -el.radius } : {}),
    // Everything else that is stated relative to the running direction turns
    // with it. Cant is stored signed by the raised rail, so it changes side …
    ...(el.cant != null ? { cant: -el.cant } : {}),
    // … and a transition, which runs from curvature r1 to r2, is now entered
    // from its other end and bends to the other side. Both are rebuilt from
    // these scalars (project load, length/bearing edit), so leaving them as
    // they were makes the element contradict its own direction.
    ...(el.elementType === 2 && el.r1 !== undefined
      ? { r1: flipR(el.r2 ?? null), r2: flipR(el.r1 ?? null) }
      : {}),
    geometry: { ...el.geometry, coordinates: [...coords].reverse() },
    ...(el.renderCoords ? { renderCoords: [...el.renderCoords].reverse() } : {}),
  }
}
