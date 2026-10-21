import { toMercator } from '../utils/km'
import { PALETTE } from '../styles/palette'
import { textFont } from './kmLineLayer'
import { ZOOM_LINE_WIDTH } from './style'

/**
 * The project's own kilometrage lines (`project.kmLines`) as an overlay: the
 * stretch of a DB line the project keeps, or the line an import brought (MDB,
 * Verm.ESN `…S`) — what the project's kilometrage is actually read off, where
 * the DB overlays show the whole network (decision 354). Drawn in a colour of
 * their own above the DB overlays and below the project's geometry, with a
 * point and a label every hectometre and the line number along the line.
 */

const LOCAL_KM_COLOR = PALETTE.kmLineLocal

const SOURCE = 'km-local-source'
const MARKS_SOURCE = 'km-local-marks-source'
const LINE_LAYER = 'km-local-line-layer'
/** The lowest of the layers — what the DB overlays go underneath. */
export const LOCAL_KM_FIRST_LAYER = LINE_LAYER
const LAYERS = [LINE_LAYER, 'km-local-points-layer', 'km-local-full-label', 'km-local-hm-label', 'km-local-number-label']

/** A kilometrage as the hectometre labels write it: 163.4 km → "163,4". */
const hmLabel = (metres) => (metres / 1000).toFixed(1).replace('.', ',')

/**
 * The lines and hectometre marks of `kmLines` as two GeoJSON collections: each
 * run a LineString { lineNumber }, each whole hectometre on it a Point
 * { lineNumber, full (1 on a whole kilometre), label } — placed between the
 * run's vertices by its kilometrage, which runs either way.
 */
export function localKmFeatures(kmLines) {
  const lines = []
  const marks = []
  for (const kmLine of kmLines ?? []) {
    const lineNumber = String(kmLine.lineNumber)
    for (const run of kmLine.runs ?? []) {
      if (run.length < 2) continue
      lines.push({
        type: 'Feature', properties: { lineNumber },
        geometry: { type: 'LineString', coordinates: run.map(([lon, lat]) => [lon, lat]) },
      })
      const seen = new Set()
      for (let i = 1; i < run.length; i++) {
        const [alon, alat, akm] = run[i - 1]
        const [blon, blat, bkm] = run[i]
        if (!(Number.isFinite(akm) && Number.isFinite(bkm)) || akm === bkm) continue
        const lo = Math.min(akm, bkm), hi = Math.max(akm, bkm)
        for (let hm = Math.ceil(lo / 100 - 1e-9); hm * 100 <= hi + 1e-6; hm++) {
          if (seen.has(hm)) continue
          seen.add(hm)
          const t = (hm * 100 - akm) / (bkm - akm)
          marks.push({
            type: 'Feature',
            properties: { lineNumber, full: hm % 10 === 0 ? 1 : 0, label: hmLabel(hm * 100) },
            geometry: { type: 'Point', coordinates: [alon + (blon - alon) * t, alat + (blat - alat) * t] },
          })
        }
      }
    }
  }
  return {
    lines: { type: 'FeatureCollection', features: lines },
    marks: { type: 'FeatureCollection', features: marks },
  }
}

function removeLayers(map) {
  for (const id of [...LAYERS].reverse()) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  for (const id of [SOURCE, MARKS_SOURCE]) {
    if (map.getSource(id)) map.removeSource(id)
  }
}

