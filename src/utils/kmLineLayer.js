import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { kmOnPieces, toMercator } from './kmLineMath'
import { ZOOM_LINE_WIDTH } from './mapConstants'

/**
 * The DB kilometrage lines as reference overlays.
 *
 * What is drawn comes from one PMTiles archive checked into the repository at
 * `tiles/km_linie.pmtiles` (built by tools/km_lines_to_tiles.py and symlinked
 * into `public/data/`, so both `npm run dev` and `npm run build` pick it up
 * without a separate step). It carries three layers, each for the zooms it
 * makes sense at: the network as whole chains while zoomed out, the alignment
 * cut into 100 m pieces from z12, and a point per hectometre — plus one per
 * kilometrage jump — from z13.
 *
 * Every feature says whether its stretch belongs to today's DB InfraGO network
 * (`in_db`), and the archive is shown as two overlays on that: the DB network,
 * and whatever the survey data has beyond it — closed lines and lines handed
 * over to other infrastructure managers alike, which the network export the
 * status comes from cannot tell apart. Both draw from the one source, each as
 * its own set of layers filtered to its half, and either can be on alone.
 *
 * It answers at `data/km_linie.pmtiles` unless VITE_OLT_KM_TILES says
 * otherwise, e.g. to point local development at a copy served elsewhere.
 *
 * The kilometrage of an arbitrary point is not stored anywhere — it follows
 * from how far along its 100 m piece the point lies (see `kmAt`), which is why
 * the pieces are tiled unclipped.
 */

const TILE_URL = import.meta.env.VITE_OLT_KM_TILES ?? 'data/km_linie.pmtiles'

const SOURCE = 'km-linie-source'

// Teal, so the reference lines can never be mistaken for the project's own
// tracks (those carry the user's colour), a hover (orange) or a selection (red).
// What lies outside the DB network is the same kind of line in a muted grey,
// dashed — a reference still, but plainly the lesser one. Exported because the
// layers panel previews the overlays in the same colours.
export const KM_COLOR = '#0f766e'
export const KM_OTHER_COLOR = '#78716c'
export const KM_JUMP_COLOR = '#b3261e'

/**
 * The two overlays: the `in_db` half each shows and how it is drawn. An archive
 * built before the status existed carries no `in_db` at all, and counts as the
 * DB network — so the first half is "not 0" rather than "1".
 */
const OVERLAYS = {
  db:    { half: ['!=', ['get', 'in_db'], 0], color: KM_COLOR, dash: null },
  other: { half: ['==', ['get', 'in_db'], 0], color: KM_OTHER_COLOR, dash: [3, 2] },
}

/** Layer ids of one overlay, in draw order. */
const layerIds = (key) => [
  `km-${key}-linien-layer`,
  `km-${key}-100m-layer`,
  `km-${key}-punkte-layer`,
  `km-${key}-jump-layer`,
  `km-${key}-vollkm-label`,
  `km-${key}-hm-label`,
  `km-${key}-jump-label`,
]
const chainLayer = (key) => `km-${key}-linien-layer`
const pieceLayer = (key) => `km-${key}-100m-layer`

let protocolAdded = false
// The listener waiting to hear that the archive is not there, kept here so
// switching the overlays off again takes it with it instead of piling another
// one on with every switch-on.
let errorWatch = null

function stopErrorWatch() {
  if (!errorWatch) return
  const { map, handler } = errorWatch
  errorWatch = null
  map.off('error', handler)
}

/**
 * A font the current basemap can actually deliver glyphs for.
 *
 * Every style names its own fonts, and asking for one its glyph endpoint does
 * not serve leaves the labels silently blank — so the style is asked what it
 * uses itself, and only a style without any glyphs at all is given ours.
 */
