// Shared geometry helpers and map layer names for the EditElement forms.
import { rebuildCoords, recalcAbsLengths } from '../../../storage'
import {
  computeStraightValuesUtm, computeCurvedValuesUtm, arcCoordsFromRadiusUtm,
  endPointStraightUtm, endPointCurvedUtm, nodeUtm, resolveEndBearing, displayCoords,
} from '../../../utils/elementUtils'
import { computeClothoidUtm } from '../../../utils/clothoidUtils'
import { utmToWgs84 } from '../../../utils/coordinateUtils'
import { SAGITTA_ELEMENT, SAGITTA_TRACK } from '../../../utils/mapConstants'
import { truncateHeights } from '../../../utils/heightUtils'

export const EDIT_MARKER_SOURCE = 'edit-length-markers-source'
export const EDIT_MARKER_LAYER  = 'edit-length-markers-layer'
export const EDIT_LINES_SOURCE  = 'edit-length-lines-source'
export const EDIT_LINES_LAYER   = 'edit-length-lines-layer'

export function nodesApproxEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  return Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001
}

const norm360 = (deg) => ((deg % 360) + 360) % 360
const wgs = (p) => utmToWgs84(p.easting, p.northing, p.zone)

/**
 * End bearing a straight keeps when its own direction changes by `newBearing`.
 * A straight may carry a kink at its end (Verm.ESN type 5): a stored end bearing
 * that differs from the direction it runs in. That deflection angle belongs to
 * the element and cannot be re-derived — so it travels with the element instead
 * of being dropped. A straight without a kink keeps no end bearing.
 */
function shiftedKink(el, newBearing) {
  if (el.radius != null || el.elementType === 2 || el.endBearing == null) return undefined
  return norm360(newBearing + (el.endBearing - el.bearing))
}

/**
 * Rebuild an element from a start point in the track's plane and its design
 * scalars — the given ones, else its own. Nodes, end bearing and the WGS84
 * geometry all follow from that; nothing is read back from WGS84.
 * A transition is defined by its curvature ends (r1/r2), not by a radius:
 * length and bearing reshape the spiral, they never turn it into a straight.
 */
function buildElement(el, startUtm, { bearing = el.bearing, length = el.length, radius = el.radius } = {}) {
  const startNode = [startUtm.easting, startUtm.northing]
  const startWgs  = wgs(startUtm)
  if (el.elementType === 2 && el.r1 !== undefined) {
    const cl  = computeClothoidUtm(startUtm, bearing, length, el.r1, el.r2 ?? null, SAGITTA_ELEMENT, el.transitionType)
    const clR = computeClothoidUtm(startUtm, bearing, length, el.r1, el.r2 ?? null, SAGITTA_TRACK, el.transitionType)
    return {
      ...el, bearing, length, endBearing: cl.endBearing,
      startNode, endNode: [cl.endUtm.easting, cl.endUtm.northing],
      geometry:     { type: 'LineString', coordinates: cl.coords },
      renderCoords: clR.coords,
    }
  }
  if (radius != null) {
    const endUtm = endPointCurvedUtm(startUtm, bearing, length, radius)
    const v      = computeCurvedValuesUtm(startUtm, endUtm, radius)
    const chord  = [startWgs, wgs(endUtm)]
    return {
      ...el, elementType: 1, bearing, length, radius,
      startNode, endNode: v.endNode, endBearing: v.endBearing,
      geometry:     { type: 'LineString', coordinates: arcCoordsFromRadiusUtm(startUtm, endUtm, radius, SAGITTA_ELEMENT) ?? chord },
      renderCoords: arcCoordsFromRadiusUtm(startUtm, endUtm, radius, SAGITTA_TRACK) ?? chord,
    }
  }
  const endUtm = endPointStraightUtm(startUtm, bearing, length)
  const v      = computeStraightValuesUtm(startUtm, endUtm)
  return {
    ...el, elementType: 0, bearing, length, radius: null,
    endBearing: shiftedKink(el, bearing),
    startNode, endNode: v.endNode,
    geometry: { type: 'LineString', coordinates: [startWgs, wgs(endUtm)] },
    // An arc cleared to a straight would otherwise keep drawing its old curve
    // in the track polyline (rebuildCoords prefers renderCoords).
    renderCoords: undefined,
  }
}

