import { classifyTrackEnds, switchNodes } from './topology'
import { GEOJSON_MAXZOOM, ZOOM_LINE_WIDTH } from './mapConstants'

/**
 * The topology view (ROADMAP AP 9.3): the tracks as plain lines in their true
 * position, every switch a large circle the tracks run into, every link a
 * square, and every track end that is connected to nothing marked red.
 *
 * It replaces the ordinary drawing rather than lying on top of it (decision
 * 83): the switch bodies, element markers, labels, platforms and buffer stop
 * symbols are hidden, and the track line itself is restyled — kept, not
 * hidden, because it is what a click on the map picks a track by.
 */

export const TOPOLOGY_RED = '#d62828'
const BOUNDARY_GREY = '#8a8a8a'

/** Line width of a track in the topology view [px], at every zoom. */
const LINE_WIDTH = 2.5
/** Radius of a switch circle [px] — far larger than anything else on the map (decision 82). */
const SWITCH_RADIUS = 13

/** Layers of the ordinary drawing that the topology view hides. */
const HIDDEN = [
  'switch-fills-layer', 'switch-lcs-layer', 'tracks-markers-layer',
  'platforms-fill-layer', 'platforms-outline-layer',
  'buffer-stops-layer', 'buffer-stops-brake-layer',
]

const SOURCE_NODES = 'topology-nodes-source'
const SOURCE_ENDS  = 'topology-ends-source'
const LAYERS = [
  'topology-veil-layer', 'topology-highlight-layer',
  'topology-switches-layer', 'topology-switch-selected-layer', 'topology-links-layer',
  'topology-bars-layer', 'topology-ends-layer',
]

/** How much of the basemap the view lets through: Liberty, very pale. */
const VEIL_OPACITY = 0.8
export const TOPOLOGY_HIGHLIGHT = '#ff8c00'

// What is highlighted, kept here so a redraw — a basemap change throws every
// layer away — puts it back.
let highlight = { trackIds: [], switchIds: [] }
const highlightFilters = () => ({
  tracks: ['in', ['get', 'trackId'], ['literal', highlight.trackIds]],
  node: ['in', ['get', 'switchId'], ['literal', highlight.switchIds]],
})

const SQUARE_IMAGE   = 'topology-link-square'
const BAR_BLACK      = 'topology-bar-buffer-stop'
const BAR_GREY       = 'topology-bar-boundary'
const IMAGE_RATIO = 2

/** An RGBA image of `w`×`h` CSS px, painted by `paint(x, y)` → [r, g, b, a] per image pixel. */
function image(w, h, paint) {
  const W = w * IMAGE_RATIO, H = h * IMAGE_RATIO
  const data = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data.set(paint(x / IMAGE_RATIO, y / IMAGE_RATIO), (y * W + x) * 4)
  }
  return { width: W, height: H, data }
}

const hexRgb = (hex) => {
  const h = String(hex).replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) || 0)
}

/** The link square: white with a border in the track colour, the colour the circles use. */
function squareImage(color) {
  const [r, g, b] = hexRgb(color)
  const size = 18, border = 3
  return image(size, size, (x, y) => {
    const edge = x < border || y < border || x >= size - border || y >= size - border
    return edge ? [r, g, b, 255] : [255, 255, 255, 255]
  })
}

/** A bar across the track end, drawn upright and turned by the layer to the track's bearing. */
function barImage([r, g, b]) {
  return image(18, 4, () => [r, g, b, 255])
}

function ensureImages(map, color) {
  // The square carries the track colour, so it is redrawn whenever that changes.
  if (map.hasImage(SQUARE_IMAGE)) map.updateImage(SQUARE_IMAGE, squareImage(color))
  else map.addImage(SQUARE_IMAGE, squareImage(color), { pixelRatio: IMAGE_RATIO })
  if (!map.hasImage(BAR_BLACK)) map.addImage(BAR_BLACK, barImage([0, 0, 0]), { pixelRatio: IMAGE_RATIO })
  if (!map.hasImage(BAR_GREY)) map.addImage(BAR_GREY, barImage(hexRgb(BOUNDARY_GREY)), { pixelRatio: IMAGE_RATIO })
}

/**
 * What the topology view draws, as GeoJSON: the switch and link nodes, and
 * the track ends that say something — open (red), buffer stop (black bar), boundary (grey bar). Ends at a switch, a link or a
 * plain joint are what the lines already show and are left out.
 */
export function topologyGeoJSON(tracks, switches, endMarks) {
  const nodes = switchNodes(tracks, switches).map(n => ({
    type: 'Feature',
    properties: { link: n.link, switchId: n.switchId ?? '' },
    geometry: { type: 'Point', coordinates: n.lngLat },
  }))
  const shown = new Set(['open', 'buffer_stop', 'boundary'])
  const ends = classifyTrackEnds(tracks, switches, endMarks)
    .filter(e => shown.has(e.state))
    .map(e => ({
      type: 'Feature',
      // The bar is drawn lying east–west, across a track running north;
      // turned by the track's bearing it stands across that track.
      properties: { state: e.state, trackId: e.trackId, endpoint: e.endpoint, rotate: e.outward % 360 },
      geometry: { type: 'Point', coordinates: e.lngLat },
    }))
  return {
    nodes: { type: 'FeatureCollection', features: nodes },
    ends:  { type: 'FeatureCollection', features: ends },
  }
}

