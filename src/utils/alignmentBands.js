import { transitionCantEnds } from './clothoidUtils'
import { worstSeverity } from './regelkatalog'
import { clampCant } from './rules/cant'

// The bands of a track drawn under each other over its station: curvature,
// cant and speed, each a polyline of { s, v } — a value of null breaks it.
// Where a value jumps at a joint, the line has two points at that station and
// draws the step.

// Points a Bloss transition is drawn with: its curvature is a cubic.
const BLOSS_STEPS = 16

/**
 * Where each element of a track begins and ends: [{ el, elIdx, from, to }].
 */
export function elementSpans(elements) {
  let s = 0
  return (elements ?? []).map((el, elIdx) => {
    const from = s
    s += el.length ?? 0
    return { el, elIdx, from, to: s }
  })
}

/**
 * Curvature [1/km], signed as the store signs a radius: a right curve (R > 0)
 * is positive and drawn above the zero line, a left one below — the way the
 * DB Lageplan's Krümmungsband has it. A transition runs between the curvature
 * of its ends, linearly as a clothoid, as the cubic of Bloss.
 */
const curvatureOf = (r) => (r ? 1000 / r : 0)

export function curvatureBand(elements) {
  const out = []
  for (const { el, from, to } of elementSpans(elements)) {
    if (el.elementType === 2) {
      const k1 = curvatureOf(el.r1), k2 = curvatureOf(el.r2)
      if (el.transitionType === 'bloss') {
        for (let i = 0; i <= BLOSS_STEPS; i++) {
          const t = i / BLOSS_STEPS
          out.push({ s: from + t * (to - from), v: k1 + (k2 - k1) * (3 * t * t - 2 * t * t * t) })
        }
      } else {
        out.push({ s: from, v: k1 }, { s: to, v: k2 })
      }
    } else {
      const k = curvatureOf(el.radius)
      out.push({ s: from, v: k }, { s: to, v: k })
    }
  }
  return out
}

/**
 * Cant [mm], signed as the store signs it: positive raises the left rail —
 * the outer rail of a right curve — so it is drawn above the zero line like
 * the curvature it goes with. A transition ramps between its ends' cant
 * (transitionCantEnds), linearly, as the cross section reads it.
 */
export function cantBand(elements) {
  const out = []
  for (const { el, elIdx, from, to } of elementSpans(elements)) {
    if (el.elementType === 2) {
      const { start, end } = transitionCantEnds(elements, elIdx)
      out.push({ s: from, v: start ?? 0 }, { s: to, v: end ?? 0 })
    } else {
      out.push({ s: from, v: el.cant ?? 0 }, { s: to, v: el.cant ?? 0 })
    }
  }
  return out
}

/**
 * Design speed [km/h] of every element, a step at each change. An element
 * without one breaks the line.
 */
export function speedBand(elements) {
  const out = []
  for (const { el, from, to } of elementSpans(elements)) {
    const v = el.speed > 0 ? el.speed : null
    out.push({ s: from, v }, { s: to, v })
  }
  return out
}

/**
 * The value of a band at station `s`: interpolated along the line, the later
 * point of a step where two share the station — the value that holds from
 * there on. Null off the line or where it is broken.
 */
export function bandValueAt(band, s) {
  if (!band.length || s < band[0].s || s > band[band.length - 1].s) return null
  for (let i = band.length - 1; i > 0; i--) {
    const a = band[i - 1], b = band[i]
    if (s < a.s) continue
    if (a.v == null || b.v == null) return null
    if (b.s - a.s <= 0) return b.v
    return a.v + (b.v - a.v) * (s - a.s) / (b.s - a.s)
  }
  return band[0].v
}

/**
 * Runs of equal value along a band, for labelling it: [{ from, to, v }] for
 * each stretch the value stays the same over (to the tolerance `eps`), a
 * stretch with no value left out. Neighbouring elements of one value are one
 * run.
 */
