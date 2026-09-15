import { useEffect, useRef } from 'react'
import { FILTER_NONE, GEOJSON_MAXZOOM, mapIsLive } from '../utils/mapConstants'

const EMPTY_FC = { type: 'FeatureCollection', features: [] }

/**
 * Manages the lifecycle of map preview sources/layers for a panel component:
 * adds them when the component mounts, removes them when it unmounts.
 *
 * Replaces the setup/cleanup useEffect that was previously copy-pasted into
 * every panel. Updating the preview data is NOT handled here — panels keep
 * calling `map.current.getSource(id)?.setData(...)` as before.
 *
 * @param {object} map  React ref holding the MapLibre map instance.
 * @param {Array<{sourceId: string, layer: object}>} defs
 *        Layer definitions. `layer` is a MapLibre layer spec WITHOUT the
 *        `source` property (it is filled in automatically from `sourceId`).
 *        Layers are added in array order and removed in reverse order.
 *        IMPORTANT: define `defs` once at module level (outside the
 *        component) — it is read only on the first render.
 * @param {object} [opts] Extra cleanup steps on unmount:
 * @param {string[]} [opts.resetFilters] Layer ids whose filter is reset to
 *        FILTER_NONE (e.g. 'tracks-hover-layer', 'tracks-selected-layer').
 * @param {boolean} [opts.resetCursor] Reset the map cursor to default.
 */
export default function usePreviewLayers(map, defs, { resetFilters = [], resetCursor = false } = {}) {
  // Read once on purpose: defs/opts must be static (see doc comment above).
  const defsRef = useRef(defs)
  const optsRef = useRef({ resetFilters, resetCursor })

  useEffect(() => {
    if (!map?.current) return
    const m = map.current
    const defs = defsRef.current
    const opts = optsRef.current

    for (const { sourceId, layer } of defs) {
      if (!m.getSource(sourceId)) {
        m.addSource(sourceId, { type: 'geojson', data: EMPTY_FC, maxzoom: GEOJSON_MAXZOOM })
        m.addLayer({ ...layer, source: sourceId })
      }
    }

    return () => {
      if (!mapIsLive(map, m)) return
      for (const { sourceId, layer } of [...defs].reverse()) {
        if (m.getLayer(layer.id)) m.removeLayer(layer.id)
        if (m.getSource(sourceId)) m.removeSource(sourceId)
      }
      for (const layerId of opts.resetFilters) {
        m.setFilter(layerId, FILTER_NONE)
      }
      if (opts.resetCursor) m.getCanvas().style.cursor = ''
    }
  }, [map])
}
