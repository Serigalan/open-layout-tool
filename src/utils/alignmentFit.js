import { generateId } from './identifierUtils'
import { recalcAbsLengths, rebuildCoords } from './trackModel'
import { reconstructElements } from './elementReconstruct'
import { crsName } from './coordinateUtils'
import { surveyPoints } from './axisSurvey'

// An alignment from measured axis points (AP 12.5, Entscheidungen 133, 134,
// 138): what the panel sends the service, what it makes of the point file the
// points may come in, and the new track it builds from the answer. The fit
// itself — curvature, straights, curves — is the service's
// (olt_optimizer/alignment_fit.py) and nowhere else.

/**
 * The settings of the straight search as the panel shows them: lengths in
 * metres, the two small ones in millimetres. `alignRequest` turns them into
 * the service's metres.
 */
export const ALIGN_DEFAULTS = Object.freeze({
  window: 6, toleranceMm: 10, step: 0.5, spacing: 6, sagittaMm: 3, minLength: 20,
})

/** The axis points of a survey, as the fit reads them. */
export const surveyAxis = (survey) => surveyPoints(survey).map(({ station, easting, northing }) => ({ station, easting, northing }))

const HEADER_NAMES = {
  station: /^(station|stat|km|s)\b/i,
  easting: /^(rechtswert|rechts|easting|ost|east|e|y)\b/i,
  northing: /^(hochwert|hoch|northing|nord|north|n|x)\b/i,
}

const number = (text) => Number(String(text).trim().replace(/\s/g, ''))

/**
 * A point file of axis points (Entscheidung 138): the export of stage A —
 * `Nr;Station [m];Rechtswert [m];Hochwert [m];SO [m];Überhöhung [mm];Güte` —
 * or one from elsewhere with a header naming Rechtswert and Hochwert (or
 * Easting/Northing), or without a header: easting and northing first, or
 * after a running number. Semicolons, commas, tabs or blanks between the
 * columns; with semicolons a decimal comma is read too. The plane comes from
 * the file name where it says `EPSG<code>`, as the export names its files.
 *
 * Returns { points: [{ station, easting, northing }], epsg } or { error } with
 * a locale key.
 */
