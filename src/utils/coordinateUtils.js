import proj4 from 'proj4'

// One projected plane per track (`track.epsg`): every calculation in the app
// runs in that plane on { easting, northing, zone } points. WGS84 is derived
// from the plane for display and file formats that need it — it is never an
// input to a calculation, and no conversion picks a zone on its own.

const utmProj = (zoneNumber, south) =>
  `+proj=utm +zone=${zoneNumber}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`

// DB_REF / 3-degree Gauss-Krüger (Bessel ellipsoid, DB_REF datum shift);
// zone n → central meridian n·3°, false easting n·1e6 + 500000.
const gkProj = (zone) =>
  `+proj=tmerc +lat_0=0 +lon_0=${zone * 3} +k=1 +x_0=${zone * 1000000 + 500000} +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs`

/**
 * proj4 definition for a supported EPSG code (number or numeric string).
 * 258xx (ETRS89/UTM) intentionally uses a +datum=WGS84 definition — ETRS89 and
 * WGS84 are treated as identical here (sub-cm in Europe).
 */
export function projStringFor(crs) {
  const code = Number(crs)
  if (code >= 5681 && code <= 5685) return gkProj(code - 5680)
  if (code >= 25828 && code <= 25838) return utmProj(code - 25800, false)
  if (code >= 32601 && code <= 32660) return utmProj(code - 32600, false)
  if (code >= 32701 && code <= 32760) return utmProj(code - 32700, true)
  throw new Error(`Unsupported CRS: ${crs}`)
}

/** Supported EPSG codes for the track-creation CRS picker (auto-suggested, overridable). */
export const EPSG_OPTIONS = [
  { code: 25831, label: 'ETRS89 / UTM Zone 31N' },
  { code: 25832, label: 'ETRS89 / UTM Zone 32N' },
  { code: 25833, label: 'ETRS89 / UTM Zone 33N' },
  { code: 5681,  label: 'DB_REF / GK Zone 1' },
  { code: 5682,  label: 'DB_REF / GK Zone 2' },
  { code: 5683,  label: 'DB_REF / GK Zone 3' },
  { code: 5684,  label: 'DB_REF / GK Zone 4' },
]

/**
 * EPSG code of the UTM zone containing a WGS84 coordinate — the suggestion a
 * new track starts with (the user may pick another CRS). Existing tracks
 * never use it: their plane is `track.epsg`.
 */
export function epsgForLngLat(lngLat) {
  const zone = Math.floor((lngLat[0] + 180) / 6) + 1
  if (lngLat[1] >= 0 && zone >= 28 && zone <= 38) return 25800 + zone
  return (lngLat[1] < 0 ? 32700 : 32600) + zone
}

/**
 * Project a WGS84 [lng, lat] into the plane `crs` (required — the track's
 * epsg, or epsgForLngLat for a track that does not exist yet).
 */
export function wgs84ToUTM(lngLat, crs) {
  if (crs == null || crs === '') throw new Error('wgs84ToUTM: a CRS is required (the track plane decides, never the point)')
  const epsg = Number(crs)
  const [easting, northing] = proj4('EPSG:4326', projStringFor(epsg), lngLat)
  return { easting, northing, zone: epsg }
}

export function utmToWgs84(easting, northing, crs) {
  return proj4(projStringFor(crs), 'EPSG:4326', [easting, northing])
}

/**
 * Move a point from one plane to another ([E, N] in `fromCrs` → [E, N] in
 * `toCrs`). Both planes are named by their EPSG code, so no zone is guessed;
 * the same code on both sides hands the point back untouched rather than
 * sending it through a round trip that could only add float noise.
 *
 * This moves the point and nothing else. A grid bearing at that point belongs
 * to the grid it was stated in and does not follow along —
 * transformGridBearing is what carries one over.
 */
export function transformPlanePoint(easting, northing, fromCrs, toCrs) {
  if (Number(fromCrs) === Number(toCrs)) return [easting, northing]
  return proj4(projStringFor(fromCrs), projStringFor(toCrs), [easting, northing])
}

/**
 * Convert a grid bearing at a point from one CRS grid to another (captures the
 * meridian-convergence difference, e.g. GK4 ↔ UTM: ~2°). Uses a 10 m probe.
 * easting/northing are the point's coordinates in `fromCrs`.
 */
export function transformGridBearing(easting, northing, bearingDeg, fromCrs, toCrs) {
  if (Number(fromCrs) === Number(toCrs)) return bearingDeg
  const from = projStringFor(fromCrs)
  const to   = projStringFor(toCrs)
  const rad  = bearingDeg * Math.PI / 180
  const [e1, n1] = proj4(from, to, [easting, northing])
  const [e2, n2] = proj4(from, to, [easting + 10 * Math.sin(rad), northing + 10 * Math.cos(rad)])
  return ((Math.atan2(e2 - e1, n2 - n1) * 180 / Math.PI) + 360) % 360
}
