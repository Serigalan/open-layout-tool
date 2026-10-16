// The position slider of the switch dialogs (Entscheidungen 309–311): a
// station in metres from the track's begin, typed or dragged. Dragged it runs
// finely over the stretches where the turnout or crossing may lie and skips
// the rest, and it snaps onto the stations where one of its ends falls on an
// element change.

/** Below this two edges of a valid stretch are found [m]. */
const EDGE_TOL = 1e-4

/**
 * The stretches of [from, to] where `valid(station)` holds, as [[a, b], …]
 * ascending: sampled every `step` metres, each edge then halved down to a
 * tenth of a millimetre. A stretch shorter than the step between two samples
 * that both fail is not seen, unless it is one of `points` (the snap points),
 * which are asked on their own.
 */
export function validIntervals(valid, from, to, step = 1, points = []) {
  if (!(to >= from)) return []
  const sampled = sampledIntervals(valid, from, to, step)
  // A valid point between two samples that fail — a toe right on an element
  // change, with l_min to either side — is a stretch of its own.
  const inside = (p) => sampled.some(([a, b]) => p >= a - 1e-9 && p <= b + 1e-9)
  const lone = points.filter(p => p >= from && p <= to && !inside(p) && valid(p)).map(p => [p, p])
  return [...sampled, ...lone].sort((x, y) => x[0] - y[0])
}

function sampledIntervals(valid, from, to, step) {
  const n = Math.max(1, Math.ceil((to - from) / step))
  const at = (i) => from + (to - from) * i / n
  const edge = (bad, good) => {
    while (Math.abs(good - bad) > EDGE_TOL) {
      const m = (bad + good) / 2
      if (valid(m)) good = m; else bad = m
    }
    return good
  }
  // Ends rounded inwards to the millimetre, where they stay valid: the field
  // shows a station to the tenth of a millimetre, and an edge found to that
  // would round onto the side where the turnout may not lie.
  const inward = (x, up) => {
    const r = up ? Math.ceil(x * 1000 - 1e-6) / 1000 : Math.floor(x * 1000 + 1e-6) / 1000
    return valid(r) ? r : x
  }
  const out = []
  let prev = null, prevOk = false, start = null
  for (let i = 0; i <= n; i++) {
    const s = at(i)
    const ok = valid(s)
    if (ok && !prevOk) start = prev == null ? s : inward(edge(prev, s), true)
    if (!ok && prevOk) out.push([start, inward(edge(s, prev), false)])
    prev = s
    prevOk = ok
  }
  if (prevOk) out.push([start, to])
  return out
}

/** The nearest station to `s` inside one of `intervals` — `s` itself where it lies in one; null where there are none. */
export function nearestValid(s, intervals) {
  let best = null
  for (const [a, b] of intervals) {
    const c = Math.min(b, Math.max(a, s))
    if (best == null || Math.abs(c - s) < Math.abs(best - s)) best = c
  }
  return best
}

/**
 * Where a dragged station settles: on the nearest snap point within `tol`,
 * if that one is valid, else on the nearest valid station.
 */
export function settleStation(s, { intervals, snaps = [], tol = 1 }) {
  let snap = null
  for (const p of snaps) {
    if (Math.abs(p - s) <= tol && (snap == null || Math.abs(p - s) < Math.abs(snap - s))) snap = p
  }
  const inside = (p) => intervals.some(([a, b]) => p >= a - 1e-9 && p <= b + 1e-9)
  if (snap != null && inside(snap)) return snap
  return nearestValid(s, intervals)
}

/** Stations rounded to a tenth of a millimetre and once each, ascending. */
export const uniqueStations = (list) =>
  [...new Set(list.filter(Number.isFinite).map(s => Math.round(s * 1e4) / 1e4))].sort((a, b) => a - b)
