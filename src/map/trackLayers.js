import maplibregl from 'maplibre-gl'
import { translations } from '../locales/i18n'
import { ZOOM_LINE_WIDTH, ZOOM_LINE_WIDTH_HOVER, ZOOM_LINE_WIDTH_SELECTED, ZOOM_LINE_WIDTH_BUFFER_STOP, ZOOM_ICON_SIZE, MARKER_MIN_ZOOM, GEOJSON_MAXZOOM } from '../utils/mapConstants'
import { FILTER_NONE } from './pick'
import { loadSettings } from '../utils/settings'
import { bufferStopFeatures } from '../utils/bufferStopGeometry'
import { showTopology } from '../utils/topologyLayer'
import { resolveEndBearing, displayCoords } from '../utils/elementUtils'
import { getColor, PLATFORM_FILL_COLOR, PLATFORM_FILL_OPACITY, PLATFORM_OUTLINE_COLOR } from '../utils/mapRenderUtils'
import { updateLabels, clearTrackLabels, createTrackLabel, SWITCH_LABEL_MIN_ZOOM } from '../utils/labelUtils'
import { ensureMarkerImages, TRACK_MARKER_ICON_IMAGE } from '../utils/markerImages'
import { BUFFER_STOPS_BRAKE_LAYER, BUFFER_STOPS_LAYER, BUFFER_STOPS_SOURCE, PLATFORMS_FILL_LAYER, PLATFORMS_OUTLINE_LAYER, PLATFORMS_SOURCE, SWITCH_FILLS_LAYER, SWITCH_FILLS_SOURCE, SWITCH_LCS_LAYER, SWITCH_LCS_SOURCE, TRACKS_HOVER_LAYER, TRACKS_LAYER, TRACKS_SELECTED_LAYER, TRACKS_SOURCE, TRACK_MARKERS_LAYER, TRACK_MARKERS_SOURCE } from './layerIds'

// The project on the map: tracks, switch bodies, platforms, buffer stops, the
// start/end markers and the labels — drawn from a project record. One source
// per kind; the first call adds sources and layers, every later one only
// replaces their data.