function textFont(map) {
  const style = map.getStyle()
  if (!style?.glyphs) {
    map.setGlyphs(FALLBACK_GLYPHS)
    return ['Noto Sans Regular']
  }
  const fonts = (style.layers ?? []).flatMap((l) => l.layout?.['text-font'] ?? [])
  const regular = fonts.find((f) => /regular|book|normal/i.test(f)) ?? fonts[0]
  return [regular ?? 'Noto Sans Regular']
}

// Labels need glyphs, and the raster basemaps (the state orthophotos, DGM5,
// satellite) bring none — they are built here as plain raster styles.
const FALLBACK_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

function addSource(map, onError) {
  if (!protocolAdded) {
    maplibregl.addProtocol('pmtiles', new Protocol().tile)
    protocolAdded = true
  }
  if (map.getSource(SOURCE)) return

  stopErrorWatch()
  if (onError) {
    const handler = (e) => {
      if (e.sourceId !== SOURCE) return
      stopErrorWatch()
      onError(e.error)
    }
    errorWatch = { map, handler }
    map.on('error', handler)
  }

  // A relative URL is resolved here rather than left to the protocol handler,
  // which fetches outside the document's context.
  map.addSource(SOURCE, {
    type: 'vector',
    url: `pmtiles://${new URL(TILE_URL, window.location.href).href}`,
    attribution: 'DB InfraGO',
  })
}

function addOverlay(map, key, beforeId) {
  if (map.getLayer(chainLayer(key))) return
  const { half, color, dash } = OVERLAYS[key]
  // What is outside the DB network goes underneath the network itself, wherever
  // the two cross or run together; both stay underneath the project's geometry.
  const below = key === 'other' && map.getLayer(chainLayer('db')) ? chainLayer('db') : beforeId
  const before = below && map.getLayer(below) ? below : undefined
  const font = textFont(map)
  const [chains, pieces, points, jumps, fullKm, hm, jumpLabels] = layerIds(key)
  const only = (filter) => (filter ? ['all', half, filter] : half)
  const linePaint = {
    'line-color': color,
    'line-width': ZOOM_LINE_WIDTH,   // the same pen as the project's tracks
    'line-opacity': 0.85,
    ...(dash ? { 'line-dasharray': dash } : {}),
  }
  const label = (id, minzoom, filter, field, textColor) => ({
    id,
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'km_punkte',
    minzoom,
    filter: only(filter),
    layout: {
      'text-field': field,
      'text-font': font,
      'text-size': 11,
      'text-offset': [0, -0.8],
      'text-anchor': 'bottom',
      'text-padding': 4,
    },
    paint: { 'text-color': textColor, 'text-halo-color': '#fff', 'text-halo-width': 1.4 },
  })

  // The chains stop where the 100 m pieces start — the two are the same line,
  // split between the zooms each is tiled for.
  map.addLayer({
    id: chains, type: 'line', source: SOURCE, 'source-layer': 'km_linien',
    maxzoom: 12, filter: only(), paint: linePaint,
  }, before)
  map.addLayer({
    id: pieces, type: 'line', source: SOURCE, 'source-layer': 'km_100m',
    minzoom: 12, filter: only(), paint: linePaint,
  }, before)
  map.addLayer({
    id: points, type: 'circle', source: SOURCE, 'source-layer': 'km_punkte',
    minzoom: 13, filter: only(['!', ['has', 'jump']]),
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.6, 16, 3],
      'circle-color': color,
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 0.8,
    },
  }, before)
  map.addLayer({
    id: jumps, type: 'circle', source: SOURCE, 'source-layer': 'km_punkte',
    minzoom: 13, filter: only(['has', 'jump']),
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.4, 16, 4],
      'circle-color': KM_JUMP_COLOR,
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 1,
    },
  }, before)

  // Full kilometres carry their label early; the hectometres in between would
  // only collide at those zooms and wait until the line is spread out enough.
  map.addLayer(label(fullKm, 13, ['==', ['get', 'full_km'], 1], ['get', 'label'], color), before)
  map.addLayer(label(hm, 15, ['all', ['!=', ['get', 'full_km'], 1], ['!', ['has', 'jump']]],
    ['get', 'label'], color), before)
  map.addLayer(label(jumpLabels, 14, ['has', 'jump'],
    ['concat', ['get', 'label'], ' → ', ['get', 'label_after']], KM_JUMP_COLOR), before)
}