function addLayers(map, beforeId) {
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined
  const font = textFont(map)
  const label = (id, minzoom, filter) => ({
    id, type: 'symbol', source: MARKS_SOURCE, minzoom, filter,
    layout: {
      'text-field': ['get', 'label'], 'text-font': font, 'text-size': 11,
      'text-offset': [0, -0.8], 'text-anchor': 'bottom', 'text-padding': 4,
    },
    paint: { 'text-color': LOCAL_KM_COLOR, 'text-halo-color': '#fff', 'text-halo-width': 1.4 },
  })
  map.addLayer({
    id: LINE_LAYER, type: 'line', source: SOURCE,
    paint: { 'line-color': LOCAL_KM_COLOR, 'line-width': ZOOM_LINE_WIDTH, 'line-opacity': 0.9 },
  }, before)
  map.addLayer({
    id: 'km-local-points-layer', type: 'circle', source: MARKS_SOURCE, minzoom: 14,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.8, 17, 3.2],
      'circle-color': LOCAL_KM_COLOR, 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.8,
    },
  }, before)
  map.addLayer(label('km-local-full-label', 12, ['==', ['get', 'full'], 1]), before)
  map.addLayer(label('km-local-hm-label', 15, ['!=', ['get', 'full'], 1]), before)
  map.addLayer({
    id: 'km-local-number-label', type: 'symbol', source: SOURCE, minzoom: 11,
    layout: {
      'symbol-placement': 'line', 'symbol-spacing': 400,
      'text-field': ['get', 'lineNumber'], 'text-font': font, 'text-size': 11, 'text-offset': [0, 0.9],
    },
    paint: { 'text-color': LOCAL_KM_COLOR, 'text-halo-color': '#fff', 'text-halo-width': 1.4 },
  }, before)
}

/**
 * Show exactly the lines `kmLines` (none: the overlay goes), below `beforeId`.
 * The data is replaced in place where the layers are there already.
 */
export function showLocalKmLines(map, kmLines, { beforeId } = {}) {
  if (!kmLines?.length) { removeLayers(map); return }
  const { lines, marks } = localKmFeatures(kmLines)
  if (map.getSource(SOURCE) && map.getSource(MARKS_SOURCE) && map.getLayer(LINE_LAYER)) {
    map.getSource(SOURCE).setData(lines)
    map.getSource(MARKS_SOURCE).setData(marks)
    return
  }
  removeLayers(map)
  map.addSource(SOURCE, { type: 'geojson', data: lines })
  map.addSource(MARKS_SOURCE, { type: 'geojson', data: marks })
  addLayers(map, beforeId)
}

/**
 * The kilometrage at a mouse position on one of the shown lines `kmLines`, or
 * null where none is drawn near: { lineNumber, km, lngLat } — the point on the
 * line the perpendicular from the cursor meets, its kilometrage interpolated
 * between the run's vertices.
 */
export function localKmAt(map, event, kmLines, tolerance = 8) {
  if (!kmLines?.length || !map.getLayer(LINE_LAYER)) return null
  const { x, y } = event.point
  const hits = map.queryRenderedFeatures([[x - tolerance, y - tolerance], [x + tolerance, y + tolerance]], { layers: [LINE_LAYER] })
  const near = new Set(hits.map(f => String(f.properties?.lineNumber)))
  if (!near.size) return null
  const [cx, cy] = toMercator(event.lngLat.lng, event.lngLat.lat)
  let best = null
  for (const kmLine of kmLines) {
    if (!near.has(String(kmLine.lineNumber))) continue
    for (const run of kmLine.runs ?? []) {
      for (let i = 1; i < run.length; i++) {
        const [alon, alat, akm] = run[i - 1]
        const [blon, blat, bkm] = run[i]
        const [ax, ay] = toMercator(alon, alat)
        const [bx, by] = toMercator(blon, blat)
        const dx = bx - ax, dy = by - ay
        const squared = dx * dx + dy * dy
        if (!squared) continue
        const t = Math.min(1, Math.max(0, ((cx - ax) * dx + (cy - ay) * dy) / squared))
        const distance = Math.hypot(cx - (ax + t * dx), cy - (ay + t * dy))
        if (best && distance >= best.distance) continue
        best = {
          distance, lineNumber: String(kmLine.lineNumber), km: akm + (bkm - akm) * t,
          lngLat: [alon + (blon - alon) * t, alat + (blat - alat) * t],
        }
      }
    }
  }
  return best && { lineNumber: best.lineNumber, km: best.km, lngLat: best.lngLat }
}
