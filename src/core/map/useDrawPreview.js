import { useCallback, useEffect, useMemo, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useMap } from './MapContext'
import usePreview from './usePreview'
import { getColor } from '../utils/mapRenderUtils'

const LINE_SOURCE   = 'draw-preview-line-source'
const LINE_LAYER    = 'draw-preview-line-layer'
const MARKER_SOURCE = 'draw-preview-markers-source'
const MARKER_LAYER  = 'draw-preview-markers-layer'

// Colours are the project's, read when the layer is made (when the form opens).
const DEFS = [
  {
    sourceId: LINE_SOURCE,
    layer: { id: LINE_LAYER, type: 'line', paint: { 'line-color': '#303383', 'line-width': 2, 'line-dasharray': [4, 3] } },
  },
  {
    sourceId: MARKER_SOURCE,
    layer: {
      id: MARKER_LAYER, type: 'circle',
      paint: { 'circle-radius': 5, 'circle-color': '#303383', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' },
    },
  },
]

/**
 * What a drawing form shows while the user places or drags (R3.2): a dashed
 * line with its measure in a small label, and the points it runs between.
 * Removed with the form.
 *
 * Returns { line(coords, label?), markers(coords), clear() } — WGS84 coords.
 */
export default function useDrawPreview() {
  const mapRef = useMap()
  const preview = usePreview(DEFS)
  const tooltip = useRef(null)

  // In the project's colour, which may have changed since the layers were defined.
  useEffect(() => {
    const m = mapRef.current
    if (m?.getLayer(LINE_LAYER)) m.setPaintProperty(LINE_LAYER, 'line-color', getColor())
    if (m?.getLayer(MARKER_LAYER)) m.setPaintProperty(MARKER_LAYER, 'circle-color', getColor())
  }, [mapRef])

  const dropTooltip = () => { tooltip.current?.remove(); tooltip.current = null }
  useEffect(() => dropTooltip, [])

  const line = useCallback((coords, label = '') => {
    preview.set(LINE_SOURCE, { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })
    dropTooltip()
    const m = mapRef.current
    if (!m || !label || coords.length < 2) return
    const i = Math.floor(coords.length / 2)
    const mid = coords.length % 2 === 1
      ? coords[i]
      : [(coords[i - 1][0] + coords[i][0]) / 2, (coords[i - 1][1] + coords[i][1]) / 2]
    tooltip.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'preview-tooltip', offset: 12, anchor: 'bottom' })
      .setLngLat(mid).setHTML(label).addTo(m)
  }, [preview, mapRef])

  const markers = useCallback((coords) => {
    preview.set(MARKER_SOURCE, coords.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })))
  }, [preview])

  const clear = useCallback(() => { preview.clear(); dropTooltip() }, [preview])

  return useMemo(() => ({ line, markers, clear }), [line, markers, clear])
}
