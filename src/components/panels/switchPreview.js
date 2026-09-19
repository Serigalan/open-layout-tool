import { ZOOM_LINE_WIDTH } from '../../utils/mapConstants'

export const SWITCH_LINES_SOURCE = 'switch-preview-lines-source'
export const SWITCH_LINES_LAYER  = 'switch-preview-lines-layer'
export const SWITCH_FILL_SOURCE  = 'switch-preview-fill-source'
export const SWITCH_FILL_LAYER   = 'switch-preview-fill-layer'

export const EMPTY_FC = { type: 'FeatureCollection', features: [] }

export function buildLinesGeoJSON({ straightCoords, arcCoords, lcsCoords }) {
  const features = [
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: straightCoords } },
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: arcCoords } },
  ]
  if (lcsCoords) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: lcsCoords } })
  return { type: 'FeatureCollection', features }
}

// The preview draws the switch's own body — the same ring the commit stores,
// so what is shown while placing a turnout is what ends up on the map.
export function buildFillGeoJSON({ fillCoords }) {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [fillCoords] },
    }],
  }
}

// The same for a crossing kind's geometry: the legs and slip curves as lines,
// the body as the pair of wedges between them — the same rings the commit
// stores, so a MultiPolygon.
export function buildCrossingPreview(g) {
  const lines = [g.mainCoords, g.crossCoords]
  if (g.slip1Coords) lines.push(g.slip1Coords)
  if (g.slip2Coords) lines.push(g.slip2Coords)
  return {
    lines: { type: 'FeatureCollection', features: lines.map(coordinates => ({
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates },
    })) },
    fill: { type: 'FeatureCollection', features: [{
      type: 'Feature', properties: {},
      geometry: { type: 'MultiPolygon', coordinates: g.fillCoords.map(r => [r]) },
    }] },
  }
}


// Layer definitions for usePreviewLayers (shared by both switch forms)
export const SWITCH_PREVIEW_LAYERS = [
  {
    sourceId: SWITCH_FILL_SOURCE,
    layer: { id: SWITCH_FILL_LAYER, type: 'fill', paint: { 'fill-color': '#5b9bd5', 'fill-opacity': 0.5 } },
  },
  {
    sourceId: SWITCH_LINES_SOURCE,
    layer: {
      id: SWITCH_LINES_LAYER, type: 'line',
      paint: { 'line-color': '#ff8c00', 'line-width': ZOOM_LINE_WIDTH, 'line-dasharray': [6, 4] },
    },
  },
]
