import proj4 from 'proj4'
import { ntv2Ready, GRID_KEY } from './ntv2Grid'

// One projected plane per track (`track.epsg`): every calculation in the app
// runs in that plane on { easting, northing, zone } points. WGS84 is derived
// from the plane for display and file formats that need it — it is never an
// input to a calculation, and no conversion picks a zone on its own.

const utmProj = (zoneNumber, south) =>
  `+proj=utm +zone=${zoneNumber}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`

// Bessel-based 3-degree Gauss-Krüger: zone n → central meridian n·3°, false
// easting n·1e6 + 500000. Only the datum shift differs between the two frames.
const besselGk = (zone, datum) =>
  `+proj=tmerc +lat_0=0 +lon_0=${zone * 3} +k=1 +x_0=${zone * 1000000 + 500000} +y_0=0 +ellps=bessel ${datum} +units=m +no_defs`

// DB_REF — the Deutsche-Bahn frame. Parameters are EPSG's "DB_REF to ETRS89 (1)"
// with the rotations negated, because that operation is stated in the
// coordinate-frame convention and proj4's +towgs84 expects position-vector.
const gkProj = (zone) =>
  besselGk(zone, '+towgs84=584.9636,107.7175,413.8067,1.1155,0.2824,-3.1384,7.9922')

// DHDN — the pre-DB_REF national frame; the MDB import meets it as `EA0`.
// The 7-parameter set is only good to about a metre (p95); the plan view
// needs about 5 cm, which is what the BeTA2007 grid (ntv2Grid.js) gets to.
// `+nadgrids` replaces the Helmert shift outright once the grid has loaded —
// proj4 ignores +towgs84 on a proj string that also names a grid — so this
// switches the whole proj string, not just an extra parameter.
const dhdnProj = (zone) => (ntv2Ready()
  ? besselGk(zone, `+nadgrids=${GRID_KEY}`)
  : besselGk(zone, '+towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7'))

/**
 * Gauss-Krüger zone of a Bessel-based EPSG code (DB_REF or DHDN), else null.
 * Both blocks are numbered by their own logic, so nothing derives a zone by
 * subtracting on its own.
 */
export function gkZone(crs) {
  const code = Number(crs)
  if (code >= 5681 && code <= 5685) return code - 5680
  // The DHDN block is not contiguous by zone: 5676→2 … 5679→5, but 5680→1.
  if (code >= 5676 && code <= 5680) return code === 5680 ? 1 : code - 5674
  return null
}

/**
 * proj4 definition for a supported EPSG code (number or numeric string).
 * 258xx (ETRS89/UTM) intentionally uses a +datum=WGS84 definition — ETRS89 and
 * WGS84 are treated as identical here (sub-cm in Europe).
 */
export function projStringFor(crs) {
  const code = Number(crs)
  if (code >= 5681 && code <= 5685) return gkProj(gkZone(code))
  if (code >= 5676 && code <= 5680) return dhdnProj(gkZone(code))
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
