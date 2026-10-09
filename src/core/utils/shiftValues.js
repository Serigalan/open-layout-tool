import { elementPoints } from './commands/reconnect'
import { gradientAt } from './heightUtils'
import { DEFAULT_HEIGHT_EPSG } from './heightDatums'
import { referencePoints, axisRange } from './referenceAxis'

// Shift values (Verschiebewerte, Paket V): how far an axis lies from a
// reference axis, across and in height, at round stations of the reference
// (Entscheidung 194, 199). At station s the normal of the reference axis is
// cut with the compared axis within REACH: the shift across is the distance
// along the normal, positive to the right in the reference axis' direction;
// the lift is the compared gradient's height there minus the reference's,
// positive upwards. Computed in the browser — the connect dialogs ask on
// every move of the mouse.

/** How far from the reference axis the compared one is looked for [m]. */
const REACH = 2
/** The compared axis as a line: a vertex every this much [m]. */
const LINE_STEP = 0.25
const CELL = REACH

/**
 * The compared axis as the shift values read it: `elements` in the plane
 * `epsg`, a vertex every LINE_STEP or closer, each with its station along the
 * axis (from `station0` on) — and `heights` ([{ station, z, rv? }] in that
 * stationing) where its gradient is to be compared. { e, n, s, heights }.
 */
export function comparedLine(elements, epsg, { heights = null, station0 = 0 } = {}) {
  const e = [], n = [], s = []
  let start = station0
  for (const el of elements) {
    const len = el.length ?? 0
    if (!(len > 0)) continue
    const pts = elementPoints(el, epsg, LINE_STEP)
    const m = pts.length - 1
    for (let k = e.length ? 1 : 0; k <= m; k++) {
      e.push(pts[k][0]); n.push(pts[k][1]); s.push(start + len * k / m)
    }
    start += len
  }
  return { e, n, s, heights: heights?.length >= 2 ? heights : null }
}

