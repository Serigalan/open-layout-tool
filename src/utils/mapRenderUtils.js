import maplibregl from 'maplibre-gl'
import { GEOJSON_MAXZOOM } from './mapConstants'

export function getColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#303383'
}

/** Solid grey a platform is filled with, and the darker grey of its outline. */
export const PLATFORM_FILL_COLOR    = '#8c8c8c'
export const PLATFORM_FILL_OPACITY  = 0.85
export const PLATFORM_OUTLINE_COLOR = '#5a5a5a'

const LINE_SOURCE   = 'straight-line-source'
const LINE_LAYER    = 'straight-line-layer'
const MARKER_SOURCE = 'straight-line-markers'
const MARKER_LAYER  = 'straight-line-marker-layer'

let _previewTooltip = null

export function setLineData(map, coords, label = '') {
  const lineGeojson = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }

  if (map.getSource(LINE_SOURCE)) {
    map.getSource(LINE_SOURCE).setData(lineGeojson)
  } else {
    map.addSource(LINE_SOURCE, { type: 'geojson', data: lineGeojson, maxzoom: GEOJSON_MAXZOOM })
    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: LINE_SOURCE,
      paint: { 'line-color': getColor(), 'line-width': 2, 'line-dasharray': [4, 3] },
    })
  }

  // Update label tooltip
  if (_previewTooltip) { _previewTooltip.remove(); _previewTooltip = null }
  if (label && coords.length >= 2) {
    const midIdx = Math.floor(coords.length / 2)
    const mid = coords.length % 2 === 1
      ? coords[midIdx]
      : [(coords[midIdx - 1][0] + coords[midIdx][0]) / 2, (coords[midIdx - 1][1] + coords[midIdx][1]) / 2]

    _previewTooltip = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'preview-tooltip',
      offset: 12,
      anchor: 'bottom',
    })
      .setLngLat(mid)
      .setHTML(label)
      .addTo(map)
  }
}

export function setMarkerData(map, coords) {
  const geojson = {
    type: 'FeatureCollection',
    features: coords.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c } })),
  }
  if (map.getSource(MARKER_SOURCE)) {
    map.getSource(MARKER_SOURCE).setData(geojson)
  } else {
    map.addSource(MARKER_SOURCE, { type: 'geojson', data: geojson, maxzoom: GEOJSON_MAXZOOM })
    map.addLayer({
      id: MARKER_LAYER,
      type: 'circle',
      source: MARKER_SOURCE,
      paint: {
        'circle-radius': 5,
        'circle-color': getColor(),
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    })
  }
}

/**
 * Zoom the map to a set of tracks — used after an import, where the new tracks
 * are usually nowhere near the current viewport. Tracks without a rendered
 * polyline contribute nothing; with no coordinates at all the view is left alone.
 */
export function fitToTracks(map, tracks, options = {}) {
  if (!map) return
  const coords = (tracks ?? []).flatMap(track => track.coordinates ?? [])
  if (coords.length === 0) return
  const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
  map.fitBounds(bounds, { padding: 80, maxZoom: 16, ...options })
}

export function clearPreview(map) {
  if (!map) return
  if (map.getSource(LINE_SOURCE)) {
    map.getSource(LINE_SOURCE).setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } })
  }
  if (_previewTooltip) { _previewTooltip.remove(); _previewTooltip = null }
  if (map.getSource(MARKER_SOURCE)) {
    map.getSource(MARKER_SOURCE).setData({ type: 'FeatureCollection', features: [] })
  }
}
