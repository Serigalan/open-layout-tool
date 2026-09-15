import {
  endPointStraightUtm,
  endPointCurvedUtm,
  computeStraightValuesUtm,
  computeCurvedValuesUtm,
  arcCoordsFromRadiusUtm,
} from './elementUtils'
import { computeClothoidUtm } from './clothoidUtils'
import { utmToWgs84 } from './coordinateUtils'
import { SAGITTA_ELEMENT, cantSign } from './mapConstants'

const RECORD_SIZE = 78
const RAD2DEG = 180 / Math.PI

// Junction tolerance [m]: an element must start where the previous one ends.
// Source files quantize lengths to mm, so long elements can end up to a few
// tenths of a millimetre off the next record's start.
const JUNCTION_TOL = 0.0003   // 0.3 mm

function readRecord(view, offset) {
  const rec = {}
  rec.radiusB   = view.getFloat64(offset, true); offset += 8
  rec.radiusE   = view.getFloat64(offset, true); offset += 8
  rec.easting   = view.getFloat64(offset, true); offset += 8
  rec.northing  = view.getFloat64(offset, true); offset += 8
  rec.bearing   = view.getFloat64(offset, true); offset += 8
  rec.absLength = view.getFloat64(offset, true); offset += 8
  rec.type      = view.getInt16(offset,   true); offset += 2
  rec.length    = view.getFloat64(offset, true); offset += 8
  rec.cantB     = view.getFloat64(offset, true); offset += 8
  rec.cantE     = view.getFloat64(offset, true); offset += 8
  rec.index     = view.getFloat32(offset, true)
  return rec
}

function r3(v) { return Math.round(v * 1000) / 1000 }

/** Parse binary buffer into an array of raw records */
export function parseRecords(arrayBuffer) {
  const view    = new DataView(arrayBuffer)
  const count   = Math.floor(view.byteLength / RECORD_SIZE)
  const records = []
  for (let i = 0; i < count; i++) {
    records.push(readRecord(view, i * RECORD_SIZE))
  }
  return records
}

/**
 * Build element objects from parsed records. The records are interpreted
 * natively in the selected CRS (`epsg`, e.g. 25832 or 5683, applied at track
 * level by the caller): coordinates, grid bearings and lengths are taken
 * as-is — no reprojection. Only the display geometry is derived via WGS84.
 *
 * Record types: 0 = straight, 1 = circular arc, 2 = clothoid, 4 = Bloss curve,
 * 5 = straight with a kink at its END (radiusB holds the junction angle in
 * gon; the element's endBearing = bearing + (radiusB − 200) gon, which then
 * matches the next element's start bearing).
 * Types 3 and 6 are silently ignored, as are zero-length records. The last
 * element record is always ignored — it only marks the alignment's end point.
 *
 * Each element must start where the previous one ends (tolerance 0.3 mm);
 * violations are reported in `errors`. Returns { elements, errors }.
 */
export function buildElements(records, epsg) {
  const crs = Number(epsg)
  const elements = []
  const errors = []
  let prevIdx = -1

  // The last element record is the alignment's closing point — never imported.
  let lastValidIdx = -1
  for (let i = records.length - 1; i >= 0; i--) {
    if ([0, 1, 2, 4, 5].includes(records[i].type)) { lastValidIdx = i; break }
  }

  for (let idx = 0; idx < records.length; idx++) {
    const rec = records[idx]
    if (![0, 1, 2, 4, 5].includes(rec.type) || idx === lastValidIdx) continue
    if (!(rec.length > 0)) continue   // degenerate records carry no geometry

    // Junction check against the previously built element
    if (elements.length > 0) {
      const prevEnd = elements[elements.length - 1].endNode
      const gap = Math.hypot(rec.easting - prevEnd[0], rec.northing - prevEnd[1])
      if (gap > JUNCTION_TOL) {
        errors.push(`#${prevIdx + 1} → #${idx + 1}: Anschluss-Abweichung ${(gap * 1000).toFixed(2)} mm`)
      }
    }
    prevIdx = idx

    const start      = { easting: rec.easting, northing: rec.northing, zone: crs }
    const bearingDeg = ((rec.bearing * RAD2DEG) % 360 + 360) % 360   // bearing stored in radians (grid)

    if (rec.type === 0 || rec.type === 5) {
      // ── Straight (type 5: with a kink at its end) ──────────────────────────
      const end = endPointStraightUtm(start, bearingDeg, rec.length)
      const sv  = computeStraightValuesUtm(start, end)
      const kinkEndBearing = rec.type === 5
        ? ((sv.bearing + (rec.radiusB - 200) * 0.9) % 360 + 360) % 360   // gon → degrees
        : undefined
      elements.push({
        elementType: 0,
        startNode:   sv.startNode,
        endNode:     sv.endNode,
        bearing:     sv.bearing,
        length:      sv.length,
        absLength:   sv.length,   // recalcAbsLengths will overwrite
        speed:       0,
        ...(rec.cantB ? { cant: rec.cantB } : {}),
        ...(kinkEndBearing !== undefined ? { endBearing: kinkEndBearing } : {}),
        geometry:    { type: 'LineString', coordinates: [utmToWgs84(start.easting, start.northing, crs), utmToWgs84(end.easting, end.northing, crs)] },
      })

    } else if (rec.type === 1) {
      // ── Circular arc ───────────────────────────────────────────────────────
      const signedR = rec.radiusB !== 0 ? rec.radiusB : rec.radiusE
      const end     = endPointCurvedUtm(start, bearingDeg, rec.length, signedR)
      const cv      = computeCurvedValuesUtm(start, end, signedR)
      const coords  = arcCoordsFromRadiusUtm(start, end, signedR, SAGITTA_ELEMENT)
        ?? [utmToWgs84(start.easting, start.northing, crs), utmToWgs84(end.easting, end.northing, crs)]
      elements.push({
        elementType: 1,
        startNode:   cv.startNode,
        endNode:     cv.endNode,
        bearing:     cv.bearing,
        length:      cv.length,
        absLength:   cv.length,
        speed:       0,
        // Arcs carry a constant cant (cantB == cantE). The file stores it as a
        // magnitude, so the sign comes from the curve direction.
        cant:        cantSign(signedR) * Math.abs(rec.cantB),
        endBearing:  cv.endBearing,
        radius:      r3(signedR),
        geometry:    { type: 'LineString', coordinates: coords },
      })

    } else if (rec.type === 2 || rec.type === 4) {
      // ── Transition curve: type 2 = clothoid, type 4 = Bloss ────────────────
      // radiusB = 0 → entry from straight; radiusE = 0 → exit to straight.
      // cantB → cantE is a ramp, not a scalar — deliberately not stored; it is
      // implied by the adjacent elements' cants.
      const transitionType = rec.type === 4 ? 'bloss' : 'clothoid'
      const r1 = rec.radiusB !== 0 ? rec.radiusB : null
      const r2 = rec.radiusE !== 0 ? rec.radiusE : null
      const cl = computeClothoidUtm(start, bearingDeg, rec.length, r1, r2, SAGITTA_ELEMENT, transitionType)
      elements.push({
        elementType: 2,
        transitionType,
        r1,
        r2,
        startNode:   [start.easting, start.northing],
        endNode:     [cl.endUtm.easting, cl.endUtm.northing],
        bearing:     bearingDeg,
        length:      r3(rec.length),
        absLength:   r3(rec.length),
        speed:       0,
        endBearing:  cl.endBearing,
        geometry:    { type: 'LineString', coordinates: cl.coords },
      })
    }
  }

  return { elements, errors }
}
