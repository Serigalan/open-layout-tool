import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { translations } from './locales/i18n'
import { BASEMAPS, updateElevationRange, onElevationRange } from './basemaps'
import { FILTER_NONE, ZOOM_LINE_WIDTH, ZOOM_LINE_WIDTH_HOVER, ZOOM_LINE_WIDTH_SELECTED, ZOOM_ICON_SIZE, GEOJSON_MAXZOOM } from './utils/mapConstants'
import { LayerIcon, PlaceIcon, SettingsIcon, InfoIcon, HomeIcon, DataExchangeIcon, EditElementIcon, ConnectElementIcon, ConnectSwitchIcon, ConnectCrossingIcon, SpliceElementIcon, OptimizeTrackIcon, UndoIcon, PlanExportIcon, ElevationIcon, PlatformIcon, CrossSectionIcon } from './components/icons'
import { loadTracks, loadSwitches, loadPlatforms, loadSettings, saveSettings, canUndo, undo } from './storage'
import { resolveEndBearing, displayCoords } from './utils/elementUtils'
import { getColor, PLATFORM_FILL_COLOR, PLATFORM_FILL_OPACITY, PLATFORM_OUTLINE_COLOR } from './utils/mapRenderUtils'
import { updateLabels, clearTrackLabels, createTrackLabel, SWITCH_LABEL_MIN_ZOOM } from './utils/labelUtils'
import { ensureMarkerImages, TRACK_MARKER_ICON_IMAGE } from './utils/markerImages'
import { showKmOverlays } from './utils/kmLineLayer'
import { ensureKmLines } from './utils/kmLineSource'
import useKmLineHover from './hooks/useKmLineHover'
import StartPage from './components/StartPage'
import LayersPanel from './components/panels/LayersPanel'
import CreateElementPanel from './components/panels/CreateElementPanel'
import SettingsPanel from './components/panels/SettingsPanel'
import InfoPanel from './components/panels/InfoPanel'
import DataExchangePanel from './components/panels/DataExchangePanel'
import EditElementPanel from './components/panels/EditElementPanel'
import ConnectElementPanel from './components/panels/ConnectElementPanel'
import ConnectSwitchPanel from './components/panels/ConnectSwitchPanel'
import ConnectCrossingPanel from './components/panels/ConnectCrossingPanel'
import SpliceElementPanel from './components/panels/SpliceElementPanel'
import OptimizeTrackPanel from './components/panels/OptimizeTrackPanel'
import PlanExportPanel from './components/panels/PlanExportPanel'
import ElevationPanel from './components/panels/ElevationPanel'
import PlatformPanel from './components/panels/PlatformPanel'
import CrossSectionPanel from './components/panels/CrossSectionPanel'
import TrackTableOverlay from './components/TrackTableOverlay'
import PlanPreviewOverlay from './components/PlanPreviewOverlay'
import ElevationOverlay from './components/ElevationOverlay'
import CrossSectionOverlay from './components/CrossSectionOverlay'
import { fillMissingHeights } from './utils/elevationFill'
import ElevationLegend from './components/ElevationLegend'
import './App.css'

// Basemaps whose colours mean elevation, and which therefore get a legend.
const ELEVATION_BASEMAPS = new Set(['elevation', 'dgm5'])

function updateMapColors(map, color) {
  if (!map) return
  const c = color ?? getColor()
  if (map.getLayer('tracks-layer'))         map.setPaintProperty('tracks-layer',         'line-color', c)
  if (map.getLayer('switch-fills-layer'))   map.setPaintProperty('switch-fills-layer',   'fill-color', c)
  if (map.getLayer('tracks-markers-layer')) map.setPaintProperty('tracks-markers-layer', 'icon-color', c)
}

/**
 * How a turnout's bauform is named: EW/SS for the unbent form, IBW and ABW for
 * the two bent ones — the bent forms are drawing abbreviations in either
 * language, only the unbent one has a word behind it. The plan export writes
 * the same, from the same locale keys.
 */
const bauformCode = (tr, form) => tr(`switch_code_${form ?? 'plain'}`)

