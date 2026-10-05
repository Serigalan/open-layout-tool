import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAPS, updateElevationRange, onElevationRange } from '../basemaps'
import { updateLabels } from '../utils/labelUtils'
import { loadSettings, saveSettings } from '../utils/settings'

const DEFAULT_BASEMAP = 'liberty'
// Basemaps whose colours mean elevation: their terrain is reset on leaving
// them, and they get a legend.
export const ELEVATION_BASEMAPS = new Set(['elevation', 'dgm5'])
// MapLibre's own limit, for when tilting is allowed. Without it the map only
// turns in the plane: a pitch limit of 0 holds the right mouse button, the
// compass, the keyboard and two fingers alike to the bearing.
const MAX_PITCH = 60

/**
 * Allow tilting the map or not. Leaving 3D first eases the view back flat,
 * then closes the limit — setMaxPitch alone would jump.
 */
function applyTilt(m, on) {
  if (on) { m.setMaxPitch(MAX_PITCH); return }
  if (m.getPitch() === 0) { m.setMaxPitch(0); return }
  m.easeTo({ pitch: 0, duration: 300 })
  // Unless tilting was switched back on meanwhile.
  m.once('moveend', () => { if (!m.__oltTilt) m.setMaxPitch(0) })
}

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
 * elevationRange, tilt }: `map` the ref, `mapContainer` the ref callback for the
 * container element, `mapVersion` counting the maps made (a map made anew —
 * Strict Mode makes the first one twice — has none of what an effect drew on
 * the one before). `tilt` is { on, set, node }: whether the map may be tilted
 * into 3D (off by default, kept per browser) and the element in the map's
 * control corner its checkbox goes into (see TiltToggle).
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
  const [tiltOn, setTiltOn] = useState(() => loadSettings().mapTilt === true)
  const tiltRef = useRef(tiltOn)
  const [tiltNode, setTiltNode] = useState(null)

  const resizeRef = useRef(null)
  const mapContainer = useCallback((node) => {
    if (!node) {
      resizeRef.current?.disconnect()
      map.current?.remove()
      map.current = null
      setTiltNode(null)
      return
    }
    if (map.current) return
    const m = new maplibregl.Map({
      container: node,
      style: BASEMAPS.find(b => b.id === DEFAULT_BASEMAP).style,
      center: [10.0, 51.0],
      zoom: 5,
      maxPitch: tiltRef.current ? MAX_PITCH : 0,
    })
    m.__oltTilt = tiltRef.current
    map.current = m
    // The map follows its pane, not only the window: the sidebar folds out,
    // the panel is dragged wider (R10.7, R10.9).
    resizeRef.current = new ResizeObserver(() => m.resize())
    resizeRef.current.observe(node)
    // For browser checks in development: the map, to turn a track's
    // coordinates into a point on the screen.
    if (import.meta.env.DEV) window.__oltMap = m
    setActiveBasemap(DEFAULT_BASEMAP)
    setMapVersion(v => v + 1)
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true, showCompass: true }), 'top-right')
    // Below the compass, a place for the 3D checkbox; React fills it.
    const tiltBox = document.createElement('div')
    tiltBox.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    m.addControl({ onAdd: () => tiltBox, onRemove: () => tiltBox.remove() }, 'top-right')
    setTiltNode(tiltBox)
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

  const setTilt = useCallback((on) => {
    tiltRef.current = on
    setTiltOn(on)
    saveSettings({ mapTilt: on })
    const m = map.current
    if (!m) return
    m.__oltTilt = on
    applyTilt(m, on)
  }, [])
  const tilt = { on: tiltOn, set: setTilt, node: tiltNode }

  return { map, mapContainer, mapVersion, activeBasemap, setBasemap, elevationRange, tilt }
}
