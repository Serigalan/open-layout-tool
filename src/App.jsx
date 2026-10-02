import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { translations } from './locales/i18n'
import { BASEMAPS, updateElevationRange, onElevationRange } from './basemaps'
import { FILTER_NONE, ZOOM_LINE_WIDTH, ZOOM_LINE_WIDTH_HOVER, ZOOM_LINE_WIDTH_SELECTED, ZOOM_LINE_WIDTH_BUFFER_STOP, ZOOM_ICON_SIZE, MARKER_MIN_ZOOM, GEOJSON_MAXZOOM } from './utils/mapConstants'
import ConfirmModal from './components/ConfirmModal'
import { LayerIcon, TopologyIcon, PlaceIcon, SettingsIcon, InfoIcon, HomeIcon, DataExchangeIcon, EditElementIcon, ConnectSwitchIcon, SpliceElementIcon, StationIcon, UndoIcon, PlanExportIcon, ElevationIcon } from './components/icons'
import { loadTracks, loadSwitches, loadPlatforms, loadEndMarks, canUndo, undo, currentProject, closeWorkingCopy, currentWorkingCopy, flushPendingWrites, saveKmLine, deleteKmLine } from './storage'
import { loadSettings, saveSettings } from './utils/settings'
import { api, setUnauthorizedHandler } from './api/client'
import { adoptUpdate, checkIn, localChanges, openVariant, prepareUpdate, serverHead } from './utils/workingCopySync'
import { commitVariantMerge, loadComparison, prepareVariantMerge } from './utils/variantMerge'
import { clearFeatures, comparisonFeatures, drawable, recordFeatures, showFeaturesSoon, zoomToFeatures } from './utils/compareLayer'
import { diffEntries, diffProject } from './utils/merge'
import { fill } from './components/collab/mergeText'
import { bufferStopFeatures } from './utils/bufferStopGeometry'
import { showTopology, highlightTopology, zoomToTopologyTracks } from './utils/topologyLayer'
import { selectionHighlight } from './utils/topologyGraph'
import { resolveEndBearing, displayCoords } from './utils/elementUtils'
import { getColor, PLATFORM_FILL_COLOR, PLATFORM_FILL_OPACITY, PLATFORM_OUTLINE_COLOR } from './utils/mapRenderUtils'
import { updateLabels, clearTrackLabels, createTrackLabel, SWITCH_LABEL_MIN_ZOOM } from './utils/labelUtils'
import { ensureMarkerImages, TRACK_MARKER_ICON_IMAGE } from './utils/markerImages'
import { showKmOverlays } from './utils/kmLineLayer'
import { ensureKmLines } from './utils/kmLineSource'
import useKmLineHover from './hooks/useKmLineHover'
import StartPage from './components/StartPage'
import LayersPanel from './components/panels/LayersPanel'
import TopologyPanel from './components/panels/TopologyPanel'
import TopologyGraphOverlay from './components/TopologyGraphOverlay'
import CreateConnectPanel from './components/panels/CreateConnectPanel'
import ConnectSwitchPanel from './components/panels/ConnectSwitchPanel'
import SpliceOptimizePanel from './components/panels/SpliceOptimizePanel'
import ElevationPanel from './components/panels/ElevationPanel'
import PlatformCrossSectionPanel from './components/panels/PlatformCrossSectionPanel'
import EditElementPanel from './components/panels/EditElementPanel'
import SettingsPanel from './components/panels/SettingsPanel'
import InfoPanel from './components/panels/InfoPanel'
import DataExchangePanel from './components/panels/DataExchangePanel'
import PlanExportPanel from './components/panels/PlanExportPanel'
import TrackTableOverlay from './components/TrackTableOverlay'
import PhysicsOverlay from './components/PhysicsOverlay'
import RegelwerkOverlay from './components/RegelwerkOverlay'
import PlanPreviewOverlay from './components/PlanPreviewOverlay'
import ElevationOverlay from './components/ElevationOverlay'
import CrossSectionOverlay from './components/CrossSectionOverlay'
import ElevationLegend from './components/ElevationLegend'
import CompareOverlay from './components/collab/CompareOverlay'
import ConflictDialog from './components/collab/ConflictDialog'
import CheckInDialog from './components/collab/CheckInDialog'
import LoginPage from './components/collab/LoginPage'
import PasswordForm from './components/collab/PasswordForm'
import WorkingCopyBar from './components/collab/WorkingCopyBar'
import AdminPage from './components/collab/AdminPage'
import HistoryPage from './components/collab/HistoryPage'
import './App.css'
import { isProjectUndo } from './utils/keyboard'

// How often the open app asks whether the server has moved on [ms].
const SERVER_POLL = 2 * 60 * 1000

// Basemaps whose colours mean elevation, and which therefore get a legend.
const ELEVATION_BASEMAPS = new Set(['elevation', 'dgm5'])

