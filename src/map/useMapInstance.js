import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAPS, updateElevationRange, onElevationRange } from '../basemaps'
import { updateLabels } from '../utils/labelUtils'

const DEFAULT_BASEMAP = 'liberty'
// Basemaps whose colours mean elevation: their terrain is reset on leaving
// them, and they get a legend.
export const ELEVATION_BASEMAPS = new Set(['elevation', 'dgm5'])

/**
 * The MapLibre map of the app (R2.1): made when its container mounts, with
 * navigation and scale controls, the basemap it shows and the elevation range
 * an elevation basemap is coloured to.
 *
 * `onStyleLoad({ fit })` runs whenever a style has loaded — the first one
 * (`fit` true: the view goes to the project) and every basemap change after
 * it. setStyle throws everything drawn away, so this is where the caller puts
 * its layers back.
 *
 * Returns { map, mapContainer, mapVersion, activeBasemap, setBasemap,
 * elevationRange }: `map` the ref, `mapContainer` the ref callback for the
 * container element, `mapVersion` counting the maps made (a map made anew —
 * Strict Mode makes the first one twice — has none of what an effect drew on
 * the one before).
 */
export default function useMapInstance({ onStyleLoad }) {
  const map = useRef(null)
  const [mapVersion, setMapVersion] = useState(0)
  const [activeBasemap, setActiveBasemap] = useState(DEFAULT_BASEMAP)
  // [min, max] the elevation colour scale is fitted to — drives the legend.
  const [elevationRange, setElevationRange] = useState(null)
  const onStyleLoadRef = useRef(onStyleLoad)
  useEffect(() => { onStyleLoadRef.current = onStyleLoad })
  useEffect(() => { onElevationRange(setElevationRange) }, [])

  const mapContainer = useCallback((node) => {
    if (!node) {
      map.current?.remove()
      map.current = null
      return
    }
    if (map.current) return
    const m = new maplibregl.Map({
      container: node,
      style: BASEMAPS.find(b => b.id === DEFAULT_BASEMAP).style,
      center: [10.0, 51.0],
      zoom: 5,
    })
    map.current = m
    // For browser checks in development: the map, to turn a track's
    // coordinates into a point on the screen.
    if (import.meta.env.DEV) window.__oltMap = m
    setActiveBasemap(DEFAULT_BASEMAP)
    setMapVersion(v => v + 1)
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true, showCompass: true }), 'top-right')
    // The elevation layers colour the range that is on screen, so the scale is
    // re-fitted after every movement and once the DEM tiles have arrived.
    m.on('sourcedata', (e) => {
      if ((e.sourceId === 'terrainSource' || e.sourceId === 'dgm5Source') && e.isSourceLoaded) {
        updateElevationRange(m)
      }
    })
    m.on('moveend', () => updateElevationRange(m))
    m.on('move', () => updateLabels(m))
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right')
    m.once('style.load', () => onStyleLoadRef.current?.({ fit: true }))
  }, [])

  const setBasemap = useCallback((basemapId) => {
    const m = map.current
    if (!m || basemapId === activeBasemap) return
    const basemap = BASEMAPS.find((b) => b.id === basemapId)
    if (!basemap) { console.warn('[map] Unknown basemap:', basemapId); return }
    if (ELEVATION_BASEMAPS.has(activeBasemap)) {
      try { m.setTerrain(null) } catch (err) { console.warn('[map] Failed to reset terrain:', err) }
    }
    setActiveBasemap(basemapId)
    setElevationRange(null)   // the new style fits its own range
    try {
      m.setStyle(basemap.style)
      m.once('style.load', () => {
        // The new style's colour scale starts on its default range.
        updateElevationRange(m, { force: true })
        onStyleLoadRef.current?.({ fit: false })
      })
    } catch (err) {
      console.error('[map] Failed to set style for basemap:', basemapId, err)
    }
  }, [activeBasemap])

  return { map, mapContainer, mapVersion, activeBasemap, setBasemap, elevationRange }
}