/**
 * What a switch element states about itself: the radius of its own route, the
 * branch's or the through route's stem. The length is the switch form's and
 * cannot be edited, so it is not stated — the circle at the element end says
 * so. Records from before the routes were told apart fall back on their shape:
 * on an unbent switch the through route is the straight one.
 */
function switchElementLabel(tr, el) {
  const route = el.switchRoute ?? (el.radius == null ? 'main' : 'branch')
  const sub   = tr(route === 'main' ? 'switch_r_sub_main' : 'switch_r_sub_branch')
  const r     = (v) => (v == null ? '∞' : `${Math.round(Math.abs(v) * 100) / 100} m`)
  // A route of a turnout laid into a clothoid is a clothoid itself: it has no
  // single radius but runs from one to the other.
  const value = el.elementType === 2 ? `${r(el.r1)} → ${r(el.r2)}` : r(el.radius)
  return [{ t: 'r' }, { t: sub, sub: true }, { t: ` = ${value}` }]
}

function renderTracksOnMap(map, project, { fit = false } = {}) {
  if (!map || !project) return
  const tracks = loadTracks(project.id)
  // Labels are language-dependent and this runs outside the component tree, so
  // the language comes from the settings the app writes it to.
  const lang = loadSettings().language ?? 'en'
  const tr = (key) => translations[lang]?.[key] ?? key
  const switches = loadSwitches(project.id)
  // The switch an element belongs to, so its radius label knows which side of
  // its own line the turnout body fills and can go to the other one. Keyed by
  // id; a record still carrying only a name is reachable under that, which is
  // what an element written before the id has to go on.
  const switchById   = Object.fromEntries(switches.filter(sw => sw.switchId).map(sw => [sw.switchId, sw]))
  const switchByName = Object.fromEntries(switches.filter(sw => sw.name).map(sw => [sw.name, sw]))
  const switchOf     = (el) => switchById[el.switchId] ?? switchByName[el.switchName] ?? null

  const lineFeatures = []
  const pointFeatures = []
  const allCoords = []

  // Remove old labels
  clearTrackLabels()

  tracks.forEach((track) => {
    (track.elements ?? []).forEach((el, elIdx) => {
      if (!el.geometry) return
      lineFeatures.push({
        type: 'Feature', id: track.id,
        properties: {
          trackId: track.id, elementIndex: elIdx,
          switchBranch: el.switchBranch ?? false, switchId: el.switchId ?? '',
        },
        geometry: { type: 'LineString', coordinates: displayCoords(el, track.epsg) },
      })
      const coords = el.geometry.coordinates
      const start = coords[0]
      const end = coords[coords.length - 1]

      const startBearing = el.bearing ?? 0
      const endBearing = resolveEndBearing(el, track.epsg)

      pointFeatures.push({ type: 'Feature', properties: { markerType: 'start', bearing: startBearing }, geometry: { type: 'Point', coordinates: start } })
      pointFeatures.push({ type: 'Feature', properties: { markerType: el.switchBranch ? 'switch-end' : 'end', bearing: endBearing }, geometry: { type: 'Point', coordinates: end } })
      allCoords.push(start, end)
      // Display formatting only — stored values keep their full precision.
      const fmt = (v) => String(Math.round(v * 100) / 100)
      const labelCoords = el.renderCoords ?? coords
      if (el.switchBranch) {
        createTrackLabel(map, labelCoords, switchElementLabel(tr, el),
          { avoid: switchOf(el)?.bodyCentre ?? null })
      } else if (el.length) {
        let labelText
        if (el.radius != null) {
          labelText = `r = ${fmt(Math.abs(el.radius))}m | l = ${fmt(el.length)}m`
        } else if (el.elementType === 2) {
          const subscript = el.transitionType === 'bloss' ? 'ub' : 'u'
          labelText = [{ t: 'l' }, { t: subscript, sub: true }, { t: ` = ${fmt(el.length)}m` }]
        } else {
          labelText = `l = ${fmt(el.length)}m`
        }
        createTrackLabel(map, labelCoords, labelText)
      }
    })
  })

  const lineGeoJSON  = { type: 'FeatureCollection', features: lineFeatures }
  const pointGeoJSON = { type: 'FeatureCollection', features: pointFeatures }

  const switchFillFeatures = switches
    .filter(sw => sw.fillCoords)
    .map(sw => ({
      type: 'Feature',
      // The body is what a dialog picks a switch by (EditElementPanel/
      // DeleteSwitchForm) — it is the one part of the map that is the switch
      // itself rather than one of its routes.
      properties: { switchId: sw.switchId ?? '' },
      // A crossing's body is two wedges, a pair of rings where a turnout's
      // body is one.
      geometry: Array.isArray(sw.fillCoords[0][0])
        ? { type: 'MultiPolygon', coordinates: sw.fillCoords.map(r => [r]) }
        : { type: 'Polygon', coordinates: [sw.fillCoords] },
    }))
  const switchFillGeoJSON = { type: 'FeatureCollection', features: switchFillFeatures }

  const switchLcsFeatures = switches
    .filter(sw => sw.lcsCoords)
    .map(sw => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: sw.lcsCoords },
    }))
  const switchLcsGeoJSON = { type: 'FeatureCollection', features: switchLcsFeatures }

  // The turnout's designation, set beside the body rather than on either route
  // — those carry their own radius. It goes at a higher zoom than the rest: it
  // belongs to no element, so nothing hides it once it stops being legible.
  switches.forEach((sw) => {
    if (!sw.labelCoords || !sw.label) return
    createTrackLabel(map, sw.labelCoords, `${bauformCode(tr, sw.bauform)} ${sw.label}`,
      { minZoom: SWITCH_LABEL_MIN_ZOOM, avoid: sw.bodyCentre ?? null })
  })

  // Platforms are polygons derived from their track (see platformUtils); one
  // whose track is gone carries no polygon and is left out.
  const platformGeoJSON = {
    type: 'FeatureCollection',
    features: loadPlatforms(project.id)
      .filter(p => (p.coords?.length ?? 0) > 3)
      .map(p => ({
        type: 'Feature',
        properties: { platformId: p.id },
        geometry: { type: 'Polygon', coordinates: [p.coords] },
      })),
  }

  if (map.getSource('tracks-source')) {
    map.getSource('tracks-source').setData(lineGeoJSON)
    map.getSource('tracks-markers-source').setData(pointGeoJSON)
    map.getSource('switch-fills-source')?.setData(switchFillGeoJSON)
    map.getSource('switch-lcs-source')?.setData(switchLcsGeoJSON)
    map.getSource('platforms-source')?.setData(platformGeoJSON)
  } else {
    const c = getColor()
    // Added before the track layers so the tracks stay drawn on top of them.
    map.addSource('platforms-source', { type: 'geojson', data: platformGeoJSON, maxzoom: GEOJSON_MAXZOOM })
    map.addLayer({
      id: 'platforms-fill-layer',
      type: 'fill',
      source: 'platforms-source',
      paint: { 'fill-color': PLATFORM_FILL_COLOR, 'fill-opacity': PLATFORM_FILL_OPACITY },
    })
    map.addLayer({
      id: 'platforms-outline-layer',
      type: 'line',
      source: 'platforms-source',
      paint: { 'line-color': PLATFORM_OUTLINE_COLOR, 'line-width': 1.2 },
    })
    map.addSource('tracks-source', { type: 'geojson', data: lineGeoJSON, maxzoom: GEOJSON_MAXZOOM })
    map.addLayer({
      id: 'tracks-layer',
      type: 'line',
      source: 'tracks-source',
      paint: {
        'line-color': c,
        'line-width': ZOOM_LINE_WIDTH,
      },
    })
    map.addSource('tracks-markers-source', { type: 'geojson', data: pointGeoJSON, maxzoom: GEOJSON_MAXZOOM })
    map.addSource('switch-fills-source', { type: 'geojson', data: switchFillGeoJSON, maxzoom: GEOJSON_MAXZOOM })
    map.addLayer({
      id: 'switch-fills-layer',
      type: 'fill',
      source: 'switch-fills-source',
      paint: { 'fill-color': c, 'fill-opacity': 0.9 },
    })
    map.addSource('switch-lcs-source', { type: 'geojson', data: switchLcsGeoJSON, maxzoom: GEOJSON_MAXZOOM })
    map.addLayer({
      id: 'switch-lcs-layer',
      type: 'line',
      source: 'switch-lcs-source',
      paint: { 'line-color': c, 'line-width': ZOOM_LINE_WIDTH, 'line-opacity': 0.7 },
    })

    ensureMarkerImages(map)

    map.addLayer({
      id: 'tracks-markers-layer',
      type: 'symbol',
      source: 'tracks-markers-source',
      layout: {
        'icon-image': TRACK_MARKER_ICON_IMAGE,
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-size': ZOOM_ICON_SIZE,
      },
      paint: { 'icon-color': c },
    })
    map.addLayer({
      id: 'tracks-hover-layer',
      type: 'line',
      source: 'tracks-source',
      filter: FILTER_NONE,
      paint: {
        'line-color': '#ff8c00',
        'line-width': ZOOM_LINE_WIDTH_HOVER,
        'line-opacity': 0.7,
      },
    })
    map.addLayer({
      id: 'tracks-selected-layer',
      type: 'line',
      source: 'tracks-source',
      filter: FILTER_NONE,
      paint: {
        'line-color': '#a52a1f',
        'line-width': ZOOM_LINE_WIDTH_SELECTED,
      },
    })
  }

  updateLabels(map)
  map.once('idle', () => updateLabels(map))

  if (fit && allCoords.length > 0) {
    const bounds = allCoords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(allCoords[0], allCoords[0])
    )
    map.fitBounds(bounds, { padding: 80, maxZoom: 16 })
  }
}


