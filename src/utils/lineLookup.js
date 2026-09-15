import { fetchKmLine, clipRuns, kmDataUrl } from './kmLineSource'
import { planeRuns, kmOnRuns } from './kmLineUtils'
import { utmToWgs84 } from './coordinateUtils'
import { arcPlanePoints } from './elementUtils'

/**
 * Which line a track lies on, and what that makes its name.
 *
 * A new line track takes the number of the line closest to it as a whole, that
 * line's name, and a track name built from the kilometrage of its middle: a
 * track beside line 6340 whose middle lies at km 123,93 is `6340.12393`, on
 * "Halle (Saale) Hbf - Baunatal-Guntershausen".
 *
 * Two kinds of file next to the app answer that: `_index.json`, a grid saying
 * which lines run through which part of the country, so that only the lines
 * near a track are fetched; and the line files themselves, which distances
 * and kilometrage are measured against and which carry the line's name too
 * (see embed_line_names.py) — so naming a track costs nothing beyond the
 * fetch its kilometrage already needed.
 *
 * Everything measured is measured in the track's own plane, against the line
 * converted into it (see kmLineUtils). Degrees only ever select — the grid
 * cells and the box a line is clipped to.
 */

/** How far from a track a line may run and still be the one it lies on. */
const REACH_M = 500
/** Points along the track it is compared at — one per 10 m, up to this many. */
const MAX_SAMPLES = 64
/** Arcs are followed to this sagitta, far below the ten metres a name resolves. */
const ARC_SAGITTA = 0.5
/** Parsed line files kept at once; they run to a few megabytes each. */
const FILE_CACHE_SIZE = 24

// ── The data ────────────────────────────────────────────────────────────────

const lineFiles = new Map()   // line number → Promise<file | null>, least recently used first
let indexRequest = null

/** The index file, or null when it is not there — the lookup then simply fetches nothing. */
function loadIndex() {
  return (indexRequest ??= fetch(kmDataUrl('_index.json'))
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
    .catch((err) => {
      console.warn('[lineLookup] _index.json unavailable:', err.message ?? err)
      return null
    }))
}

function loadLineFile(lineNumber) {
  const key = String(lineNumber)
  let request = lineFiles.get(key)
  if (request) {
    lineFiles.delete(key)
  } else {
    request = fetchKmLine(key).catch((err) => {
      // A line that does not exist stays unknown; anything else is asked again.
      if (err.code !== 'not_found' && lineFiles.get(key) === request) lineFiles.delete(key)
      return null
    })
  }
  lineFiles.set(key, request)
  if (lineFiles.size > FILE_CACHE_SIZE) lineFiles.delete(lineFiles.keys().next().value)
  return request
}

// ── Track geometry ──────────────────────────────────────────────────────────

/**
 * The plane path of one element between two plane points: `{ epsg, path }`
 * with `path` as [[E, N], …] — the arc of `signedR`, or the chord without one.
 */
export function elementPath(startUtm, endUtm, signedR = null) {
  const arc = signedR ? arcPlanePoints(startUtm, endUtm, signedR, ARC_SAGITTA) : null
  return {
    epsg: startUtm.zone,
    path: arc ?? [[startUtm.easting, startUtm.northing], [endUtm.easting, endUtm.northing]],
  }
}

/**
 * The plane path of a chain of stored elements, or null without one. A
 * transition curve is taken as its chord: a few metres off at worst, which
 * neither changes the nearest line nor, halved at the middle, the name.
 */
export function elementsPath(elements, epsg) {
  const path = []
  for (const el of elements ?? []) {
    if (!Array.isArray(el.startNode) || !Array.isArray(el.endNode)) continue
    const start = { easting: el.startNode[0], northing: el.startNode[1], zone: epsg }
    const end   = { easting: el.endNode[0],   northing: el.endNode[1],   zone: epsg }
    const piece = elementPath(start, end, el.elementType === 2 ? null : el.radius).path
    path.push(...(path.length ? piece.slice(1) : piece))
  }
  return epsg && path.length >= 2 ? { epsg, path } : null
}

function cumulativeLengths(path) {
  const lengths = [0]
  for (let i = 1; i < path.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
  }
  return lengths
}

/** The point `distance` metres along `path`. */
function pointAlong(path, lengths, distance) {
  let i = 1
  while (i < path.length - 1 && lengths[i] < distance) i++
  const span = lengths[i] - lengths[i - 1]
  const f = span > 0 ? Math.min(1, Math.max(0, (distance - lengths[i - 1]) / span)) : 0
  return [path[i - 1][0] + f * (path[i][0] - path[i - 1][0]), path[i - 1][1] + f * (path[i][1] - path[i - 1][1])]
}

