import maplibregl from 'maplibre-gl'
import { hydrateProjects } from './persistenceUtils'
import { endKey } from './trackEndMarks'

/**
 * Two states of a project on the map (phase 10, AP 10.3): what is new in the
 * later one green, what changed orange, what it no longer has grey and dashed
 * — and, for a conflict, the object as each side has it.
 *
 * The states come in dehydrated, as they are compared and merged; their
 * display geometry is built here from a copy (hydrateProjects), so the record
 * itself stays as it was.
 */

export const COMPARE_COLORS = {
  added:     '#2e9e44',
  changed:   '#f08a00',
  removed:   '#8a8a8a',
  unchanged: '#9aa3b5',
  mine:      '#1f6fd1',
  theirs:    '#c2185b',
}

/** A drawable copy of a dehydrated record. */
export function drawable(record) {
  return hydrateProjects([structuredClone(record ?? {})])[0]
}

const ringOf = (coords) => (coords?.length > 3 ? coords : null)

/**
 * The map features of one object of a hydrated record, coloured for
 * `status` (a key of COMPARE_COLORS). An end mark is drawn as a point at the
 * end it stands on, which is why the record comes along.
 */
export function objectFeatures(record, collection, obj, status, props = {}) {
  if (!obj) return []
  const color = COMPARE_COLORS[status] ?? COMPARE_COLORS.changed
  const base = { status, color, dashed: status === 'removed', collection, ...props }
  const feature = (geometry) => ({ type: 'Feature', properties: base, geometry })
  if (collection === 'tracks') {
    return obj.coordinates?.length > 1 ? [feature({ type: 'LineString', coordinates: obj.coordinates })] : []
  }
  if (collection === 'switches') {
    if (obj.fillCoords?.length) {
      return [Array.isArray(obj.fillCoords[0][0])
        ? feature({ type: 'MultiPolygon', coordinates: obj.fillCoords.map(r => [r]) })
        : feature({ type: 'Polygon', coordinates: [obj.fillCoords] })]
    }
    return obj.bodyCentre ? [feature({ type: 'Point', coordinates: obj.bodyCentre })] : []
  }
  if (collection === 'platforms') {
    const ring = ringOf(obj.coords)
    return ring ? [feature({ type: 'Polygon', coordinates: [ring] })] : []
  }
  if (collection === 'endMarks') {
    const track = (record.tracks ?? []).find(t => t.id === obj.trackId)
    const c = track?.coordinates
    if (!c?.length) return []
    return [feature({ type: 'Point', coordinates: obj.endpoint === 'BEGIN' ? c[0] : c[c.length - 1] })]
  }
  return []
}

/** Find an object of a collection in a record by its id. */
export function findObject(record, collection, id) {
  const key = collection === 'switches' ? 'switchId' : collection === 'kmLines' ? 'lineNumber' : 'id'
  return (record?.[collection] ?? []).find(o => String(o[key]) === String(id)) ?? null
}

/**
 * The features of a whole comparison: `entries` as diffEntries lists them,
 * `before` and `after` the two hydrated records. With `unchanged`, the
 * tracks neither side touched are drawn too, pale — for a comparison the map
 * does not already show.
 */
export function comparisonFeatures(before, after, entries, { unchanged = false } = {}) {
  const features = []
  const touched = new Set()
  for (const e of entries) {
    if (e.collection === 'project' || e.collection === 'kmLines') continue
    touched.add(`${e.collection}|${e.id}`)
    const from = e.kind === 'removed' ? before : after
    const obj = findObject(from, e.collection, e.id)
    features.push(...objectFeatures(from, e.collection, obj, e.kind, { entry: `${e.collection}|${e.id}` }))
  }
  if (unchanged) {
    for (const t of after.tracks ?? []) {
      if (!touched.has(`tracks|${t.id}`)) features.unshift(...objectFeatures(after, 'tracks', t, 'unchanged'))
    }
  }
  return features
}