function PanelContent({ view, activeBasemap, onBasemapChange, kmOverlays, onKmOverlayChange, kmLinesError, language, onLanguageChange, color, onColorChange, t, map, project, onTrackSaved, onShowTrackTable, onProjectImported, profileTrackId, onShowProfile, onShowPlanPreview, crossSectionAt, onShowCrossSection }) {
  if (view === 'layers')   return <LayersPanel activeBasemap={activeBasemap} onBasemapChange={onBasemapChange} kmOverlays={kmOverlays} onKmOverlayChange={onKmOverlayChange} kmLinesError={kmLinesError} t={t} />
  if (view === 'places')   return <CreateElementPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} />
  if (view === 'settings') return <SettingsPanel language={language} onLanguageChange={onLanguageChange} color={color} onColorChange={onColorChange} t={t} />
  if (view === 'edit')     return <EditElementPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} onShowTrackTable={onShowTrackTable} />
  if (view === 'connect') return <ConnectElementPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} />
  if (view === 'connect_switch') return <ConnectSwitchPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} />
  if (view === 'connect_crossing') return <ConnectCrossingPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} />
  if (view === 'splice') return <SpliceElementPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} />
  if (view === 'optimize') return <OptimizeTrackPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} />
  if (view === 'data')     return <DataExchangePanel t={t} map={map} project={project} onProjectImported={onProjectImported} onTrackSaved={onTrackSaved} />
  if (view === 'plan')     return <PlanExportPanel t={t} project={project} language={language} onShowPlanPreview={onShowPlanPreview} />
  if (view === 'elevation') return <ElevationPanel t={t} project={project} profileTrackId={profileTrackId} onShowProfile={onShowProfile} onTrackSaved={onTrackSaved} />
  if (view === 'platform') return <PlatformPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} />
  if (view === 'cross_section') return <CrossSectionPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} crossSectionAt={crossSectionAt} onShowCrossSection={onShowCrossSection} />
  if (view === 'info')     return <InfoPanel t={t} />
  return null
}