function updateMapColors(map, color) {
  if (!map) return
  const c = color ?? getColor()
  if (map.getLayer('tracks-layer'))         map.setPaintProperty('tracks-layer',         'line-color', c)
  if (map.getLayer('switch-fills-layer'))   map.setPaintProperty('switch-fills-layer',   'fill-color', c)
  if (map.getLayer('tracks-markers-layer')) map.setPaintProperty('tracks-markers-layer', 'icon-color', c)
  if (map.getLayer('buffer-stops-layer'))   map.setPaintProperty('buffer-stops-layer',   'line-color', c)
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

function renderTracksOnMap(map, project, { fit = false, topology = false } = {}) {
  if (!map || !project) return
  const tracks = loadTracks()
  // Labels are language-dependent and this runs outside the component tree, so
  // the language comes from the settings the app writes it to.
  const lang = loadSettings().language ?? 'en'
  const tr = (key) => translations[lang]?.[key] ?? key
  const switches = loadSwitches()
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
    features: loadPlatforms()
      .filter(p => (p.coords?.length ?? 0) > 3)
      .map(p => ({
        type: 'Feature',
        properties: { platformId: p.id },
        geometry: { type: 'Polygon', coordinates: [p.coords] },
      })),
  }

  // Buffer stops stand on track ends (trackEndMarks): face and body solid and
  // heavier than the track, the brake length behind them dashed — white gaps
  // laid over the track line, which is already drawn there.
  const bufferStopGeoJSON = { type: 'FeatureCollection', features: bufferStopFeatures(tracks, loadEndMarks()) }

  if (map.getSource('tracks-source')) {
    map.getSource('tracks-source').setData(lineGeoJSON)
    map.getSource('buffer-stops-source')?.setData(bufferStopGeoJSON)
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
    map.addSource('buffer-stops-source', { type: 'geojson', data: bufferStopGeoJSON, maxzoom: GEOJSON_MAXZOOM })
    map.addLayer({
      id: 'buffer-stops-brake-layer',
      type: 'line',
      source: 'buffer-stops-source',
      filter: ['==', ['get', 'part'], 'brake'],
      paint: { 'line-color': '#ffffff', 'line-width': ZOOM_LINE_WIDTH, 'line-dasharray': [1.5, 1.5] },
    })
    map.addLayer({
      id: 'buffer-stops-layer',
      type: 'line',
      source: 'buffer-stops-source',
      filter: ['!=', ['get', 'part'], 'brake'],
      paint: { 'line-color': c, 'line-width': ZOOM_LINE_WIDTH_BUFFER_STOP },
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
      minzoom: MARKER_MIN_ZOOM,
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

  // The topology view shows the connections and nothing else (AP 9.3): no
  // labels, and its own layers in place of the detailed ones.
  if (topology) clearTrackLabels()
  showTopology(map, { on: topology, tracks, switches, endMarks: loadEndMarks(), color: getColor() })

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


function PanelContent({ onShowCompare, view, activeBasemap, onBasemapChange, kmOverlays, onKmOverlayChange, kmLinesError, marksVersion, topologySelection, onTopologySelect, topologyGraphOpen, onShowTopologyGraph, language, onLanguageChange, color, onColorChange, t, map, project, onTrackSaved, trackTableId, onShowTrackTable, onShowPhysics, onShowRegelwerk, onCloseConstraints, profileTrackId, onShowProfile, onShowPlanPreview, crossSectionAt, onShowCrossSection }) {
  if (view === 'layers')   return <LayersPanel activeBasemap={activeBasemap} onBasemapChange={onBasemapChange} kmOverlays={kmOverlays} onKmOverlayChange={onKmOverlayChange} kmLinesError={kmLinesError} t={t} />
  if (view === 'topology') return <TopologyPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} version={marksVersion}
    selection={topologySelection} onSelect={onTopologySelect} graphOpen={topologyGraphOpen} onShowGraph={onShowTopologyGraph} />
  if (view === 'places')   return <CreateConnectPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} />
  if (view === 'settings') return <SettingsPanel language={language} onLanguageChange={onLanguageChange} color={color} onColorChange={onColorChange} t={t} />
  if (view === 'edit')     return <EditElementPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} trackTableId={trackTableId} onShowTrackTable={onShowTrackTable} onShowPhysics={onShowPhysics} onShowRegelwerk={onShowRegelwerk} onCloseConstraints={onCloseConstraints} />
  if (view === 'connect_switch') return <ConnectSwitchPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} />
  if (view === 'splice') return <SpliceOptimizePanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} onShowRegelwerk={onShowRegelwerk} />
  if (view === 'elevation') return <ElevationPanel t={t} map={map} project={project} profileTrackId={profileTrackId} onShowProfile={onShowProfile} onTrackSaved={onTrackSaved} />
  if (view === 'platform') return <PlatformCrossSectionPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} crossSectionAt={crossSectionAt} onShowCrossSection={onShowCrossSection} />
  if (view === 'data')     return <DataExchangePanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} onShowCompare={onShowCompare} />
  if (view === 'plan')     return <PlanExportPanel t={t} project={project} language={language} onShowPlanPreview={onShowPlanPreview} />
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
  // The topology view (AP 9.3) is on while its panel is open (AP 9.5): a way of
  // looking, not a setting of the project. The ref is what the map callbacks
  // read. The basemap the view replaced with Liberty is kept to go back to.
  const topologyRef = useRef(false)
  const basemapBeforeTopology = useRef(null)
  // What is picked in the topology view: { kind: 'switch'|'track', id } or null.
  const [topologySelection, setTopologySelection] = useState(null)
  const [topologyGraphOpen, setTopologyGraphOpen] = useState(false)
  const [project, setProject] = useState(null)
  const [trackTable, setTrackTable] = useState(null)
  // The element a map click picked when the table was opened — the table
  // starts framed on it already, so it skips the fly-to that a list pick
  // still gets, which has no such clue where the track sits.
  const [trackTableInitialRow, setTrackTableInitialRow] = useState(null)
  // Whether the element table holds edits nobody has written yet, and what to
  // do once the user has said the word on losing them.
  const [tableDirty, setTableDirty] = useState(false)
  const [discardAsk, setDiscardAsk] = useState(null)   // () => void, the way on
  // Bumped whenever the store is moved under an open overlay — an undo does
  // that — so it can re-read instead of writing its own stale copy back out.
  const [storeVersion, setStoreVersion] = useState(0)
  // Bumped after every write and every undo, for the lists that only read the
  // store (the open track ends under the topology view). Not storeVersion:
  // that one tells an open element table its data moved under it, which a
  // write the table made itself must not.
  const [marksVersion, setMarksVersion] = useState(0)
  const [profileTrackId, setProfileTrackId] = useState(null)   // track shown in the profile overlay
  const [planPreview, setPlanPreview] = useState(null)         // { plan, filenameBase } shown as a sheet preview
  const [crossSectionAt, setCrossSectionAt] = useState(null)   // { trackId, station } drawn in the cross-section overlay
  // The two constraints popups — physics (a flag, it takes no argument) and
  // the regelwerk ({ regelwerkId }, '' meaning "the one the service names
  // first"). Both read-only, so unlike the element table they have nothing to
  // lose and close without asking.
  const [physicsOpen, setPhysicsOpen] = useState(false)
  const [regelwerkOverlay, setRegelwerkOverlay] = useState(null)
  // Bumped after every write of height points, so the profile re-reads them.
  const [heightsVersion, setHeightsVersion] = useState(0)
  // [min, max] the elevation colour scale is fitted to — drives the legend.
  const [elevationRange, setElevationRange] = useState(null)
  const [undoAvailable, setUndoAvailable] = useState(false)
  // Two states over each other (AP 10.3): { before, after, beforeLabel, afterLabel, drawUnchanged }.
  const [compare, setCompare] = useState(null)
  // Who is signed in (AP 10.6): status 'loading' | 'anon' | 'user'.
  const [session, setSession] = useState({ status: 'loading', user: null })
  // The open working copy: the server's project and variant it belongs to.
  const [wc, setWc] = useState(null)
  // Its state against the server: local changes, and the head when it moved on.
  const [wcChanges, setWcChanges] = useState([])
  const [wcHead, setWcHead] = useState(null)
  // Check in / update: { kind: 'checkin', errors } | { kind: 'merge', prepared, then } | null.
  const [syncDialog, setSyncDialog] = useState(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncNote, setSyncNote] = useState(null)
  // Read-only on the map, without a working copy (AP 10.8, 10.10): two states
  // compared, or a merge of one variant into another being decided —
  // { kind: 'compare', title, subtitle, before, after, beforeLabel, afterLabel }
  // | { kind: 'merge', title, subtitle, prepared, sourceName, targetName }.
  const [viewer, setViewer] = useState(null)
  // Counts the maps made: a map made anew (Strict Mode makes the first one
  // twice) has none of what an effect drew on the one before.
  const [mapVersion, setMapVersion] = useState(0)
  const [homeNote, setHomeNote] = useState(null)
  // Whose history is shown (AP 10.10): { project, variant }.
  const [historyFor, setHistoryFor] = useState(null)

  useEffect(() => {
    const s = loadSettings()
    document.documentElement.style.setProperty('--color-primary', s.color ?? '#303383')
  }, [])

  useEffect(() => {
    if (map.current?.isStyleLoaded()) updateMapColors(map.current, color)
    // The topology symbols carry the colour too.
    if (topologyRef.current && map.current && projectRef.current) {
      renderTracksOnMap(map.current, projectRef.current, { topology: true })
    }
  }, [color])

  const topology = activeView === 'topology'
  useEffect(() => {
    topologyRef.current = topology
    // Drawn as soon as the tracks are on the map — not on isStyleLoaded(),
    // which stays false while any tile is still loading and so skipped the
    // switch on the first open. A style still coming in (the change to
    // Liberty) draws it from its own style.load, through the ref.
    if (map.current?.getLayer('tracks-layer') && projectRef.current) {
      renderTracksOnMap(map.current, projectRef.current, { topology })
    }
  }, [topology])

  // A switch or track picked in the topology view (on the map or in the
  // diagram): a switch with the tracks it connects, a track with the switches
  // it runs into, highlighted.
  useEffect(() => {
    const switches = projectRef.current ? loadSwitches() : []
    highlightTopology(map.current, selectionHighlight(topologySelection, switches))
  }, [topologySelection])

  // A pick in the diagram also takes the map to what it highlights: a switch's
  // tracks, or the track itself.
  const pickInTopologyDiagram = useCallback((selection) => {
    setTopologySelection(selection)
    const p = projectRef.current
    if (!selection || !p) return
    const { trackIds } = selectionHighlight(selection, loadSwitches())
    zoomToTopologyTracks(map.current, loadTracks().filter(tr => trackIds.includes(tr.id)))
  }, [])

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
      if (isProjectUndo(e)) {
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

  // Signed in or not: the app opens nothing without a session (decision 88).
  useEffect(() => {
    setUnauthorizedHandler(() => setSession({ status: 'anon', user: null }))
    api.me()
      .then(({ user }) => setSession({ status: 'user', user }))
      .catch(() => setSession({ status: 'anon', user: null }))
  }, [])

  // The working copy's own changes, after every write and undo.
  useEffect(() => {
    setWcChanges(wc ? localChanges() : [])
  }, [wc, marksVersion, storeVersion])

  // Whether the server has moved on: on opening, every few minutes, and when
  // the tab comes back.
  useEffect(() => {
    if (!wc) return undefined
    let alive = true
    const check = () => serverHead(wc.variant.id)
      .then(head => { if (alive) setWcHead(head) })
      .catch(() => {})
    check()
    const timer = setInterval(check, SERVER_POLL)
    const onFocus = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onFocus)
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onFocus) }
  }, [wc])

  // A merge being decided shows on the map what it brings into the target:
  // the target as it is, pale, and the changes coloured as in a comparison.
  // A revision looked at on its own is drawn whole.
  useEffect(() => {
    if (viewer?.kind !== 'merge' && viewer?.kind !== 'view') return undefined
    const m = map.current
    if (!m) return undefined
    let features
    if (viewer.kind === 'view') {
      features = recordFeatures(drawable(viewer.record))
    } else {
      const { target } = viewer.prepared
      const merged = viewer.prepared.result.merged
      features = comparisonFeatures(drawable(target.payload), drawable(merged),
        diffEntries(diffProject(target.payload, merged)), { unchanged: true })
    }
    const stop = showFeaturesSoon(m, 'merge-preview', features)
    zoomToFeatures(m, features, { maxZoom: 15, covered: viewer.kind === 'view' ? 0 : 0.62 })
    return () => { stop(); try { clearFeatures(m, 'merge-preview') } catch { /* map gone */ } }
  }, [viewer, mapVersion])

  // Leaving the tab with changes not checked in is asked about by the browser.
  useEffect(() => {
    if (!wcChanges.length) return undefined
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [wcChanges.length])

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
    setMapVersion(v => v + 1)
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
        renderTracksOnMap(map.current, projectRef.current, { fit: true, topology: topologyRef.current })
      }
      restoreKmLines()
    })
  }, [restoreKmLines])

  // The kilometrage lines the tracks name are fetched the same way: in the
  // background, after every change and once on opening. Nothing on screen
  // waits for them — they are read when a plan is drawn.
  const syncKmLines = useCallback(() => {
    const asked = currentProject()
    ensureKmLines(asked)
      .then(({ save, remove, errors }) => {
        // Another project may have been opened while the lines were fetched.
        if (currentProject()?.id !== asked?.id) return
        for (const lineNumber of remove) deleteKmLine(lineNumber)
        for (const line of save) saveKmLine(line)
        if (errors.length) console.warn('[App] Kilometrage lines unavailable:', errors)
      })
      .catch(err => console.warn('[App] Kilometrage lines:', err))
  }, [])
  useEffect(() => { if (project) syncKmLines() }, [project, syncKmLines])

  // Element and switch labels are language-dependent, so a language change has
  // to redraw them.
  useEffect(() => {
    if (map.current && projectRef.current) renderTracksOnMap(map.current, projectRef.current, { topology: topologyRef.current })
  }, [language])

  const handleTrackSaved = () => {
    if (map.current && project) renderTracksOnMap(map.current, project, { topology: topologyRef.current })
    setMarksVersion(v => v + 1)
    setUndoAvailable(canUndo())
    setHeightsVersion(v => v + 1)
    // The gradient is not read from the terrain behind the user's back: a
    // track has one when it is stated, or read on request in the profile.
    if (project) syncKmLines(project.id)
  }

  const handleUndo = useCallback(() => {
    if (!undo()) return
    setUndoAvailable(canUndo())
    setStoreVersion(v => v + 1)   // whatever is open on it reads the store again
    setMarksVersion(v => v + 1)
    setHeightsVersion(v => v + 1)   // an undone height edit must leave the profile too
    if (map.current && projectRef.current) {
      renderTracksOnMap(map.current, projectRef.current, { topology: topologyRef.current })
    }
  }, [])
  // The map's keyboard shortcut reads the handler through a ref, so the listener
  // (registered once) always calls the current one.
  useEffect(() => { handleUndoRef.current = handleUndo }, [handleUndo])

  /** The store was replaced under the app (a merge adopted): read it again. */
  const reloadFromStore = useCallback(() => {
    const p = currentProject()
    projectRef.current = p
    setProject(p)
    setUndoAvailable(canUndo())
    setStoreVersion(v => v + 1)
    setMarksVersion(v => v + 1)
    setHeightsVersion(v => v + 1)
    setTrackTable(null)
    if (map.current && p) renderTracksOnMap(map.current, p, { topology: topologyRef.current })
  }, [])

  const handleOpenVariant = async (serverProject, variant) => {
    setHomeNote(null)
    const p = await openVariant(variant.id)
    setWc({ project: serverProject, variant })
    setWcHead(null)
    setSyncNote(null)
    setUndoAvailable(false)
    setProject(p)
    setView('map')
  }

  // A template only its admin edits: everyone else looks at its head, read-only.
  const viewVariant = async (serverProject, variant) => {
    setHomeNote(null)
    const { payload, revision } = await api.head(variant.id)
    setViewer({
      kind: 'view', title: serverProject.title, record: payload,
      subtitle: `${variant.name} · ${fill(t, 'wc_rev', { n: revision.number })}`,
    })
    setView('viewer')
  }

  const goHome = async () => {
    setCompare(null)
    setSyncDialog(null)
    // The next project opens on the info panel, not on whatever this one had open.
    if (activeView === 'topology' && basemapBeforeTopology.current) {
      handleBasemapChange(basemapBeforeTopology.current)
      basemapBeforeTopology.current = null
    }
    setActiveView('info')
    setTopologyGraphOpen(false)
    setTopologySelection(null)
    await closeWorkingCopy()
    setWc(null)
    setProject(null)
    setView('start')
  }

  // ── comparing and merging variants (AP 10.8) ──
  const showComparison = async (serverProject, a, b) => {
    setHomeNote(null)
    const { before, after } = await loadComparison(a.id, b.id)
    setViewer({
      kind: 'compare', title: serverProject.title, subtitle: t('compare_title'),
      before: before.payload, after: after.payload,
      beforeLabel: `${a.name} · ${fill(t, 'wc_rev', { n: before.revision.number })}`,
      afterLabel: `${b.name} · ${fill(t, 'wc_rev', { n: after.revision.number })}`,
    })
    setView('viewer')
  }

  const startVariantMerge = async (serverProject, source, target) => {
    setHomeNote(null)
    const prepared = await prepareVariantMerge(source.id, target.id)
    if (prepared.upToDate) return 'up_to_date'
    setViewer({
      kind: 'merge', title: serverProject.title, prepared, sourceName: source.name, targetName: target.name,
      subtitle: fill(t, 'compare_from_to', { before: source.name, after: target.name }),
    })
    setView('viewer')
    return 'shown'
  }

  const applyVariantMerge = async (record) => {
    setSyncBusy(true)
    try {
      const res = await commitVariantMerge(viewer.prepared, record,
        fill(t, 'merge_message', { source: viewer.sourceName, target: viewer.targetName }))
      setHomeNote(res.stale
        ? t('merge_target_moved')
        : fill(t, 'merge_done', { source: viewer.sourceName, target: viewer.targetName, n: res.revision.number }))
      closeViewer()
    } catch (err) {
      setHomeNote(err.body?.errors?.length ? t('checkin_refused') : t('collab_err_generic'))
      closeViewer()
    } finally {
      setSyncBusy(false)
    }
  }

  const closeViewer = () => {
    setView(viewer?.back ?? 'start')
    setViewer(null)
  }

  // ── history (AP 10.10) ──
  const showHistory = (serverProject, variant) => {
    setHomeNote(null)
    setHistoryFor({ project: serverProject, variant })
    setView('history')
  }

  const viewRevision = async (rev) => {
    const { payload } = await api.revision(rev.id)
    setViewer({
      kind: 'view', back: 'history', title: historyFor.project.title, record: payload,
      subtitle: `${historyFor.variant.name} · ${fill(t, 'wc_rev', { n: rev.number })}`,
    })
    setView('viewer')
  }

  const compareWithHead = async (rev, head) => {
    const [before, after] = await Promise.all([api.revision(rev.id), api.revision(head.id)])
    setViewer({
      kind: 'compare', back: 'history', title: historyFor.project.title, subtitle: t('compare_title'),
      before: before.payload, after: after.payload,
      beforeLabel: fill(t, 'wc_rev', { n: rev.number }),
      afterLabel: `${fill(t, 'wc_rev', { n: head.number })} (${t('history_head')})`,
    })
    setView('viewer')
  }

  const handleSignOut = async () => {
    await flushPendingWrites()
    try { await api.logout() } catch { /* the session is gone either way */ }
    setSession({ status: 'anon', user: null })
    setView('start')
  }

  // ── check in and update (AP 10.6) ──
  const wcBase = wc ? currentWorkingCopy()?.base ?? null : null
  const serverNewer = Boolean(wcHead && wcBase && wcHead.id !== wcBase.id)

  /**
   * Merge the server's head into the working copy and show the result; `then`
   * runs once the user took it over (checking in again, after a stale base).
   */
  const startUpdate = async (then = null) => {
    setSyncBusy(true)
    setSyncNote(null)
    try {
      const prepared = await prepareUpdate()
      if (!prepared) {
        setSyncNote(t('wc_up_to_date'))
        if (then) await then()
        return
      }
      setSyncDialog({ kind: 'merge', prepared, then })
    } catch {
      setSyncNote(t('collab_err_generic'))
    } finally {
      setSyncBusy(false)
    }
  }

  const applyMerge = async (record) => {
    const { prepared, then } = syncDialog
    adoptUpdate(prepared, record)
    setWcHead(prepared.head)
    setSyncDialog(null)
    reloadFromStore()
    if (then) await then()
  }

  const submitCheckIn = async (message) => {
    setSyncBusy(true)
    try {
      const res = await checkIn(message)
      if (res.stale) {
        // Someone checked in first: merge their head in, then try again.
        setSyncDialog(null)
        setSyncBusy(false)
        await startUpdate(() => submitCheckIn(message))
        return
      }
      setSyncDialog(null)
      setWcHead(res.revision)
      setWcChanges(localChanges())
      setSyncNote(t('wc_checked_in'))
    } catch (err) {
      setSyncDialog({ kind: 'checkin', errors: err.body?.errors ?? [] })
      if (!err.body?.errors) setSyncNote(t('collab_err_generic'))
    } finally {
      setSyncBusy(false)
    }
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
        // The new style's colour scale starts on its default range.
        updateElevationRange(map.current, { force: true })
        renderTracksOnMap(map.current, project, { topology: topologyRef.current })
        restoreKmLines()
      })
    } catch (err) {
      console.error('[App] Failed to set style for basemap:', basemapId, err)
    }
  }

  /**
   * Closing the element table is the one step that can lose work: nothing it
   * holds is written until Save. Every way out goes through here — its own ✕,
   * the panel's back button, another icon, the way back to the start page — so
   * the question is asked once, in one place, and only when there is something
   * to lose.
   */
  const closeTrackTable = useCallback((proceed) => {
    if (!trackTable || !tableDirty) { proceed(); return }
    setDiscardAsk(() => proceed)
  }, [trackTable, tableDirty])

  const handleIconClick = (panel) => {
    const next = activeView === panel ? null : panel
    // The topology view is drawn over a pale Liberty; whatever basemap was up
    // comes back when the view is left.
    if (next === 'topology' && activeView !== 'topology' && activeBasemap !== 'liberty') {
      basemapBeforeTopology.current = activeBasemap
    }
    // The track table is opened from the edit panel and belongs to it; the
    // profile overlay likewise to the elevation panel.
    const go = () => {
      setActiveView(next)
      // Reachable from more than one panel (edit and optimize for the
      // regelwerk; edit alone for physics), so they belong to neither — any
      // switch closes them rather than leaving one over a panel that did not
      // open it.
      setPhysicsOpen(false)
      setRegelwerkOverlay(null)
      if (next !== 'edit') setTrackTable(null)
      if (next !== 'elevation') setProfileTrackId(null)
      if (next !== 'plan') setPlanPreview(null)
      if (next !== 'platform') setCrossSectionAt(null)
      if (next === 'topology' && activeBasemap !== 'liberty') handleBasemapChange('liberty')
      // The diagram comes up with the view, every time it is opened; the
      // selection belongs to the view and goes with it.
      setTopologyGraphOpen(next === 'topology')
      if (next !== 'topology') setTopologySelection(null)
      if (next !== 'topology' && activeView === 'topology' && basemapBeforeTopology.current) {
        handleBasemapChange(basemapBeforeTopology.current)
        basemapBeforeTopology.current = null
      }
    }
    if (next !== 'edit') closeTrackTable(go); else go()
  }

  // Picking another track keeps the edits — they are the table's, not one
  // track's — so only closing it (null) has to be asked about.
  const handleShowPhysics = useCallback(() => {
    setRegelwerkOverlay(null)   // only one of the two is ever meant to be up
    setPhysicsOpen(true)
  }, [])

  const handleShowRegelwerk = useCallback((regelwerkId = '') => {
    setPhysicsOpen(false)       // only one of the two is ever meant to be up
    setRegelwerkOverlay({ regelwerkId })
  }, [])

  // Now that the popup only covers the map pane (not the panel that opened
  // it), the edit panel's own submenu buttons stay reachable while one is up
  // — this is what they call to close it on their way to a different page.
  const handleCloseConstraints = useCallback(() => {
    setPhysicsOpen(false)
    setRegelwerkOverlay(null)
  }, [])

  const handleShowTrackTable = useCallback((tr, row) => {
    if (tr) { setTrackTable(tr); setTrackTableInitialRow(row ?? null) }
    else closeTrackTable(() => setTrackTable(null))
  }, [closeTrackTable])

  if (session.status === 'loading') return <div className="collab-page collab-center"><p className="collab-muted">{t('home_loading')}</p></div>
  if (session.status === 'anon') {
    return <LoginPage t={t} language={language} onLanguageChange={handleLanguageChange}
      onSignedIn={(user) => { setSession({ status: 'user', user }); setView('start') }} />
  }
  if (session.user.mustChangePassword) {
    return (
      <div className="collab-page collab-center">
        <PasswordForm forced t={t} onDone={(user) => setSession({ status: 'user', user })} />
      </div>
    )
  }
  if (view === 'history' && historyFor) {
    return <HistoryPage project={historyFor.project} variant={historyFor.variant} t={t} language={language}
      onBack={() => setView('start')} onView={viewRevision} onCompareWithHead={compareWithHead} />
  }
  if (view === 'admin' && session.user.role === 'admin') {
    return <AdminPage user={session.user} onBack={() => setView('start')} t={t} language={language} />
  }
  if (view === 'viewer' && viewer) {
    return (
      <div className="layout">
        <div style={{ flex: 1, position: 'relative' }}>
          <div className="map-container" ref={mapContainer} style={{ position: 'absolute', inset: 0 }} />
          <div className="wc-bar" role="status">
            <span className="wc-where">
              <strong>{viewer.title}</strong>
              <span className="wc-sep">›</span>
              <span>{viewer.subtitle}</span>
            </span>
            <span className="wc-rev">{t('viewer_readonly')}</span>
            <span className="wc-actions">
              <button type="button" className="wc-btn" onClick={closeViewer} disabled={syncBusy}>{t('viewer_back')}</button>
            </span>
          </div>
          {viewer.kind === 'compare' && (
            <CompareOverlay map={map} mapVersion={mapVersion} t={t} before={viewer.before} after={viewer.after} drawUnchanged
              beforeLabel={viewer.beforeLabel} afterLabel={viewer.afterLabel} onClose={closeViewer} />
          )}
          {viewer.kind === 'merge' && (
            <ConflictDialog map={map} mapVersion={mapVersion} t={t} result={viewer.prepared.result} busy={syncBusy}
              title={t('home_merge_title')} mineLabel={viewer.targetName} theirsLabel={viewer.sourceName}
              onCancel={closeViewer} onApply={applyVariantMerge} />
          )}
        </div>
      </div>
    )
  }
  if (view === 'start' || !project) {
    return <StartPage user={session.user} onOpenVariant={handleOpenVariant} onViewVariant={viewVariant} onSignOut={handleSignOut}
      onCompare={showComparison} onMerge={startVariantMerge} note={homeNote}
      onAdmin={() => { setHomeNote(null); setView('admin') }} onHistory={showHistory}
      t={t} language={language} onLanguageChange={handleLanguageChange} />
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
            className={`sidebar-icon-btn ${activeView === 'topology' ? 'active' : ''}`}
            onClick={() => handleIconClick('topology')}
            title={t('topology_title')}
          >
            <TopologyIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'places' ? 'active' : ''}`}
            onClick={() => handleIconClick('places')}
            title={t('create_element')}
          >
            <PlaceIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'connect_switch' ? 'active' : ''}`}
            onClick={() => handleIconClick('connect_switch')}
            title={t('connect_switch')}
          >
            <ConnectSwitchIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'splice' ? 'active' : ''}`}
            onClick={() => handleIconClick('splice')}
            title={t('splice_element')}
          >
            <SpliceElementIcon />
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
            title={t('platform_cross_section')}
          >
            <StationIcon />
          </button>
          <button
            className={`sidebar-icon-btn ${activeView === 'edit' ? 'active' : ''}`}
            onClick={() => handleIconClick('edit')}
            title={t('edit')}
          >
            <EditElementIcon />
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
            onClick={() => closeTrackTable(goHome)}
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
            marksVersion={marksVersion}
            topologySelection={topologySelection}
            onTopologySelect={setTopologySelection}
            topologyGraphOpen={topologyGraphOpen}
            onShowTopologyGraph={setTopologyGraphOpen}
            language={language}
            onLanguageChange={handleLanguageChange}
            color={color}
            onColorChange={handleColorChange}
            t={t}
            map={map}
            project={project}
            onTrackSaved={handleTrackSaved}
            trackTableId={trackTable?.id}
            onShowTrackTable={handleShowTrackTable}
            onShowPhysics={handleShowPhysics}
            onShowRegelwerk={handleShowRegelwerk}
            onCloseConstraints={handleCloseConstraints}
            profileTrackId={profileTrackId}
            onShowProfile={setProfileTrackId}
            onShowPlanPreview={setPlanPreview}
            crossSectionAt={crossSectionAt}
            onShowCrossSection={setCrossSectionAt}
            onShowCompare={setCompare}
          />
        </aside>
      )}

      <div style={{ flex: 1, position: 'relative' }}>
        <div className="map-container" ref={mapContainer} style={{ position: 'absolute', inset: 0 }} />
        {wc && (
          <WorkingCopyBar t={t} projectTitle={wc.project.title} variantName={wc.variant.name} base={wcBase}
            changes={wcChanges.length} serverNewer={serverNewer} busy={syncBusy}
            onCheckIn={() => setSyncDialog({ kind: 'checkin', errors: [] })}
            onUpdate={() => startUpdate()}
            onShowChanges={() => setCompare({
              before: currentWorkingCopy().basePayload, after: currentWorkingCopy().project,
              beforeLabel: `${wc.variant.name} · ${t('wc_base')}`, afterLabel: t('wc_working_copy'),
            })} />
        )}
        {syncNote && <button type="button" className="wc-note" onClick={() => setSyncNote(null)}>{syncNote}</button>}
        {ELEVATION_BASEMAPS.has(activeBasemap) && <ElevationLegend range={elevationRange} t={t} />}
        {trackTable && <TrackTableOverlay track={trackTable} project={project} map={map}
          storeVersion={storeVersion} initialRow={trackTableInitialRow} onPickTrack={setTrackTable} onDirtyChange={setTableDirty}
          onClose={() => closeTrackTable(() => setTrackTable(null))} onSaved={handleTrackSaved} t={t} />}
        {profileTrackId && <ElevationOverlay trackId={profileTrackId} project={project} map={map} version={heightsVersion} onClose={() => setProfileTrackId(null)} onSaved={handleTrackSaved} t={t} />}
        {crossSectionAt && <CrossSectionOverlay at={crossSectionAt} project={project} map={map}
          onAtChange={setCrossSectionAt} onClose={() => setCrossSectionAt(null)} t={t} />}
        {physicsOpen && <PhysicsOverlay t={t} onClose={() => setPhysicsOpen(false)} />}
        {regelwerkOverlay && <RegelwerkOverlay t={t} regelwerkId={regelwerkOverlay.regelwerkId}
          onClose={() => setRegelwerkOverlay(null)} />}
        {topologyGraphOpen && topology && <TopologyGraphOverlay project={project} version={marksVersion}
          selection={topologySelection} onSelect={pickInTopologyDiagram}
          onDeleted={() => { setTopologySelection(null); handleTrackSaved() }}
          onClose={() => setTopologyGraphOpen(false)} t={t} />}
        {compare && <CompareOverlay map={map} mapVersion={mapVersion} t={t} {...compare} onClose={() => setCompare(null)} />}
        {syncDialog?.kind === 'merge' && (
          <ConflictDialog map={map} mapVersion={mapVersion} t={t} result={syncDialog.prepared.result} busy={syncBusy}
            title={t('wc_merge_title')} mineLabel={t('wc_working_copy')}
            theirsLabel={`${t('wc_server')} (${syncDialog.prepared.head.author.name})`}
            onCancel={() => setSyncDialog(null)} onApply={applyMerge} />
        )}
        {syncDialog?.kind === 'checkin' && (
          <CheckInDialog t={t} changes={wcChanges} errors={syncDialog.errors} busy={syncBusy}
            onCancel={() => setSyncDialog(null)} onSubmit={submitCheckIn} />
        )}
        {planPreview && <PlanPreviewOverlay plan={planPreview.plan} filenameBase={planPreview.filenameBase} onClose={() => setPlanPreview(null)} t={t} />}
        {discardAsk && (
          <ConfirmModal
            message={t('table_discard_confirm')}
            confirmLabel={t('table_discard')}
            onConfirm={() => { const go = discardAsk; setDiscardAsk(null); go() }}
            onCancel={() => setDiscardAsk(null)}
            t={t}
          />
        )}
      </div>
    </div>
  )
}