export function bandRuns(band, eps = 1e-9) {
  const runs = []
  for (let i = 1; i < band.length; i++) {
    const a = band[i - 1], b = band[i]
    if (a.v == null || b.v == null || b.s - a.s <= 0 || Math.abs(a.v - b.v) > eps) continue
    const last = runs[runs.length - 1]
    if (last && Math.abs(last.to - a.s) < 1e-6 && Math.abs(last.v - a.v) <= eps) last.to = b.s
    else runs.push({ from: a.s, to: b.s, v: a.v })
  }
  return runs
}

/** The smallest and largest value of a band, or null for a band without any. */
export function bandRange(band) {
  const vs = band.map(p => p.v).filter(v => v != null)
  return vs.length ? [Math.min(...vs), Math.max(...vs)] : null
}

// ── What the rules say, by band ──────────────────────────────────────────────

// The band a finding of the alignment catalogue is shown in: the quantity the
// rule is about. The cant deficiency is a matter of cant and speed alike, so
// it stands in both.
const RULE_BANDS = [
  [/^LP\.ALL\./, ['speed']],
  [/^LP\.KB\.0[26]$/, ['cant', 'speed']],
  [/^LP\.KB\./, ['cant']],
  [/^LP\.UB\.0[1278]$/, ['cant']],
  [/^LP\.UB\./, ['curvature']],
  [/^LP\.EL\./, ['curvature']],
  [/^LP\.KS\./, ['curvature']],
]

/** The bands a rule's findings are shown in (none for an unknown one). */
function bandsOfRule(id) {
  return RULE_BANDS.find(([re]) => re.test(id))?.[1] ?? []
}

const flagged = (r) => r.severity && r.severity !== 'ok'

/**
 * The findings of checkTrack, sorted onto the bands: per band `spans` — the
 * element's own and its ramp's, over the element — and `joints` — a boundary
 * rule's, at the joint after element `index`. Each with its results and the
 * worst severity among them; only what a rule flagged.
 */
export function bandFindings(check) {
  const out = Object.fromEntries(['curvature', 'cant', 'speed'].map(b => [b, { spans: [], joints: [] }]))
  const add = (kind, index, results) => {
    for (const band of Object.keys(out)) {
      const own = results.filter(r => flagged(r) && bandsOfRule(r.id).includes(band))
      if (own.length) out[band][kind].push({ index, results: own, severity: worstSeverity(own.map(r => r.severity)) })
    }
  }
  const rampAt = new Map((check.ramps ?? []).map(r => [r.index, r]))
  for (const e of check.elements ?? []) add('spans', e.index, [...(e.results ?? []), ...(rampAt.get(e.index)?.results ?? [])])
  for (const b of check.boundaries ?? []) add('joints', b.index, b.results ?? [])
  return out
}

// ── Values set in a band ─────────────────────────────────────────────────────

/**
 * Can `el` take a value typed in this band? Any element a speed; a cant only
 * a straight or an arc — a transition carries none of its own, it ramps
 * between the cant of the elements it joins.
 */
export const bandEditable = (band, el) =>
  (band === 'speed' || (band === 'cant' && el?.elementType !== 2))

/**
 * The elements with `value` set in `band` on those at `indices` that can take
 * it (bandEditable) — under the rules the element table writes by: the speed
 * not below 0, the cant on its design step, within its element's limit and
 * signed by the curve (clampCant). The cant is typed as a magnitude; a
 * straight keeps the side it had. An empty value (null) clears the field: an
 * unknown speed, no cant. Elements left as they were are returned as they are.
 */
export function withBandValue(elements, indices, band, value) {
  const at = new Set(indices)
  return elements.map((el, i) => {
    if (!at.has(i) || !bandEditable(band, el)) return el
    const { [band]: _old, ...rest } = el
    if (value == null) return rest
    if (band === 'speed') return { ...el, speed: Math.max(0, value) }
    const typed = (el.radius ? 1 : (Math.sign(el.cant ?? 0) || 1)) * Math.abs(value)
    return { ...el, cant: clampCant(typed, el) }
  })
}