export default function App() {
  const map = useRef(null)
  const projectRef = useRef(null)
  const [view, setView] = useState('start')
  const [activeView, setActiveView] = useState('info')
  const [language, setLanguage] = useState(() => loadSettings().language ?? 'en')
  const [color, setColor] = useState(() => loadSettings().color ?? '#303383')
  const [activeBasemap, setActiveBasemap] = useState('liberty')
  // DB kilometrage overlays — the DB network, and what lies outside it — each
  // on or off, and whether their tile archive turned out to be missing (a
  // deploy without the data folder).
  const [kmOverlays, setKmOverlayState] = useState(() => {
    const s = loadSettings()
    return { db: s.kmLines ?? true, other: s.kmLinesOther ?? false }
  })
  const [kmLinesError, setKmLinesError] = useState(false)
  const [project, setProject] = useState(null)
  const [trackTable, setTrackTable] = useState(null)
  const [profileTrackId, setProfileTrackId] = useState(null)   // track shown in the profile overlay
  const [planPreview, setPlanPreview] = useState(null)         // { plan, filenameBase } shown as a sheet preview
  const [crossSectionAt, setCrossSectionAt] = useState(null)   // { trackId, elIdx } drawn in the cross-section overlay
  // Bumped after every write of height points, so the profile re-reads them.
  const [heightsVersion, setHeightsVersion] = useState(0)
  // [min, max] the elevation colour scale is fitted to — drives the legend.
  const [elevationRange, setElevationRange] = useState(null)
  const [undoAvailable, setUndoAvailable] = useState(false)

  useEffect(() => {
    const s = loadSettings()
    document.documentElement.style.setProperty('--color-primary', s.color ?? '#303383')
  }, [])

  useEffect(() => {
    if (map.current?.isStyleLoaded()) updateMapColors(map.current, color)
  }, [color])

  // setStyle throws the whole style away, so the overlays have to be put back
  // on every style that loads; the ref is what those callbacks read.
  const kmOverlaysRef = useRef(kmOverlays)
  const restoreKmLines = useCallback(() => {
    if (!map.current) return
    showKmOverlays(map.current, kmOverlaysRef.current, {
      beforeId: 'platforms-fill-layer',
      onError: () => setKmLinesError(true),
    })
  }, [])

  const handleKmOverlayChange = useCallback((key, on) => {
    const next = { ...kmOverlaysRef.current, [key]: on }
    kmOverlaysRef.current = next
    setKmOverlayState(next)
    saveSettings({ kmLines: next.db, kmLinesOther: next.other })
    if (on) setKmLinesError(false)
    // Not loaded yet: the style.load handler will pick it up.
    if (map.current?.isStyleLoaded()) restoreKmLines()
  }, [restoreKmLines])

  const handleUndoRef = useRef(null)
  useEffect(() => { projectRef.current = project }, [project])
  useEffect(() => { onElevationRange(setElevationRange) }, [])
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndoRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!map.current?.getLayer('tracks-hover-layer')) return
    map.current.setFilter('tracks-hover-layer', trackTable
      ? ['==', ['get', 'trackId'], trackTable.id]
      : FILTER_NONE)
  }, [trackTable])

  const t = useCallback((key) => translations[language]?.[key] ?? key, [language])

  useKmLineHover(map, kmOverlays.db || kmOverlays.other, t)

  const mapContainer = useCallback((node) => {
    if (!node) {
      map.current?.remove()
      map.current = null
      return
    }
    if (map.current) return
    map.current = new maplibregl.Map({
      container: node,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [10.0, 51.0],
      zoom: 5,
    })
    map.current.addControl(
      new maplibregl.NavigationControl({
        visualizePitch: true,
        showZoom: true,
        showCompass: true,
      }),
      'top-right'
    )
    // The elevation layers colour the range that is on screen, so the scale is
    // re-fitted after every movement and once the DEM tiles have arrived.
    map.current.on('sourcedata', (e) => {
      if ((e.sourceId === 'terrainSource' || e.sourceId === 'dgm5Source') && e.isSourceLoaded) {
        updateElevationRange(map.current)
      }
    })
    map.current.on('moveend', () => updateElevationRange(map.current))
    map.current.on('move', () => updateLabels(map.current))
    map.current.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right')
    map.current.once('style.load', () => {
      if (projectRef.current) {
        renderTracksOnMap(map.current, projectRef.current, { fit: true })
      }
      restoreKmLines()
    })
  }, [restoreKmLines])

  // Elements that have no height points yet get them from the terrain in the
  // background — after every change, and once when a project is opened.
  const fillHeights = useCallback((projectId) => {
    fillMissingHeights(projectId).then(r => { if (r.updated) setHeightsVersion(v => v + 1) })
  }, [])
  useEffect(() => { if (project) fillHeights(project.id) }, [project, fillHeights])

  // The kilometrage lines the tracks name are fetched the same way: in the
  // background, after every change and once on opening. Nothing on screen
  // waits for them — they are read when a plan is drawn.
  const syncKmLines = useCallback((projectId) => {
    ensureKmLines(projectId)
      .then(({ errors }) => {
        if (errors.length) console.warn('[App] Kilometrage lines unavailable:', errors)
      })
      .catch(err => console.warn('[App] Kilometrage lines:', err))
  }, [])
  useEffect(() => { if (project) syncKmLines(project.id) }, [project, syncKmLines])

  // Element and switch labels are language-dependent, so a language change has
  // to redraw them.
  useEffect(() => {
    if (map.current && projectRef.current) renderTracksOnMap(map.current, projectRef.current)
  }, [language])

  const handleTrackSaved = () => {
    if (map.current && project) renderTracksOnMap(map.current, project)
    setUndoAvailable(canUndo())
    setHeightsVersion(v => v + 1)
    if (project) {
      fillHeights(project.id)
      syncKmLines(project.id)
    }
  }

  const handleUndo = useCallback(() => {
    if (!undo()) return
    setUndoAvailable(canUndo())
    setHeightsVersion(v => v + 1)   // an undone height edit must leave the profile too
    if (map.current && projectRef.current) {
      renderTracksOnMap(map.current, projectRef.current)
    }
  }, [])
  // The map's keyboard shortcut reads the handler through a ref, so the listener
  // (registered once) always calls the current one.
  useEffect(() => { handleUndoRef.current = handleUndo }, [handleUndo])

  const handleProjectImported = () => {
    setProject(null)
    setView('start')
  }

  const handleLanguageChange = (lang) => {
    setLanguage(lang)
    saveSettings({ language: lang })
  }

  const handleColorChange = (c) => {
    setColor(c)
    document.documentElement.style.setProperty('--color-primary', c)
    saveSettings({ color: c })
  }

  const handleBasemapChange = (basemapId) => {
    if (basemapId === activeBasemap) return
    const basemap = BASEMAPS.find((b) => b.id === basemapId)
    if (!basemap) { console.warn('[App] Unknown basemap:', basemapId); return }

    console.log('[App] Switching basemap:', activeBasemap, '→', basemapId)

    if (activeBasemap === 'elevation' || activeBasemap === 'dgm5') {
      try { map.current.setTerrain(null) } catch (err) {
        console.warn('[App] Failed to reset terrain:', err)
      }
    }

    setActiveBasemap(basemapId)
    setElevationRange(null)   // the new style fits its own range
    try {
      map.current.setStyle(basemap.style)
      map.current.once('style.load', () => {
        console.log('[App] Style loaded for:', basemapId)
        // The new style's colour scale starts on its default range.
        updateElevationRange(map.current, { force: true })
        renderTracksOnMap(map.current, project)
        restoreKmLines()
      })
    } catch (err) {
      console.error('[App] Failed to set style for basemap:', basemapId, err)
    }
  }

  const handleIconClick = (panel) => {
    const next = activeView === panel ? null : panel
    setActiveView(next)
    // The track table is opened from the edit panel and belongs to it; the
    // profile overlay likewise to the elevation panel.
    if (next !== 'edit') setTrackTable(null)
    if (next !== 'elevation') setProfileTrackId(null)
    if (next !== 'plan') setPlanPreview(null)
  }

  if (view === 'start') {
    return <StartPage onOpenProject={(p) => { setProject(p); setView('map') }} t={t} language={language} onLanguageChange={handleLanguageChange} />
  }

  return (
    <div className="layout">
      <aside className="sidebar-primary">
        <div className="sidebar-top">
          <button
            className={`sidebar-icon-btn ${activeView === 'layers' ? 'active' : ''}`}
            onClick={() => handleIconClick('layers')}
            title={t('tooltip_layers')}
          >
            <LayerIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'places' ? 'active' : ''}`}
            onClick={() => handleIconClick('places')}
            title={t('create_element')}
          >
            <PlaceIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'connect' ? 'active' : ''}`}
            onClick={() => handleIconClick('connect')}
            title={t('connect_element')}
          >
            <ConnectElementIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'connect_switch' ? 'active' : ''}`}
            onClick={() => handleIconClick('connect_switch')}
            title={t('connect_switch')}
          >
            <ConnectSwitchIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'connect_crossing' ? 'active' : ''}`}
            onClick={() => handleIconClick('connect_crossing')}
            title={t('connect_crossing')}
          >
            <ConnectCrossingIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'splice' ? 'active' : ''}`}
            onClick={() => handleIconClick('splice')}
            title={t('splice_element')}
          >
            <SpliceElementIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'optimize' ? 'active' : ''}`}
            onClick={() => handleIconClick('optimize')}
            title={t('optimize_track')}
          >
            <OptimizeTrackIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'edit' ? 'active' : ''}`}
            onClick={() => handleIconClick('edit')}
            title={t('edit')}
          >
            <EditElementIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'elevation' ? 'active' : ''}`}
            onClick={() => handleIconClick('elevation')}
            title={t('tooltip_elevation')}
          >
            <ElevationIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'platform' ? 'active' : ''}`}
            onClick={() => handleIconClick('platform')}
            title={t('platform_title')}
          >
            <PlatformIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'cross_section' ? 'active' : ''}`}
            onClick={() => handleIconClick('cross_section')}
            title={t('cross_section_title')}
          >
            <CrossSectionIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'data' ? 'active' : ''}`}
            onClick={() => handleIconClick('data')}
            title={t('data_exchange')}
          >
            <DataExchangeIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'plan' ? 'active' : ''}`}
            onClick={() => handleIconClick('plan')}
            title={t('plan_title')}
          >
            <PlanExportIcon />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className="sidebar-icon-btn"
            onClick={handleUndo}
            disabled={!undoAvailable}
            title={t('tooltip_undo')}
            style={{ opacity: undoAvailable ? 1 : 0.35 }}
          >
            <UndoIcon />
          </button>
          <button
            className="sidebar-icon-btn"
            onClick={() => setView('start')}
            title={t('tooltip_home')}
          >
            <HomeIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'info' ? 'active' : ''}`}
            onClick={() => handleIconClick('info')}
            title={t('info')}
          >
            <InfoIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'settings' ? 'active' : ''}`}
            onClick={() => handleIconClick('settings')}
            title={t('settings')}
          >
            <SettingsIcon />
          </button>
        </div>
      </aside>

      {activeView !== null && (
        <aside className="sidebar-secondary">
          <PanelContent
            view={activeView}
            activeBasemap={activeBasemap}
            onBasemapChange={handleBasemapChange}
            kmOverlays={kmOverlays}
            onKmOverlayChange={handleKmOverlayChange}
            kmLinesError={kmLinesError}
            language={language}
            onLanguageChange={handleLanguageChange}
            color={color}
            onColorChange={handleColorChange}
            t={t}
            map={map}
            project={project}
            onTrackSaved={handleTrackSaved}
            onShowTrackTable={setTrackTable}
            onProjectImported={handleProjectImported}
            profileTrackId={profileTrackId}
            onShowProfile={setProfileTrackId}
            onShowPlanPreview={setPlanPreview}
            crossSectionAt={crossSectionAt}
            onShowCrossSection={setCrossSectionAt}
          />
        </aside>
      )}

      <div style={{ flex: 1, position: 'relative' }}>
        <div className="map-container" ref={mapContainer} style={{ position: 'absolute', inset: 0 }} />
        {ELEVATION_BASEMAPS.has(activeBasemap) && <ElevationLegend range={elevationRange} t={t} />}
        {trackTable && <TrackTableOverlay track={trackTable} project={project} map={map} onClose={() => setTrackTable(null)} onSaved={handleTrackSaved} t={t} />}
        {profileTrackId && <ElevationOverlay trackId={profileTrackId} project={project} map={map} version={heightsVersion} onClose={() => setProfileTrackId(null)} onSaved={handleTrackSaved} t={t} />}
        {crossSectionAt && <CrossSectionOverlay at={crossSectionAt} project={project} onClose={() => setCrossSectionAt(null)} t={t} />}
        {planPreview && <PlanPreviewOverlay plan={planPreview.plan} filenameBase={planPreview.filenameBase} onClose={() => setPlanPreview(null)} t={t} />}
      </div>
    </div>
  )
}
