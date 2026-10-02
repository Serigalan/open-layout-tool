import { wgs84ToUTM } from './coordinateUtils'
import { arcElement, straightElement, transitionElement } from './elementFactory'

const DEG = Math.PI / 180
const kappa  = (r) => (r != null && r !== 0) ? -1 / r : 0

// Right-hand perpendicular of the travel direction (sin b, cos b). At an element
// endpoint this is the radial direction, so a perpendicular offset of an arc
// endpoint lands exactly on the concentric circle.
function rightPerp(bearingDeg) {
  const b = bearingDeg * DEG
  return { e: Math.cos(b), n: -Math.sin(b) }
}

function nodeUtm(node, zone, fallbackWgs) {
  if (node && zone) return { easting: node[0], northing: node[1], zone }
  return wgs84ToUTM(fallbackWgs, zone)
}


/**
 * Offset a whole track's elements perpendicular by `dist` metres (positive =
 * right of travel) into a continuous parallel track:
 *   • straights stay parallel (same length/bearing),
 *   • arcs become concentric (radius shifted by dist, same centre),
 *   • clothoids are re-fitted so they keep their deflection and connect the
 *     offset straight ↔ offset arc.
 * Every offset endpoint is anchored to the perpendicular offset of the original
 * endpoint, so junctions coincide exactly with no drift. Returns the offset
 * element array, or null if any offset is invalid (a radius collapsed).
 */
export function offsetTrackElements(elements, dist, epsg) {
  if (!elements?.length) return null

  const out = []
  for (const el of elements) {
    const zone   = epsg
    const coords = el.geometry?.coordinates ?? []
    const oStart = nodeUtm(el.startNode, zone, coords[0])
    const oEnd   = nodeUtm(el.endNode,   zone, coords[coords.length - 1])
    const sB = el.bearing
    const eB = el.endBearing ?? el.bearing
    const ps = rightPerp(sB), pe = rightPerp(eB)
    const start = { easting: oStart.easting + dist * ps.e, northing: oStart.northing + dist * ps.n, zone }
    const end   = { easting: oEnd.easting   + dist * pe.e, northing: oEnd.northing   + dist * pe.n, zone }

    if (el.radius != null) {
      // ── Arc → concentric arc (start/end already on the concentric circle) ──
      const signedR = el.radius - dist
      // Reject if the offset reached/crossed the centre: radius collapsed (< 0.5)
      // or flipped to the opposite side of the original curve.
      if ((el.radius >= 0 ? 1 : -1) * signedR < 0.5) return null
      const arc = arcElement(start, end, signedR, { speed: el.speed, cant: el.cant })
      out.push({ ...arc, absLength: arc.length })
    } else if (el.elementType === 2) {
      // ── Clothoid → re-fitted clothoid, endpoints snapped to the parallel ──
      const r1 = el.r1 != null ? el.r1 - dist : null
      const r2 = el.r2 != null ? el.r2 - dist : null
      if ((el.r1 != null && Math.abs(r1) < 0.5) || (el.r2 != null && Math.abs(r2) < 0.5)) return null
      const kSum  = kappa(el.r1) + kappa(el.r2)
      const kSum2 = kappa(r1) + kappa(r2)
      const length = Math.abs(kSum2) < 1e-12 ? el.length : el.length * kSum / kSum2
      out.push(transitionElement(start, sB, length, r1, r2, {
        transitionType: el.transitionType, endUtm: end, endBearing: eB,
        absLength: length, speed: el.speed, cant: el.cant,
      }).element)
    } else {
      // ── Straight → parallel straight ──
      const straight = straightElement(start, end, { speed: el.speed, cant: el.cant })
      out.push({ ...straight, absLength: straight.length })
    }
  }
  return out
}
