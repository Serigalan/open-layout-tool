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
 * that both fail is not seen — at a metre, nothing a slider could be put on.
 */
export function validIntervals(valid, from, to, step = 1) {
  if (!(to >= from)) return []
  const n = Math.max(1, Math.ceil((to - from) / step))
  const at = (i) => from + (to - from) * i / n
  const edge = (bad, good) => {
    while (Math.abs(good - bad) > EDGE_TOL) {
      const m = (bad + good) / 2
      if (valid(m)) good = m; else bad = m
    }
    return good
  }
  const out = []
  let prev = null, prevOk = false, start = null
  for (let i = 0; i <= n; i++) {
    const s = at(i)
    const ok = valid(s)
    if (ok && !prevOk) start = prev == null ? s : edge(prev, s)
    if (!ok && prevOk) out.push([start, edge(s, prev)])
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
