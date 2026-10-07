import { transitionCantEnds } from './clothoidUtils'

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
