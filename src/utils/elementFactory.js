import { utmToWgs84 } from './coordinateUtils'
import {
  arcCoordsFromRadiusUtm, computeCurvedValuesUtm, computeStraightValuesUtm, endPointCurvedUtm, endPointStraightUtm,
} from './elementUtils'
import { computeClothoidUtm } from './clothoidUtils'
import { SAGITTA_ELEMENT, SAGITTA_TRACK } from './geometryPrecision'

// The element factory (R4.1): every place that makes a track element — the
// create and connect forms, splicing, parallels, switch connections, the
// importers — makes it here, from plane points (`{ easting, northing, zone }`,
// zone the track's EPSG) and the design scalars. The element carries its plane
// data (nodes, bearings, length, radii) and the display geometry derived from
// it: `geometry` (fine, SAGITTA_ELEMENT) and, for arcs and transitions,
// `renderCoords` (coarse, SAGITTA_TRACK) — the same as reconstructElements
// derives on load, so a fresh element and a reloaded one look alike.
//
// `extra` is merged in last: speed, cant, switch marks, absLength …

const wgs = (p) => utmToWgs84(p.easting, p.northing, p.zone)
const line = (coordinates) => ({ type: 'LineString', coordinates })

/** A straight from `startUtm` to `endUtm`. */
export function straightElement(startUtm, endUtm, extra = {}) {
  const v = computeStraightValuesUtm(startUtm, endUtm)
  return {
    elementType: 0,
    startNode: v.startNode,
    endNode: v.endNode,
    bearing: v.bearing,
    length: v.length,
    geometry: line([wgs(startUtm), wgs(endUtm)]),
    ...extra,
  }
}

/** A straight of `length` from `startUtm` at `bearing`. */
export function straightFrom(startUtm, bearing, length, extra = {}) {
  return straightElement(startUtm, endPointStraightUtm(startUtm, bearing, length), extra)
}

/** An arc from `startUtm` to `endUtm` with signed radius `signedR` (+ right, − left). */
export function arcElement(startUtm, endUtm, signedR, extra = {}) {
  const v = computeCurvedValuesUtm(startUtm, endUtm, signedR)
  const chord = [wgs(startUtm), wgs(endUtm)]
  return {
    elementType: 1,
    startNode: v.startNode,
    endNode: v.endNode,
    bearing: v.bearing,
    endBearing: v.endBearing,
    length: v.length,
    radius: signedR,
    geometry: line(arcCoordsFromRadiusUtm(startUtm, endUtm, signedR, SAGITTA_ELEMENT) ?? chord),
    renderCoords: arcCoordsFromRadiusUtm(startUtm, endUtm, signedR, SAGITTA_TRACK) ?? chord,
    ...extra,
  }
}

/** An arc of `length` from `startUtm` at `bearing` with signed radius `signedR`. */
export function arcFrom(startUtm, bearing, length, signedR, extra = {}) {
  return arcElement(startUtm, endPointCurvedUtm(startUtm, bearing, length, signedR), signedR, extra)
}

/**
 * A transition curve of `length` from `startUtm` at `bearing`, its curvature
 * running from 1/r1 to 1/r2 (null = straight), shaped as `transitionType`
 * ('clothoid' or 'bloss'). Where the end is already fixed — a splice knows the
 * point the next element starts at — `endUtm` names it; the curve then ends
 * there exactly. Returns { element, endUtm, endBearing }.
 */
export function transitionElement(startUtm, bearing, length, r1, r2, { transitionType = 'clothoid', endUtm = null, ...extra } = {}) {
  const cl  = computeClothoidUtm(startUtm, bearing, length, r1, r2, SAGITTA_ELEMENT, transitionType)
  const clR = computeClothoidUtm(startUtm, bearing, length, r1, r2, SAGITTA_TRACK, transitionType)
  const end = endUtm ?? cl.endUtm
  const endWgs = endUtm ? wgs(endUtm) : null
  const element = {
    elementType: 2,
    transitionType,
    r1,
    r2,
    startNode: [startUtm.easting, startUtm.northing],
    endNode: [end.easting, end.northing],
    bearing,
    endBearing: cl.endBearing,
    length,
    geometry: line(endWgs ? [...cl.coords.slice(0, -1), endWgs] : cl.coords),
    renderCoords: endWgs ? [...clR.coords.slice(0, -1), endWgs] : clR.coords,
    ...extra,
  }
  return { element, endUtm: { ...end, zone: startUtm.zone }, endBearing: cl.endBearing }
}
