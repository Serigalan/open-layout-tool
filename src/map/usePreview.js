import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMap } from './MapContext'
import { GEOJSON_MAXZOOM } from '../utils/geometryPrecision'
import { FILTER_NONE, mapIsLive } from './pick'
import { EMPTY_FC, asGeoJSON } from './geojson'

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
    for (const { sourceId, layer } of all) {
      if (!m.getSource(sourceId)) m.addSource(sourceId, { type: 'geojson', data: EMPTY_FC, maxzoom: GEOJSON_MAXZOOM })
      if (!m.getLayer(layer.id)) m.addLayer({ ...layer, source: sourceId })
    }
    return () => {
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
    mapRef.current?.getSource(sourceId)?.setData(asGeoJSON(data))
  }, [mapRef])

  const clear = useCallback(() => {
    for (const sourceId of new Set(defsRef.current.map(d => d.sourceId))) set(sourceId, null)
  }, [set])

  return useMemo(() => ({ set, clear }), [set, clear])
}
