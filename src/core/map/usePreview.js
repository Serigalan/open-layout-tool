import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMap } from './MapContext'
import { GEOJSON_MAXZOOM } from '../utils/geometryPrecision'
import { FILTER_NONE, mapIsLive } from './pick'
import { EMPTY_FC, asGeoJSON } from './geojson'
import { highlightColors, resolveHighlight } from '../utils/mapColors'
import { getColor } from '../utils/mapRenderUtils'

// Which preview sources hold something now (R10.10): what the map legend reads.
const _shown = new Set()
const _listeners = new Set()
const notify = () => { for (const l of [..._listeners]) l() }
let _shownCount = 0
/** Whether any preview shows something on the map, and the subscription to it. */
export const previewShown = () => _shownCount > 0
export const subscribePreviews = (l) => { _listeners.add(l); return () => _listeners.delete(l) }
function markShown(sourceId, on) {
  const had = _shown.has(sourceId)
  if (on === had) return
  if (on) _shown.add(sourceId)
  else _shown.delete(sourceId)
  _shownCount = _shown.size
  notify()
}

/**
 * A panel's preview layers on the map (R3.2): added when the component mounts,
 * removed when it unmounts. `defs` is [{ sourceId, layer }] — `layer` a
 * MapLibre layer spec without `source` — and is read once, so define it at
 * module level. Layers are added in order and removed in reverse.
 *
 * Returns { set(sourceId, data), clear() }: `set` takes a Feature,
 * FeatureCollection, array of features or null (see asGeoJSON); `clear`
 * empties every source of the preview.
 *
 * On unmount it also resets the filters of `resetFilters` (layer ids the
 * panel borrowed, e.g. the hover layer) and the cursor if `resetCursor`.
 */
export default function usePreview(defs, { resetFilters = [], resetCursor = false } = {}) {
  const mapRef = useMap()
  const defsRef = useRef(defs)
  const optsRef = useRef({ resetFilters, resetCursor })

  useEffect(() => {
    const m = mapRef.current
    if (!m) return undefined
    const all = defsRef.current
    const opts = optsRef.current
    // The highlight colours as they stand against the project colour (R10.10).
    const colors = highlightColors(getColor())
    for (const { sourceId, layer } of all) {
      if (!m.getSource(sourceId)) m.addSource(sourceId, { type: 'geojson', data: EMPTY_FC, maxzoom: GEOJSON_MAXZOOM })
      const paint = layer.paint && Object.fromEntries(Object.entries(layer.paint).map(([k, v]) => [k, resolveHighlight(v, colors)]))
      if (!m.getLayer(layer.id)) m.addLayer({ ...layer, ...(paint ? { paint } : {}), source: sourceId })
    }
    return () => {
      for (const { sourceId } of all) markShown(sourceId, false)
      if (!mapIsLive(mapRef, m)) return
      for (const { sourceId, layer } of [...all].reverse()) {
        if (m.getLayer(layer.id)) m.removeLayer(layer.id)
        if (m.getSource(sourceId) && !all.some(d => d.sourceId === sourceId && m.getLayer(d.layer.id))) m.removeSource(sourceId)
      }
      for (const layerId of opts.resetFilters) if (m.getLayer(layerId)) m.setFilter(layerId, FILTER_NONE)
      if (opts.resetCursor) m.getCanvas().style.cursor = ''
    }
  }, [mapRef])

  const set = useCallback((sourceId, data) => {
    const geo = asGeoJSON(data)
    mapRef.current?.getSource(sourceId)?.setData(geo)
    markShown(sourceId, (geo.features?.length ?? (geo.type === 'Feature' ? 1 : 0)) > 0)
  }, [mapRef])

  const clear = useCallback(() => {
    for (const sourceId of new Set(defsRef.current.map(d => d.sourceId))) set(sourceId, null)
  }, [set])

  return useMemo(() => ({ set, clear }), [set, clear])
}
