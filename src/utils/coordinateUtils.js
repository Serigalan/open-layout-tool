import proj4 from 'proj4'
import { nadgridsList } from './ntv2Grid'

// One projected plane per track (`track.epsg`): every calculation in the app
// runs in that plane on { easting, northing, zone } points. WGS84 is derived
// from the plane for display and file formats that need it — it is never an
// input to a calculation, and no conversion picks a zone on its own.

const utmProj = (zoneNumber, south) =>
  `+proj=utm +zone=${zoneNumber}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`

/**
 * The datums a plane can be stated in, with the ellipsoid each is computed on
 * and the 7-parameter shift to WGS84 to use where no grid covers the point.
 * Every set is EPSG's own, stated in the position-vector convention proj4's
 * `+towgs84` expects:
 *
 * - `DHDN` — the pre-DB_REF national frame, "DHDN to WGS 84 (2)". The MDB
 *   import meets it as `EA0`, and Berlin's Soldner net is computed on it too.
 * - `PD83` — Thüringen's own realisation, "PD/83 to ETRS89 (1)". `DB0`.
 * - `RD83` — Sachsen's, "RD/83 to ETRS89 (1)". Both are Bessel on the same
 *   fundamental points as DHDN and agree with it to about a metre, which is
 *   exactly why they need their own numbers.
 * - `S4283` — 42/83, the Krassowski frame of the eastern states,
 *   "Pulkovo 1942(83) to ETRS89 (2)", the one EPSG rates at 0.1 m.
 * - `DBREF` — the Deutsche-Bahn frame, "DB_REF to ETRS89 (1)" with the
 *   rotations negated, because that operation is stated in the
 *   coordinate-frame convention and proj4 expects position-vector.
 *
 * Only the first three have grids (ntv2Grid); for them the Helmert set is the
 * fallback, for the other two it is the answer.
 */
const DATUM = {
  DHDN:  { ellps: 'bessel', helmert: '+towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7' },
  PD83:  { ellps: 'bessel', helmert: '+towgs84=599.4,72.4,419.2,-0.062,-0.022,-2.723,6.46' },
  RD83:  { ellps: 'bessel', helmert: '+towgs84=612.4,77,440.2,-0.054,0.057,-2.797,2.55' },
  S4283: { ellps: 'krass',  helmert: '+towgs84=24.9,-126.4,-93.2,-0.063,-0.247,-0.041,1.01' },
  DBREF: { ellps: 'bessel', helmert: '+towgs84=584.9636,107.7175,413.8067,1.1155,0.2824,-3.1384,7.9922' },
}

/** How each datum is written where a CRS is named. */
const DATUM_NAME = { DHDN: 'DHDN', PD83: 'PD/83', RD83: 'RD/83', S4283: '42/83', DBREF: 'DB_REF' }

/**
 * The datum and Gauss-Krüger zone an EPSG code stands for, or null for a code
 * that is not one of the German planes. Each block is numbered by its own
 * logic, so nothing derives a zone by subtracting on its own.
 */
function planeOf(crs) {
  const code = Number(crs)
  if (code >= 5681 && code <= 5685) return { datum: 'DBREF', zone: code - 5680 }
  // The DHDN block is not contiguous by zone: 5676→2 … 5679→5, but 5680→1.
  if (code >= 5676 && code <= 5680) return { datum: 'DHDN', zone: code === 5680 ? 1 : code - 5674 }
  if (code >= 3396 && code <= 3397) return { datum: 'PD83', zone: code - 3393 }   // Thüringen, zones 3–4
  if (code >= 3398 && code <= 3399) return { datum: 'RD83', zone: code - 3394 }   // Sachsen, zones 4–5
  if (code >= 2397 && code <= 2399) return { datum: 'S4283', zone: code - 2394 }  // 42/83, zones 3–5
  if (code === 3068) return { datum: 'DHDN', soldner: true }
  return null
}

/** Gauss-Krüger zone of a German plane, else null (Soldner Berlin has none). */
export const gkZone = (crs) => planeOf(crs)?.zone ?? null

/** Which datum a plane is stated in — what `loadGridsFor` needs to be told. */
export const crsDatum = (crs) => planeOf(crs)?.datum ?? null

// 3-degree Gauss-Krüger: zone n → central meridian n·3°, false easting
// n·1e6 + 500000. Only the ellipsoid and the datum shift differ between the
// frames that use it.
const gkProj = (plane, shift) =>
  `+proj=tmerc +lat_0=0 +lon_0=${plane.zone * 3} +k=1 +x_0=${plane.zone * 1000000 + 500000} +y_0=0 `
  + `+ellps=${DATUM[plane.datum].ellps} ${shift} +units=m +no_defs`

// Berlin's Soldner net: Cassini-Soldner on Bessel about the Müggelberg, the
// one plane here that is not a Gauss-Krüger strip.
const soldnerProj = (shift) =>
  '+proj=cass +lat_0=52.4186482777778 +lon_0=13.6272036666667 +x_0=40000 +y_0=10000 '
  + `+ellps=bessel ${shift} +units=m +no_defs`

const planeProj = (plane, shift) => (plane.soldner ? soldnerProj(shift) : gkProj(plane, shift))

// The grid list, not one grid: a regional grid loaded for an import sits in
// front of its datum's base grid and is used where it reaches (ntv2Grid).
// `+nadgrids` replaces the Helmert shift outright once a grid has loaded —
// proj4 ignores +towgs84 on a proj string that also names a grid — so this
// switches the whole proj string, not just an extra parameter.
const shiftFor = (datum) => {
  const grids = nadgridsList(datum)
  return grids ? `+nadgrids=${grids}` : DATUM[datum].helmert
}