function removeOverlay(map, key) {
  for (const id of [...layerIds(key)].reverse()) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
}

/**
 * Show exactly the overlays `shown` asks for — `{ db, other }` — adding the
 * source with the first one switched on and taking it away with the last one
 * switched off. `beforeId` keeps them underneath the project's own geometry;
 * `onError` reports a missing or unreachable archive once.
 */
export function showKmOverlays(map, shown, { beforeId, onError } = {}) {
  for (const key of Object.keys(OVERLAYS)) {
    if (!shown[key]) removeOverlay(map, key)
  }
  if (!Object.keys(OVERLAYS).some((key) => shown[key])) {
    stopErrorWatch()
    if (map.getSource(SOURCE)) map.removeSource(SOURCE)
    return
  }
  addSource(map, onError)
  for (const key of ['db', 'other']) {
    if (shown[key]) addOverlay(map, key, beforeId)
  }
}

const shownLayers = (map, idOf) => Object.keys(OVERLAYS).map(idOf).filter((id) => map.getLayer(id))

/**
 * The line numbers the overlays currently show, nearest to the middle of the
 * view first — what a form offers when it asks which line a track belongs to.
 *
 * This reads what is drawn, so it only knows what the overlays have loaded:
 * with both switched off, or the view somewhere else, the list is empty and the
 * number stays a matter of typing it in.
 */
export function nearbyLineNumbers(map, limit = 6, reach = 250) {
  const layers = [...shownLayers(map, pieceLayer), ...shownLayers(map, chainLayer)]
  if (!layers.length) return []
  // A box around the middle of the view rather than all of it: the question is
  // which line the user is about to draw on, and it keeps the walk below short
  // where a city fills the screen with lines.
  const middle = map.project(map.getCenter())
  const features = map.queryRenderedFeatures(
    [[middle.x - reach, middle.y - reach], [middle.x + reach, middle.y + reach]],
    { layers },
  )
  if (!features.length) return []

  const centre = map.getCenter()
  const [cx, cy] = toMercator(centre.lng, centre.lat)
  // One Mercator unit is the equator; at this latitude the ground is shorter.
  const perUnit = 40075017 * Math.cos((centre.lat * Math.PI) / 180)

  const nearest = new Map()
  for (const feature of features) {
    const number = feature.properties?.strecke
    if (number == null) continue
    const parts = feature.geometry.type === 'MultiLineString'
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates]
    for (const part of parts) {
      for (const [lon, lat] of part) {
        const [x, y] = toMercator(lon, lat)
        const distance = Math.hypot(x - cx, y - cy) * perUnit
        if (!(distance < (nearest.get(number) ?? Infinity))) continue
        nearest.set(number, distance)
      }
    }
  }
  return [...nearest.entries()]
    .map(([lineNumber, distance]) => ({ lineNumber, distance: Math.round(distance) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
}

// ── Kilometrage of a point ──────────────────────────────────────────────────

/**
 * The kilometrage at a mouse position, or null where no shown line is near.
 *
 * Returns the value interpolated along the 100 m piece under the cursor
 * together with the point on the line it belongs to, so a readout can sit on
 * the line rather than where the mouse happens to be.
 */
export function kmAt(map, event, tolerance = 8) {
  const layers = shownLayers(map, pieceLayer)
  if (!layers.length) return null
  const { x, y } = event.point
  const pieces = map.queryRenderedFeatures(
    [[x - tolerance, y - tolerance], [x + tolerance, y + tolerance]],
    { layers },
  )
  return pieces.length === 0 ? null : kmOnPieces(pieces, event.lngLat)
}