export function parseAxisPointFile(text, fileName = '') {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  if (!lines.length) return { error: 'align_file_empty' }
  const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : /\s+/
  const split = (line) => line.split(sep).map(c => (sep === ';' ? c.replace(',', '.') : c).trim())
  let rows = lines.map(split)
  const header = rows[0].some(c => /[a-zäöü]/i.test(c) && !Number.isFinite(number(c))) ? rows.shift() : null
  let col
  if (header) {
    const find = (re) => header.findIndex(h => re.test(h.replace(/^["']|["']$/g, '')))
    col = { station: find(HEADER_NAMES.station), easting: find(HEADER_NAMES.easting), northing: find(HEADER_NAMES.northing) }
    if (col.easting < 0 || col.northing < 0) return { error: 'align_file_columns' }
  } else {
    // A running number first is a counter, not a coordinate.
    const counter = rows.length > 1 && rows.slice(0, 5).every((r, i) => number(r[0]) === number(rows[0][0]) + i)
    col = counter ? { station: -1, easting: 1, northing: 2 } : { station: -1, easting: 0, northing: 1 }
  }
  rows = rows.filter(r => Number.isFinite(number(r[col.easting])) && Number.isFinite(number(r[col.northing])))
  if (rows.length < 10) return { error: 'align_file_few_points' }
  let along = 0
  const points = rows.map((r, i) => {
    const easting = number(r[col.easting]), northing = number(r[col.northing])
    if (i > 0) along += Math.hypot(easting - number(rows[i - 1][col.easting]), northing - number(rows[i - 1][col.northing]))
    const station = col.station >= 0 ? number(r[col.station]) : along
    return { station: Number.isFinite(station) ? station : along, easting, northing }
  })
  const code = Number(/EPSG[_ -]?(\d{4,5})/i.exec(fileName)?.[1])
  return { points, epsg: crsName(code) ? code : null }
}

/**
 * The request for the service's `POST /align`: the points in travel order,
 * the station the first one has, the straights set by hand (null to have them
 * searched for) and the settings in metres.
 */
export function alignRequest(points, { straights = null, settings = ALIGN_DEFAULTS } = {}) {
  return {
    points: points.map(p => [p.easting, p.northing]),
    station0: points[0]?.station ?? 0,
    straights,
    settings: {
      window: Number(settings.window), step: Number(settings.step), spacing: Number(settings.spacing),
      minLength: Number(settings.minLength),
      tolerance: Number(settings.toleranceMm) / 1000, sagitta: Number(settings.sagittaMm) / 1000,
    },
  }
}

const curvatureOf = (r) => (r ? 1 / r : 0)

/**
 * The curvature the fitted chain has, element by element, for the diagram:
 * [{ from, to, k1, k2 }] in stations of the points — a straight 0, an arc
 * 1/R, a transition a ramp between the curvatures of its ends.
 */
export function fittedCurvature(answer) {
  const at = answer?.elementStations
  if (!answer?.elements || !at) return []
  return answer.elements.map((el, i) => {
    const k1 = el.elementType === 1 ? curvatureOf(el.radius) : el.elementType === 2 ? curvatureOf(el.r1) : 0
    const k2 = el.elementType === 1 ? k1 : el.elementType === 2 ? curvatureOf(el.r2) : 0
    return { from: at[i], to: at[i + 1], k1, k2 }
  })
}

/**
 * Per element of the answer what the report shows: its kind, length and
 * radii, the largest and the RMS offset of the points on it, and whether it
 * is over the tolerance [m] — or has no points on it to judge it by.
 */
export function elementReport(answer, tolerance) {
  return (answer?.elements ?? []).map((el, i) => {
    const st = answer.elementStats?.[i] ?? {}
    return {
      index: i, elementType: el.elementType, length: el.length,
      radius: el.radius ?? null, r1: el.r1 ?? null, r2: el.r2 ?? null,
      from: answer.elementStations?.[i], to: answer.elementStations?.[i + 1],
      n: st.n ?? 0, max: st.max ?? null, rms: st.rms ?? null,
      over: st.max != null && st.max > tolerance,
    }
  })
}

/**
 * The new track the fit is taken over as (Entscheidung 134): in the plane of
 * the points, named "<axis> Ist", standing (Bestand). Speed and cant are not
 * the points' to say — the elements start without them, like an import.
 */
export function trackFromFit(answer, { name, epsg, newId = generateId }) {
  if (!answer?.elements?.length) return null
  const plane = Number(epsg)
  const rebuilt = reconstructElements(answer.elements.map(el => ({ ...el, epsg: plane, speed: 0 })), plane)
  const elements = recalcAbsLengths(rebuilt)
  return {
    id: newId(), epsg: plane, name, status: 'existing',
    elements, coordinates: rebuildCoords(elements),
  }
}

/** Straights in the answer's form ({ from, to }) as the request takes them. */
export const straightRanges = (straights) => (straights ?? []).map(s => [s.from, s.to])

// ── Straights by hand (Entscheidung 133) ────────────────────────────────────

/** The shortest straight the diagram lets one draw or drag to [m]. */
const MIN_HAND_STRAIGHT = 2

/**
 * One end (`side` 'from' | 'to') of straight `i` moved to station `at`, held
 * off its other end by MIN_HAND_STRAIGHT and off its neighbours by a metre.
 */
export function moveStraightEnd(straights, i, side, at) {
  const s = straights[i]
  const prev = straights[i - 1], next = straights[i + 1]
  const value = side === 'from'
    ? Math.min(Math.max(at, prev ? prev.to + 1 : -Infinity), s.to - MIN_HAND_STRAIGHT)
    : Math.max(Math.min(at, next ? next.from - 1 : Infinity), s.from + MIN_HAND_STRAIGHT)
  return straights.map((x, k) => (k === i ? { ...x, [side]: value } : x))
}

/** A straight drawn from `a` to `b` added in order; what it overlaps it takes in. Null if too short. */
export function insertStraight(straights, a, b) {
  const from = Math.min(a, b), to = Math.max(a, b)
  if (to - from < MIN_HAND_STRAIGHT) return null
  const keep = straights.filter(s => s.to < from || s.from > to)
  const taken = straights.filter(s => !(s.to < from || s.from > to))
  const merged = {
    from: Math.min(from, ...taken.map(s => s.from)),
    to: Math.max(to, ...taken.map(s => s.to)),
  }
  return [...keep, merged].sort((x, y) => x.from - y.from)
}

/** Straight `i` taken out. */
export const deleteStraight = (straights, i) => straights.filter((_, k) => k !== i)