/** The box around `path` in degrees, `margin` metres wider on every side. */
function lookupBox(path, epsg, margin) {
  let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity
  for (const [e, n] of path) {
    if (e < minE) minE = e
    if (e > maxE) maxE = e
    if (n < minN) minN = n
    if (n > maxN) maxN = n
  }
  const corners = [[minE - margin, minN - margin], [maxE + margin, minN - margin],
    [minE - margin, maxN + margin], [maxE + margin, maxN + margin]]
    .map(([e, n]) => utmToWgs84(e, n, epsg))
  return [
    Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])),
    Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1])),
  ]
}

// ── The lookup ──────────────────────────────────────────────────────────────

async function lineNumbersIn(box) {
  const index = await loadIndex()
  if (!index?.cells || !Array.isArray(index.cell)) return []
  const [dLon, dLat] = index.cell
  const [minLon, minLat, maxLon, maxLat] = box
  const found = new Set()
  for (let x = Math.floor(minLon / dLon); x <= Math.floor(maxLon / dLon); x++) {
    for (let y = Math.floor(minLat / dLat); y <= Math.floor(maxLat / dLat); y++) {
      for (const number of index.cells[`${x},${y}`] ?? []) found.add(String(number))
    }
  }
  return [...found]
}

/** The runs of a line inside `box`, in the plane of `epsg`, and its name. */
async function lineDataIn(lineNumber, box, epsg) {
  const file = await loadLineFile(lineNumber)
  const clipped = clipRuns(file?.chainage, box)
  return { runs: clipped.length ? planeRuns({ runs: clipped }, epsg) : null, lineName: file?.lineName ?? null }
}

/**
 * The line `geometry` ({ epsg, path } in the track's plane) lies on:
 * `{ lineNumber, lineName, km, offset }`, or null where no line comes within
 * reach.
 *
 * The line is the one closest to the whole track — the mean distance of points
 * spread along all of it decides, so a line merely crossing the track, or
 * passing close by one end of it, does not win over the one it runs beside.
 * `km` is the kilometrage of the track's middle on that line.
 *
 * Given `lineNumber`, there is no choosing: that line is measured against, and
 * the answer comes back even where the line does not reach the track, with
 * `km` null — the number and its name are still what the user asked for.
 */
export async function identifyTrackLine(geometry, lineNumber = null) {
  const { epsg, path } = geometry ?? {}
  if (!epsg || !(path?.length >= 2)) return null
  const chosen = lineNumber != null && String(lineNumber) !== '' ? String(lineNumber) : null

  const box = lookupBox(path, epsg, REACH_M)
  const numbers = chosen ? [chosen] : await lineNumbersIn(box)
  const lineData = await Promise.all(numbers.map((number) => lineDataIn(number, box, epsg)))

  const lengths = cumulativeLengths(path)
  const total = lengths[lengths.length - 1]
  const count = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(total / 10) + 1))
  const samples = Array.from({ length: count }, (_, i) => pointAlong(path, lengths, (total * i) / (count - 1)))

  let best = null
  numbers.forEach((number, i) => {
    const { runs } = lineData[i]
    if (!runs) return
    let sum = 0
    for (const point of samples) sum += kmOnRuns(runs, point)?.offset ?? Infinity
    const offset = sum / samples.length
    if (best && !(offset < best.offset)) return
    best = { lineNumber: number, runs, offset }
  })

  if (!best || !(best.offset <= REACH_M)) {
    const idx = chosen ? numbers.indexOf(chosen) : -1
    return chosen ? { lineNumber: chosen, lineName: lineData[idx]?.lineName ?? null, km: null, offset: null } : null
  }
  const middle = kmOnRuns(best.runs, pointAlong(path, lengths, total / 2))
  return {
    lineNumber: best.lineNumber,
    lineName: lineData[numbers.indexOf(best.lineNumber)]?.lineName ?? null,
    km: middle?.km ?? null,
    offset: best.offset,
  }
}

/**
 * `6340.12393` — the line number and the kilometrage in steps of ten metres,
 * the first such name not among `takenNames`. A name already given moves on to
 * the next ten metres (`6340.12394`), so every name stays unique and still says
 * roughly where its track lies.
 */
export function kmTrackName(lineNumber, km, takenNames = []) {
  const taken = new Set(takenNames)
  let step = Math.round(km / 10)
  while (taken.has(`${lineNumber}.${step}`)) step++
  return `${lineNumber}.${step}`
}