/** The segments of a line by the grid cells their boxes touch. */
function segmentIndex(line) {
  const cells = new Map()
  for (let k = 0; k + 1 < line.e.length; k++) {
    const x0 = Math.floor(Math.min(line.e[k], line.e[k + 1]) / CELL), x1 = Math.floor(Math.max(line.e[k], line.e[k + 1]) / CELL)
    const y0 = Math.floor(Math.min(line.n[k], line.n[k + 1]) / CELL), y1 = Math.floor(Math.max(line.n[k], line.n[k + 1]) / CELL)
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x}|${y}`
        const list = cells.get(key)
        if (list) list.push(k)
        else cells.set(key, [k])
      }
    }
  }
  return cells
}

/** Whether the reference axis and the compared gradient are stated in one height system. */
export const heightsComparable = (axis, heightEpsg) => (
  !!axis?.points?.z && Number(axis.heightEpsg ?? DEFAULT_HEIGHT_EPSG) === Number(heightEpsg ?? DEFAULT_HEIGHT_EPSG)
)

/**
 * The shift values of `line` (comparedLine) against the reference axis
 * `axis`, every `every` metres of its stationing where its normal meets the
 * line within REACH: [{ station, dq, dz, zRef, at, hit, along }] — `dq`
 * across [m, right +], `dz` lift [m, up +] or null (no height on either side,
 * or `withHeights` false), `zRef` the reference axis' own height or null,
 * `at` the point on the reference axis and `hit` the one on the line [e, n],
 * `along` the station of the line there.
 */
export function shiftValues(axis, line, { every = 5, withHeights = true } = {}) {
  if (!axis || !line || line.e.length < 2) return []
  const ref = referencePoints(axis)
  const { from, to } = axisRange(axis)
  // Only where the line can be: its box, widened by REACH.
  let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity
  for (let k = 0; k < line.e.length; k++) {
    e0 = Math.min(e0, line.e[k]); e1 = Math.max(e1, line.e[k])
    n0 = Math.min(n0, line.n[k]); n1 = Math.max(n1, line.n[k])
  }
  e0 -= REACH; e1 += REACH; n0 -= REACH; n1 += REACH
  const cells = segmentIndex(line)
  const rows = []
  for (let st = Math.ceil(from / every - 1e-9) * every; st <= to + 1e-9; st += every) {
    const i = Math.round((st - ref.s0) / ref.step)
    if (i < 0 || i >= ref.count) continue
    const pe = ref.e[i], pn = ref.n[i]
    if (pe < e0 || pe > e1 || pn < n0 || pn > n1) continue
    // The tangent over the neighbouring points, a centimetre either side.
    const a = Math.max(0, i - 1), b = Math.min(ref.count - 1, i + 1)
    let te = ref.e[b] - ref.e[a], tn = ref.n[b] - ref.n[a]
    const tl = Math.hypot(te, tn)
    if (!(tl > 0)) continue
    te /= tl; tn /= tl
    const re = tn, rn = -te          // the normal to the right
    const cx = Math.floor(pe / CELL), cy = Math.floor(pn / CELL)
    let best = null
    const seen = new Set()
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const k of cells.get(`${x}|${y}`) ?? []) {
          if (seen.has(k)) continue
          seen.add(k)
          // P + u·r = A + λ·(B − A)
          const ae = line.e[k], an = line.n[k]
          const de = line.e[k + 1] - ae, dn = line.n[k + 1] - an
          const den = re * dn - rn * de
          if (Math.abs(den) < 1e-12) continue
          const qe = ae - pe, qn = an - pn
          const u = (qe * dn - qn * de) / den
          const lam = (qe * rn - qn * re) / den
          if (lam < -1e-9 || lam > 1 + 1e-9 || Math.abs(u) > REACH) continue
          if (!best || Math.abs(u) < Math.abs(best.u)) best = { u, k, lam }
        }
      }
    }
    if (!best) continue
    const { u, k, lam } = best
    const along = line.s[k] + (line.s[k + 1] - line.s[k]) * lam
    const zRef = ref.z && Number.isFinite(ref.z[i]) ? ref.z[i] : null
    let dz = null
    if (withHeights && line.heights && zRef != null) {
      const zc = gradientAt(line.heights, along)
      if (zc != null) dz = zc - zRef
    }
    rows.push({ station: Math.round(st * 1000) / 1000, dq: u, dz, zRef, at: [pe, pn], hit: [pe + u * re, pn + u * rn], along })
  }
  return rows
}

/**
 * The reference axis' gradient over the stationing of the compared line, as
 * its Höhenplan draws it: the `rows` (shiftValues, every `every` metres) that
 * have a reference height, in the order of the line's station, in runs broken
 * where the line leaves the axis for more than two steps. Each point
 * { s, z, dz }: the line's station, the reference height there and the line's
 * gradient `heights` minus it [m, up +] — null where the line has none.
 */
export function referenceProfile(rows, heights, every) {
  const withHeights = heights?.length >= 2
  const pts = rows.filter(r => r.zRef != null).map(r => {
    const zc = withHeights ? gradientAt(heights, r.along) : null
    return { s: r.along, z: r.zRef, dz: zc == null ? null : zc - r.zRef }
  }).sort((a, b) => a.s - b.s)
  const runs = []
  let run = null
  for (const p of pts) {
    if (!run || p.s - run[run.length - 1].s > 2.5 * every) runs.push(run = [])
    run.push(p)
  }
  return runs
}

/** The lift at the line's station `s` (referenceProfile runs), read off linearly — null off the runs. */
export function deviationAt(runs, s) {
  for (const run of runs) {
    if (s < run[0].s || s > run[run.length - 1].s) continue
    const k = run.findIndex(p => p.s >= s)
    const b = run[k], a = run[Math.max(0, k - 1)]
    if (a.dz == null || b.dz == null) return null
    return b.s > a.s ? a.dz + (b.dz - a.dz) * (s - a.s) / (b.s - a.s) : b.dz
  }
  return null
}

/**
 * What a table of shift values comes to: the largest to the right and to the
 * left, the largest lift and drop, each with its row — and how many rows lie
 * beyond the limits [m] (`limitQ` across, `limitZ` in height).
 */
export function shiftSummary(rows, { limitQ = Infinity, limitZ = Infinity } = {}) {
  const pick = (key, better) => rows.reduce((acc, r) => (r[key] != null && better(r[key], acc?.[key] ?? 0) ? r : acc), null)
  return {
    right: pick('dq', (v, w) => v > w),
    left: pick('dq', (v, w) => v < w),
    up: pick('dz', (v, w) => v > w),
    down: pick('dz', (v, w) => v < w),
    beyondQ: rows.filter(r => Math.abs(r.dq) > limitQ + 1e-9).length,
    beyondZ: rows.filter(r => r.dz != null && Math.abs(r.dz) > limitZ + 1e-9).length,
    heights: rows.some(r => r.dz != null),
  }
}

/**
 * The reference axis a line is compared with by default: of `axes` in its
 * plane `epsg`, the one it runs along the furthest — null where it runs along none.
 */
export function nearestAxis(axes, line, epsg) {
  let best = null, hits = 0
  for (const axis of axes ?? []) {
    if (Number(axis.epsg) !== Number(epsg)) continue
    const n = shiftValues(axis, line, { every: 10, withHeights: false }).length
    if (n > hits) { best = axis; hits = n }
  }
  return best
}

/** The rows as a CSV file's text: station, across and lift in mm, both points. */
export function shiftValuesCsv(rows, { axisName = '', lineName = '' } = {}) {
  const mm = (v) => (v == null ? '' : String(Math.round(v * 1000)))
  const head = [`# Verschiebewerte ${lineName} gegen Bestandsachse ${axisName}; quer rechts +, Höhe oben + [mm]`,
    'Station;Quer;Hoehe;Rechtswert_Bestand;Hochwert_Bestand;Rechtswert_neu;Hochwert_neu']
  return [...head, ...rows.map(r => [r.station.toFixed(3), mm(r.dq), mm(r.dz),
    r.at[0].toFixed(3), r.at[1].toFixed(3), r.hit[0].toFixed(3), r.hit[1].toFixed(3)].join(';'))].join('\n') + '\n'
}