export function updateMapColors(map, color) {
  if (!map) return
  const c = color ?? getColor()
  if (map.getLayer(TRACKS_LAYER))         map.setPaintProperty(TRACKS_LAYER,         'line-color', c)
  if (map.getLayer(SWITCH_FILLS_LAYER))   map.setPaintProperty(SWITCH_FILLS_LAYER,   'fill-color', c)
  if (map.getLayer(TRACK_MARKERS_LAYER)) map.setPaintProperty(TRACK_MARKERS_LAYER, 'icon-color', c)
  if (map.getLayer(BUFFER_STOPS_LAYER))   map.setPaintProperty(BUFFER_STOPS_LAYER,   'line-color', c)
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

export function renderTracksOnMap(map, project, { fit = false, topology = false } = {}) {
  if (!map || !project) return
  const tracks = project.tracks ?? []
  // Labels are language-dependent and this runs outside the component tree, so
  // the language comes from the settings the app writes it to.
  const lang = loadSettings().language ?? 'en'
  const tr = (key) => translations[lang]?.[key] ?? key
  const switches = project.switches ?? []
  // The switch an element belongs to, so its radius label knows which side of
  // its own line the turnout body fills and can go to the other one.
  const switchById = Object.fromEntries(switches.filter(sw => sw.switchId).map(sw => [sw.switchId, sw]))
  const switchOf   = (el) => switchById[el.switchId] ?? null

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
    features: (project.platforms ?? [])
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
  const bufferStopGeoJSON = { type: 'FeatureCollection', features: bufferStopFeatures(tracks, project.endMarks ?? []) }

  if (map.getSource(TRACKS_SOURCE)) {
    map.getSource(TRACKS_SOURCE).setData(lineGeoJSON)
    map.getSource(BUFFER_STOPS_SOURCE)?.setData(bufferStopGeoJSON)
    map.getSource(TRACK_MARKERS_SOURCE).setData(pointGeoJSON)
    map.getSource(SWITCH_FILLS_SOURCE)?.setData(switchFillGeoJSON)
    map.getSource(SWITCH_LCS_SOURCE)?.setData(switchLcsGeoJSON)
    map.getSource(PLATFORMS_SOURCE)?.setData(platformGeoJSON)
  } else {
    const c = getColor()
    // Added before the track layers so the tracks stay drawn on top of them.
    map.addSource(PLATFORMS_SOURCE, { type: 'geojson', data: platformGeoJSON, maxzoom: GEOJSON_MAXZOOM })
    map.addLayer({
      id: PLATFORMS_FILL_LAYER,
      type: 'fill',
      source: PLATFORMS_SOURCE,
      paint: { 'fill-color': PLATFORM_FILL_COLOR, 'fill-opacity': PLATFORM_FILL_OPACITY },
    })
    map.addLayer({
      id: PLATFORMS_OUTLINE_LAYER,
      type: 'line',
      source: PLATFORMS_SOURCE,
      paint: { 'line-color': PLATFORM_OUTLINE_COLOR, 'line-width': 1.2 },
    })
    map.addSource(TRACKS_SOURCE, { type: 'geojson', data: lineGeoJSON, maxzoom: GEOJSON_MAXZOOM })
    map.addLayer({
      id: TRACKS_LAYER,
      type: 'line',
      source: TRACKS_SOURCE,
      paint: {
        'line-color': c,
        'line-width': ZOOM_LINE_WIDTH,
      },
    })
    map.addSource(BUFFER_STOPS_SOURCE, { type: 'geojson', data: bufferStopGeoJSON, maxzoom: GEOJSON_MAXZOOM })
    map.addLayer({
      id: BUFFER_STOPS_BRAKE_LAYER,
      type: 'line',
      source: BUFFER_STOPS_SOURCE,
      filter: ['==', ['get', 'part'], 'brake'],
      paint: { 'line-color': '#ffffff', 'line-width': ZOOM_LINE_WIDTH, 'line-dasharray': [1.5, 1.5] },
    })
    map.addLayer({
      id: BUFFER_STOPS_LAYER,
      type: 'line',
      source: BUFFER_STOPS_SOURCE,
      filter: ['!=', ['get', 'part'], 'brake'],
      paint: { 'line-color': c, 'line-width': ZOOM_LINE_WIDTH_BUFFER_STOP },
    })
    map.addSource(TRACK_MARKERS_SOURCE, { type: 'geojson', data: pointGeoJSON, maxzoom: GEOJSON_MAXZOOM })
    map.addSource(SWITCH_FILLS_SOURCE, { type: 'geojson', data: switchFillGeoJSON, maxzoom: GEOJSON_MAXZOOM })
    map.addLayer({
      id: SWITCH_FILLS_LAYER,
      type: 'fill',
      source: SWITCH_FILLS_SOURCE,
      paint: { 'fill-color': c, 'fill-opacity': 0.9 },
    })
    map.addSource(SWITCH_LCS_SOURCE, { type: 'geojson', data: switchLcsGeoJSON, maxzoom: GEOJSON_MAXZOOM })
    map.addLayer({
      id: SWITCH_LCS_LAYER,
      type: 'line',
      source: SWITCH_LCS_SOURCE,
      paint: { 'line-color': c, 'line-width': ZOOM_LINE_WIDTH, 'line-opacity': 0.7 },
    })

    ensureMarkerImages(map)

    map.addLayer({
      id: TRACK_MARKERS_LAYER,
      type: 'symbol',
      source: TRACK_MARKERS_SOURCE,
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
      id: TRACKS_HOVER_LAYER,
      type: 'line',
      source: TRACKS_SOURCE,
      filter: FILTER_NONE,
      paint: {
        'line-color': '#ff8c00',
        'line-width': ZOOM_LINE_WIDTH_HOVER,
        'line-opacity': 0.7,
      },
    })
    map.addLayer({
      id: TRACKS_SELECTED_LAYER,
      type: 'line',
      source: TRACKS_SOURCE,
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
  showTopology(map, { on: topology, tracks, switches, endMarks: project.endMarks ?? [], color: getColor() })

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