const endUtmOf = (el, epsg) => ({ easting: el.endNode[0], northing: el.endNode[1], zone: epsg })

// Move every element that started at `oldNode` onto the new end (start point
// and tangent), and on down the chain. Nodes are plane coordinates, so only
// tracks in the same plane can share one.
function propagate(tracks, epsg, oldNode, fromEl) {
  const queue = [{ oldNode, start: endUtmOf(fromEl, epsg), bearing: fromEl.endBearing ?? fromEl.bearing }]
  while (queue.length > 0) {
    const { oldNode: node, start, bearing } = queue.shift()
    for (const t of tracks) {
      if (Number(t.epsg) !== Number(epsg)) continue
      for (let i = 0; i < (t.elements?.length ?? 0); i++) {
        const e = t.elements[i]
        if (!nodesApproxEqual(e.startNode, node)) continue
        const shifted = buildElement(e, start, { bearing })
        queue.push({ oldNode: e.endNode, start: endUtmOf(shifted, epsg), bearing: shifted.endBearing ?? shifted.bearing })
        t.elements[i] = shifted
      }
    }
  }
}

const finish = (tracks) => tracks.map(t => {
  const elems = recalcAbsLengths(t.elements ?? [])
  return { ...t, elements: elems, coordinates: rebuildCoords(elems) }
})

/**
 * Change an element's length, bearing and/or radius (radius null = straight).
 * The element is rebuilt from its start node in the track's plane; everything
 * connected to its end follows. Returns the new track array.
 *
 * A new length re-stations the track from that element on, so the vertical
 * alignment is cut there — what lies before it keeps its height points, the
 * rest is read from the terrain again (see elevationFill).
 */
export function applyElementChange(tracks, trackId, elIdx, { length, bearing, radius }) {
  const newTracks = tracks.map(t => ({ ...t, elements: (t.elements ?? []).map(e => ({ ...e })) }))
  const track = newTracks.find(t => t.id === trackId)
  const el    = track?.elements?.[elIdx]
  if (!el) return newTracks
  const epsg     = track.epsg
  const startUtm = nodeUtm(el.startNode, el.geometry?.coordinates?.[0], epsg)
  const newEl = buildElement(el, startUtm, {
    bearing: bearing !== undefined ? bearing : el.bearing,
    length:  length  !== undefined ? length  : el.length,
    radius:  radius  !== undefined ? radius  : el.radius,
  })
  if (newEl.length !== el.length && track.heights) {
    const cutAt = track.elements.slice(0, elIdx).reduce((sum, e) => sum + (e.length ?? 0), 0)
    const kept  = truncateHeights(track.heights, cutAt)
    if (kept) track.heights = kept; else delete track.heights
  }
  track.elements[elIdx] = newEl
  propagate(newTracks, epsg, el.endNode, newEl)
  return finish(newTracks)
}

/** Change only the length (interactive length edit). */
export function applyLengthChange(tracks, trackId, elIdx, newLength) {
  return applyElementChange(tracks, trackId, elIdx, { length: newLength })
}

export function buildLineFeatures(tracks) {
  const features = []
  for (const track of tracks) {
    for (let i = 0; i < (track.elements ?? []).length; i++) {
      const el = track.elements[i]
      if (!el.geometry || el.switchBranch) continue
      features.push({
        type: 'Feature',
        properties: { trackId: track.id, elementIndex: i },
        geometry: { type: 'LineString', coordinates: displayCoords(el, track.epsg) },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

export function buildMarkerFeatures(tracks) {
  const features = []
  for (const track of tracks) {
    for (let i = 0; i < (track.elements ?? []).length; i++) {
      const el = track.elements[i]
      if (!el.geometry || el.switchBranch) continue
      const coords = el.geometry.coordinates
      features.push({
        type: 'Feature',
        properties: { bearing: resolveEndBearing(el, track.epsg), trackId: track.id, elementIndex: i },
        geometry: { type: 'Point', coordinates: coords[coords.length - 1] },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}
