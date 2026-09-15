import { utmToWgs84 } from './coordinateUtils'
import { arcCoordsFromRadiusUtm } from './elementUtils'
import { computeClothoidUtm } from './clothoidUtils'
import { SAGITTA_ELEMENT, SAGITTA_TRACK } from './mapConstants'

/**
 * Derive the display geometry of elements from their plane data — startNode /
 * endNode in the track's CRS (`epsg`, one code per track) plus the design
 * scalars: geometry.coordinates (fine, SAGITTA_ELEMENT) and, for arcs and
 * transitions, renderCoords (coarse, SAGITTA_TRACK); straights carry none and
 * are densified for the map at render time (displayCoords). Used on every
 * project load, the tracks import and for optimizer results.
 * An element without nodes or CRS is returned as it is.
 */
export function reconstructElements(elements, epsg) {
  return (elements ?? []).map(el => {
    try {
      if (!el.startNode || !el.endNode || !epsg) return el
      const startUtm = { easting: el.startNode[0], northing: el.startNode[1], zone: epsg }
      const endUtm   = { easting: el.endNode[0],   northing: el.endNode[1],   zone: epsg }
      const startWgs = utmToWgs84(startUtm.easting, startUtm.northing, epsg)
      const endWgs   = utmToWgs84(endUtm.easting, endUtm.northing, epsg)
      if (el.radius) {
        const coords       = arcCoordsFromRadiusUtm(startUtm, endUtm, el.radius, SAGITTA_ELEMENT) ?? [startWgs, endWgs]
        const renderCoords = arcCoordsFromRadiusUtm(startUtm, endUtm, el.radius, SAGITTA_TRACK)   ?? [startWgs, endWgs]
        return { ...el, geometry: { type: 'LineString', coordinates: coords }, renderCoords }
      }
      if (el.elementType === 2 && el.r1 !== undefined) {
        const cl  = computeClothoidUtm(startUtm, el.bearing, el.length, el.r1, el.r2 ?? null, SAGITTA_ELEMENT, el.transitionType)
        const clR = computeClothoidUtm(startUtm, el.bearing, el.length, el.r1, el.r2 ?? null, SAGITTA_TRACK, el.transitionType)
        // The last vertex is the stored end node, so the join with the next
        // element is exact.
        return {
          ...el,
          geometry:     { type: 'LineString', coordinates: [...cl.coords.slice(0, -1), endWgs] },
          renderCoords: [...clR.coords.slice(0, -1), endWgs],
        }
      }
      return { ...el, geometry: { type: 'LineString', coordinates: [startWgs, endWgs] }, renderCoords: undefined }
    } catch {
      return el
    }
  })
}