/**
 * proj4 definition for a supported EPSG code (number or numeric string).
 * 258xx (ETRS89/UTM) intentionally uses a +datum=WGS84 definition — ETRS89 and
 * WGS84 are treated as identical here (sub-cm in Europe).
 */
export function projStringFor(crs) {
  const plane = planeOf(crs)
  if (plane) return planeProj(plane, shiftFor(plane.datum))
  const code = Number(crs)
  if (code >= 25828 && code <= 25838) return utmProj(code - 25800, false)
  if (code >= 32601 && code <= 32660) return utmProj(code - 32600, false)
  if (code >= 32701 && code <= 32760) return utmProj(code - 32700, true)
  throw new Error(`Unsupported CRS: ${crs}`)
}

/**
 * What a supported EPSG code is called, from the same blocks projStringFor
 * resolves — null for a code this tool has no plane for. Every code it does
 * support is named, not only the handful the picker offers: the MDB import
 * brings tracks in every Lagesystem the DB ASCII interface knows, and a column
 * or a plan sheet that showed those as a bare number would leave the reader to
 * look the frame up.
 */
export function crsName(crs) {
  const plane = planeOf(crs)
  if (plane) return plane.soldner ? 'DHDN / Soldner Berlin' : `${DATUM_NAME[plane.datum]} / GK Zone ${plane.zone}`
  const code = Number(crs)
  if (code >= 25828 && code <= 25838) return `ETRS89 / UTM Zone ${code - 25800}N`
  if (code >= 32601 && code <= 32660) return `WGS 84 / UTM Zone ${code - 32600}N`
  if (code >= 32701 && code <= 32760) return `WGS 84 / UTM Zone ${code - 32700}S`
  return null
}

/** How a CRS is written out in full — on a plan sheet, in the element table. */
export function crsLabel(crs) {
  if (!crs) return ''
  const name = crsName(crs)
  return name ? `EPSG ${crs} – ${name}` : `EPSG ${crs}`
}

/**
 * Supported EPSG codes for the track-creation CRS picker (auto-suggested,
 * overridable). The list is the choice on offer — a new track is laid out in a
 * current frame — while crsName covers every code the tool can read.
 */
export const EPSG_OPTIONS = [25831, 25832, 25833, 5681, 5682, 5683, 5684, 5685]
  .map(code => ({ code, label: crsName(code) }))

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
 * The same plane without its grid — what a point outside the grid's area is
 * converted on instead. Null for a plane that is not on a grid right now: the
 * retry would be the same conversion.
 */
function offGridProjString(crs) {
  const plane = planeOf(crs)
  return plane && nadgridsList(plane.datum) ? planeProj(plane, DATUM[plane.datum].helmert) : null
}

/**
 * proj4, with the one way the grid fails.
 *
 * A grid covers its own area and not a metre more — BeTA2007 is 5.5°–15.83° E,
 * 46.9°–55.3° N, Thüringen's is the state. A point outside comes back as
 * **[NaN, NaN]**: proj4 writes one line to the console and hands the NaNs on,
 * it does not raise. Unchecked they reach an element's startNode, its geometry
 * and the track's coordinates, and only surface much later as a track that
 * will not draw or a length that is not a number — far from the coordinate
 * that caused it.
 *
 * So a non-finite result is converted again without the grid. The 7-parameter
 * set is defined everywhere and is what the whole app ran on before the grid
 * existed; a metre of error at a point past the grid's edge is worth having
 * over no point at all. Only a plane that is on a grid can take this path —
 * for every other one the retry would be the same conversion, and the NaN
 * stands.
 */
function project(fromDef, toDef, point, fromCrs = null, toCrs = null) {
  const out = proj4(fromDef, toDef, point)
  if (Number.isFinite(out[0]) && Number.isFinite(out[1])) return out
  const from = offGridProjString(fromCrs) ?? fromDef
  const to   = offGridProjString(toCrs)   ?? toDef
  return from === fromDef && to === toDef ? out : proj4(from, to, point)
}

/**
 * Project a WGS84 [lng, lat] into the plane `crs` (required — the track's
 * epsg, or epsgForLngLat for a track that does not exist yet).
 */
export function wgs84ToUTM(lngLat, crs) {
  if (crs == null || crs === '') throw new Error('wgs84ToUTM: a CRS is required (the track plane decides, never the point)')
  const epsg = Number(crs)
  const [easting, northing] = project('EPSG:4326', projStringFor(epsg), lngLat, null, epsg)
  return { easting, northing, zone: epsg }
}

export function utmToWgs84(easting, northing, crs) {
  return project(projStringFor(crs), 'EPSG:4326', [easting, northing], crs, null)
}

/**
 * A whole polyline out of one plane into WGS84 — the same conversion as
 * `utmToWgs84`, with the proj string built once instead of per vertex. A
 * transition curve is sampled into hundreds of points at a time (clothoidUtils),
 * which is what this exists for.
 */
export function planeCoordsToWgs84(points, crs) {
  const def = projStringFor(crs)
  return (points ?? []).map(([easting, northing]) =>
    project(def, 'EPSG:4326', [easting, northing], crs, null))
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
  return project(projStringFor(fromCrs), projStringFor(toCrs), [easting, northing], fromCrs, toCrs)
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
  const [e1, n1] = project(from, to, [easting, northing], fromCrs, toCrs)
  const [e2, n2] = project(from, to, [easting + 10 * Math.sin(rad), northing + 10 * Math.cos(rad)], fromCrs, toCrs)
  return ((Math.atan2(e2 - e1, n2 - n1) * 180 / Math.PI) + 360) % 360
}
