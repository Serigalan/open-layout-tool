import { loadTracks, loadKmLines, saveKmLine, deleteKmLine, generateId } from '../storage'

/**
 * Getting the kilometrage lines a project needs onto the project.
 *
 * One file per line number sits next to the app — `data/km/1000.json`, checked
 * into the repository at `tiles/km/1000.json` — holding that line's stationed
 * runs in WGS84: `[[lon, lat, km], …]`, a kilometrage on every vertex. What a
 * project keeps is the stretch of it around the project's own tracks, so a
 * station plan carries a few tens of kilobytes rather than a whole line.
 *
 * This runs after a track is saved, for whatever line numbers the tracks name.
 * Nothing here is a geometry calculation — a line is clipped by comparing
 * longitudes and latitudes against a box, which is a filter on data, not a
 * measurement — so it stays in WGS84 throughout, and the plane only enters
 * where the kilometrage is actually read off (kmLineUtils).
 */

// Guarded, so the module also loads outside Vite — the clipping below is what
// the verification harness exercises.
const BASE = import.meta.env?.VITE_OLT_KM_LINES ?? 'data/km/'

/** How far beyond the tracks a line is kept, so it still answers past the ends. */
const MARGIN_M = 500

export class KmLineError extends Error {
  constructor(code, lineNumber) {
    super(code)
    this.name = 'KmLineError'
    this.code = code
    this.lineNumber = lineNumber
  }
}

/** Where a file of the line data answers — the line files and the index beside them. */
export function kmDataUrl(file) {
  return new URL(`${BASE}${file}`, window.location.href)
}

/**
 * One line's file: { lineNumber, lineName?, crs, chainage: [[[lon, lat, km], …], …],
 * inDbNetwork: [true | false per run] } — see tools/km_network_status.py.
 */
export async function fetchKmLine(lineNumber) {
  const url = kmDataUrl(`${encodeURIComponent(lineNumber)}.json`)
  let response
  try {
    response = await fetch(url)
  } catch {
    throw new KmLineError('unavailable', lineNumber)
  }
  if (response.status === 404) throw new KmLineError('not_found', lineNumber)
  if (!response.ok) throw new KmLineError('unavailable', lineNumber)
  let data
  try {
    data = await response.json()
  } catch {
    throw new KmLineError('unavailable', lineNumber)   // the host's own error page
  }
  if (!Array.isArray(data?.chainage)) throw new KmLineError('unavailable', lineNumber)
  return data
}

/**
 * The box around a project's tracks, in degrees, widened by `margin` metres.
 * Returns null for a project that has no geometry yet.
 */
export function projectBox(tracks, margin = MARGIN_M) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity
  for (const track of tracks ?? []) {
    for (const [lon, lat] of track.coordinates ?? []) {
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
  }
  if (!Number.isFinite(minLon)) return null
  const dLat = margin / 111320
  const dLon = margin / (111320 * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180))
  return [minLon - dLon, minLat - dLat, maxLon + dLon, maxLat + dLat]
}

const contains = ([aMinLon, aMinLat, aMaxLon, aMaxLat], [minLon, minLat, maxLon, maxLat]) =>
  aMinLon <= minLon && aMinLat <= minLat && aMaxLon >= maxLon && aMaxLat >= maxLat

/**
 * The parts of `runs` inside `box`, each kept as its own run.
 *
 * A run leaving and re-entering the box becomes two, which costs nothing: runs
 * are independent, and the kilometrage of a point is read off whichever runs
 * closest to it. The vertex either side of a border comes along so the line
 * still reaches past it.
 */
export function clipRuns(runs, box) {
  const [minLon, minLat, maxLon, maxLat] = box
  const inside = ([lon, lat]) => lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
  const kept = []
  for (const run of runs ?? []) {
    let piece = null
    for (let i = 0; i < run.length; i++) {
      if (inside(run[i])) {
        if (!piece) piece = i > 0 ? [run[i - 1]] : []
        piece.push(run[i])
      } else if (piece) {
        piece.push(run[i])
        if (piece.length >= 2) kept.push(piece)
        piece = null
      }
    }
    if (piece && piece.length >= 2) kept.push(piece)
  }
  return kept
}

/**
 * Make sure the project holds the lines its tracks name, clipped to its own
 * extent — fetching what is missing and re-clipping what the tracks have since
 * grown out of. Lines no track names any more are dropped.
 *
 * @returns {Promise<{ added: string[], errors: Array<{ lineNumber, code }> }>}
 */
export async function ensureKmLines(projectId) {
  const tracks = loadTracks(projectId)
  const box = projectBox(tracks)
  const result = { added: [], errors: [] }
  if (!box) return result

  const wanted = new Set(
    tracks.map((t) => t.lineNumber).filter((n) => n != null && n !== '').map(String))
  const held = loadKmLines(projectId)

  for (const line of held) {
    if (!wanted.has(String(line.lineNumber))) deleteKmLine(projectId, line.lineNumber)
  }

  for (const lineNumber of wanted) {
    // Already there and still covering the tracks? Then there is nothing to do.
    const covering = held.filter((l) => String(l.lineNumber) === lineNumber)
    if (covering.length && covering.every((l) => l.clip && contains(l.clip, box))) continue

    let file
    try {
      file = await fetchKmLine(lineNumber)
    } catch (err) {
      result.errors.push({ lineNumber, code: err.code ?? 'unavailable' })
      continue
    }
    const clipped = clipRuns(file.chainage, box)
    if (clipped.length) {
      saveKmLine(projectId, {
        id: generateId(),
        lineNumber: file.lineNumber,
        crs: file.crs ?? 'EPSG:4326',
        clip: box,
        runs: clipped,
      })
      result.added.push(lineNumber)
    } else {
      result.errors.push({ lineNumber, code: 'out_of_range' })   // the line runs elsewhere entirely
    }
  }
  return result
}
