// Map preview of the element edit: the edited elements and their end markers.
import { resolveEndBearing, displayCoords } from '../utils/elementUtils'

export const EDIT_MARKER_SOURCE = 'edit-length-markers-source'
export const EDIT_MARKER_LAYER  = 'edit-length-markers-layer'
export const EDIT_LINES_SOURCE  = 'edit-length-lines-source'
export const EDIT_LINES_LAYER   = 'edit-length-lines-layer'

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