const LAYERS = (id) => [`${id}-fill`, `${id}-line`, `${id}-dash`, `${id}-point`]

/** Put features on the map under `id` (replacing what was there under it). */
export function showFeatures(map, id, features) {
  if (!map) return
  const data = { type: 'FeatureCollection', features }
  const src = `${id}-src`
  if (map.getSource(src)) { map.getSource(src).setData(data); return }
  map.addSource(src, { type: 'geojson', data })
  const isPoly = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
  map.addLayer({ id: `${id}-fill`, type: 'fill', source: src, filter: isPoly,
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.45 } })
  map.addLayer({ id: `${id}-line`, type: 'line', source: src,
    filter: ['all', ['!', ['get', 'dashed']], ['!=', ['geometry-type'], 'Point']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 6], 'line-opacity': 0.9 } })
  map.addLayer({ id: `${id}-dash`, type: 'line', source: src,
    filter: ['all', ['get', 'dashed'], ['!=', ['geometry-type'], 'Point']],
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 6], 'line-dasharray': [2, 1.5] } })
  map.addLayer({ id: `${id}-point`, type: 'circle', source: src, filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-color': ['get', 'color'], 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
}

/**
 * showFeatures as soon as the map's style takes sources — it refuses them
 * while the style is still coming in, and 'idle' can be long in coming while
 * tiles load. Returns a function that stops trying.
 */
export function showFeaturesSoon(map, id, features) {
  let timer = null
  let tries = 0
  const attempt = () => {
    try { showFeatures(map, id, features) } catch { if (++tries < 200) timer = setTimeout(attempt, 150) }
  }
  attempt()
  return () => clearTimeout(timer)
}

/** Take the features under `id` off the map. */
export function clearFeatures(map, id) {
  if (!map?.getStyle?.()) return
  for (const layer of LAYERS(id)) if (map.getLayer(layer)) map.removeLayer(layer)
  if (map.getSource(`${id}-src`)) map.removeSource(`${id}-src`)
}

/**
 * Fit the map to features, in the part of it an overlay over its lower
 * `covered` share leaves free.
 */
export function zoomToFeatures(map, features, { maxZoom = 17, covered = 0.5 } = {}) {
  const coords = []
  const walk = (c) => { if (typeof c[0] === 'number') coords.push(c); else c.forEach(walk) }
  for (const f of features) walk(f.geometry.coordinates)
  if (!map || !coords.length) return
  const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
  const height = map.getContainer?.().clientHeight ?? 0
  map.fitBounds(bounds, { padding: { top: 60, left: 60, right: 60, bottom: Math.round(height * covered) + 40 }, maxZoom })
}

/**
 * How each track looks in the topology diagram of a comparison: its status
 * colour, dashed when it is gone. Tracks not in the map are unchanged.
 */
export function trackStylesOf(entries) {
  const styles = {}
  for (const e of entries) {
    if (e.collection !== 'tracks') continue
    styles[e.id] = { color: COMPARE_COLORS[e.kind], dashed: e.kind === 'removed' }
  }
  return styles
}

/**
 * The record the topology diagram of a comparison draws: the later state,
 * with the tracks the earlier one had and the later one lost put back in, so
 * they can be shown as gone. Their marks come with them where their end is
 * still free.
 */
export function comparisonTopology(before, after) {
  const ids = new Set((after.tracks ?? []).map(t => t.id))
  const gone = (before.tracks ?? []).filter(t => !ids.has(t.id))
  const goneIds = new Set(gone.map(t => t.id))
  const marks = (before.endMarks ?? []).filter(m => goneIds.has(m.trackId))
  const seen = new Set((after.endMarks ?? []).map(m => endKey(m.trackId, m.endpoint)))
  return {
    tracks: [...(after.tracks ?? []), ...gone],
    switches: after.switches ?? [],
    endMarks: [...(after.endMarks ?? []), ...marks.filter(m => !seen.has(endKey(m.trackId, m.endpoint)))],
  }
}