function addLayers(map) {
  map.addSource(SOURCE_NODES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, maxzoom: GEOJSON_MAXZOOM })
  map.addSource(SOURCE_ENDS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, maxzoom: GEOJSON_MAXZOOM })
  // A white veil over the basemap and everything the basemap brought (the
  // kilometrage overlays included), under the tracks: the map stays for
  // orientation and nothing on it competes with the network.
  map.addLayer({
    id: 'topology-veil-layer', type: 'background',
    paint: { 'background-color': '#ffffff', 'background-opacity': VEIL_OPACITY },
  }, 'tracks-layer')
  const f = highlightFilters()
  map.addLayer({
    id: 'topology-highlight-layer', type: 'line', source: 'tracks-source',
    filter: f.tracks,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': TOPOLOGY_HIGHLIGHT, 'line-width': 7, 'line-opacity': 0.85 },
  })
  map.addLayer({
    id: 'topology-bars-layer', type: 'symbol', source: SOURCE_ENDS,
    filter: ['in', ['get', 'state'], ['literal', ['buffer_stop', 'boundary']]],
    layout: {
      'icon-image': ['match', ['get', 'state'], 'buffer_stop', BAR_BLACK, BAR_GREY],
      'icon-rotate': ['get', 'rotate'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })
  map.addLayer({
    id: 'topology-switches-layer', type: 'circle', source: SOURCE_NODES,
    filter: ['!', ['get', 'link']],
    paint: {
      'circle-radius': SWITCH_RADIUS,
      'circle-color': '#ffffff',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#303383',
    },
  })
  map.addLayer({
    id: 'topology-switch-selected-layer', type: 'circle', source: SOURCE_NODES,
    filter: f.node,
    paint: {
      'circle-radius': SWITCH_RADIUS + 2,
      'circle-opacity': 0,
      'circle-stroke-width': 4,
      'circle-stroke-color': TOPOLOGY_HIGHLIGHT,
    },
  })
  map.addLayer({
    id: 'topology-links-layer', type: 'symbol', source: SOURCE_NODES,
    filter: ['get', 'link'],
    layout: { 'icon-image': SQUARE_IMAGE, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
  })
  map.addLayer({
    id: 'topology-ends-layer', type: 'circle', source: SOURCE_ENDS,
    filter: ['==', ['get', 'state'], 'open'],
    paint: {
      'circle-radius': 6,
      'circle-color': TOPOLOGY_RED,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
    },
  })
}

/**
 * Switch the topology view on or off, and — while on — draw it from the
 * project as it is now. Called after every redraw of the tracks, so it also
 * follows every edit, and puts its layers back after a basemap change threw
 * the style away.
 */
export function showTopology(map, { on, tracks, switches, endMarks, color }) {
  if (!map?.getLayer('tracks-layer')) return
  const visibility = on ? 'none' : 'visible'
  for (const id of HIDDEN) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility)
  map.setPaintProperty('tracks-layer', 'line-width', on ? LINE_WIDTH : ZOOM_LINE_WIDTH)

  if (!on) {
    for (const id of LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none')
    return
  }
  ensureImages(map, color)
  if (!map.getSource(SOURCE_NODES)) addLayers(map)
  for (const id of LAYERS) map.setLayoutProperty(id, 'visibility', 'visible')
  map.setPaintProperty('topology-switches-layer', 'circle-stroke-color', color)
  const data = topologyGeoJSON(tracks, switches, endMarks)
  map.getSource(SOURCE_NODES).setData(data.nodes)
  map.getSource(SOURCE_ENDS).setData(data.ends)
  applyHighlight(map)
}

function applyHighlight(map) {
  if (!map?.getLayer('topology-highlight-layer')) return
  const f = highlightFilters()
  map.setFilter('topology-highlight-layer', f.tracks)
  map.setFilter('topology-switch-selected-layer', f.node)
}

/**
 * Highlight tracks and switches (AP 9.5): a selected switch with the tracks it
 * connects, or a selected track with the switches it runs into. Empty lists
 * clear it.
 */
export function highlightTopology(map, { trackIds = [], switchIds = [] } = {}) {
  highlight = { trackIds, switchIds }
  applyHighlight(map)
}

/** The first feature of `layers` under a point on the map, or null. */
function featureAt(map, point, layers, tolerance) {
  const shown = layers.filter(id => map?.getLayer(id))
  if (!shown.length) return null
  return map.queryRenderedFeatures([
    [point.x - tolerance, point.y - tolerance], [point.x + tolerance, point.y + tolerance],
  ], { layers: shown })[0] ?? null
}

/** The switch or link under a point on the map, or null. */
export function topologySwitchAt(map, point, tolerance = 4) {
  return featureAt(map, point, ['topology-switches-layer', 'topology-links-layer'], tolerance)?.properties?.switchId || null
}

/** The track under a point on the map, or null — the switches come first, so ask this second. */
export function topologyTrackAt(map, point, tolerance = 5) {
  return featureAt(map, point, ['tracks-layer'], tolerance)?.properties?.trackId || null
}

/**
 * What a click at a point selects in the topology view: a switch or link,
 * else a track, else nothing — { kind: 'switch'|'track', id } or null.
 */
export function topologySelectionAt(map, point) {
  const switchId = topologySwitchAt(map, point)
  if (switchId) return { kind: 'switch', id: switchId }
  const trackId = topologyTrackAt(map, point)
  return trackId ? { kind: 'track', id: trackId } : null
}
