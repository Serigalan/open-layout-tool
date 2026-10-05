import { RAILS, TRACK_GAUGE } from '../crossSectionUtils'

/**
 * The two rail heads of a track in one slice of a point cloud (phase 12,
 * Entscheidungen 128–131). The slice is what a cross section reads
 * (cloudSectionPoints): points as (y across, z up), y to the right of the
 * running direction.
 *
 * A track is found by its flangeways: on the inner side of each head the
 * surface drops away — the wheel's flange runs there, so nothing may stand in
 * it — and the two drops face each other at the gauge, 1435 mm. The outer side
 * of a head is no help: a mobile scanner sees it from the side, its edge
 * smears into ghost points at nearly the head's height, and cable troughs or
 * heaped ballast lean against it.
 *
 * Each head's inner flank is then measured as the vertical face it shows
 * 20–35 mm under its top (the gauge is defined 14 mm under SO; GAUGE_BAND
 * says why the band lies lower). The head centre is the
 * flank plus half the nominal head width, and the axis point the middle
 * between the two centres (Entscheidung 128). For the axis the nominal width
 * drops out — it is the middle between the flanks — so a head that appears
 * narrower in the cloud than drawn costs nothing.
 *
 * Pure geometry on the slice; reading it and walking along a track is
 * railTrace's job.
 */

/** Column width the top surface is sampled in [m]. */
const COLUMN = 0.01
/** The top surface is looked for this far above the slice's ground [m]. */
const BAND_ABOVE_GROUND = 0.8
/** The flangeway looked at beside an edge [m]: from, to. */
const FLANGEWAY = [0.015, 0.05]
/** How far the flangeway lies under the head's top, at least [m]. */
const MIN_DROP = 0.03
/** How flat the head's top must be over its width, at most [m]. */
const HEAD_FLATNESS = 0.02
/**
 * Band under a head's top its flank is measured in [m]. The gauge is defined
 * 14 mm under SO; in a scan the rounded edge scatters down to some 20 mm under
 * the top seen (which noise lifts by a few mm), and the flank shows as a clean
 * vertical face only below that. Its slope of 1:20 makes the difference to
 * 14 mm less than a millimetre.
 */
const GAUGE_BAND = [0.020, 0.035]
/** Flank points a head shows at least in a slice for its flank to count. */
const MIN_FLANK_POINTS = 3
/**
 * Gauge tolerance [m]: narrower and wider than nominal, and the slack two
 * edges found on the 1-cm columns are paired with. Wider allows for
 * Spurerweiterung; narrower for the scan — in the sample cloud the flanks
 * measure a steady ~10 mm narrower than 1435 mm, whether the track or the
 * scanner is the cause. The axis does not care: it is the middle.
 */
const GAUGE_NARROW = 0.015
const GAUGE_WIDE   = 0.025
const COLUMN_SLACK = 0.015
/** Allowance on a worn rail's height over the ground [m] — the ground is a quantile. */
const HEIGHT_SLACK = 0.01
/** Largest height difference of the two heads still taken for cant [m]. */
const MAX_CANT = 0.2

/** The rail profile a detection works with, `RAILS` key or the default. */
export const railProfile = (rail) => RAILS[rail] ?? RAILS['54E4']

const quantile = (sorted, p) => sorted.length
  ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]
  : NaN

/**
 * Highest point of every 1-cm column between `from` and `to` [m], within the
 * band above the slice's ground — so a roof or a gantry over the track does
 * not hide the rails. `{ from, tops, ground }`, tops[c] NaN where a column is
 * empty; column c is centred on from + c·COLUMN.
 */
export function topSurface(points, from, to) {
  const zs = []
  for (let k = 0; k < points.count; k++) {
    const y = points.y[k]
    if (y >= from && y <= to) zs.push(points.z[k])
  }
  zs.sort((a, b) => a - b)
  const ground = quantile(zs, 0.05)
  const ceiling = ground + BAND_ABOVE_GROUND
  const tops = new Float64Array(Math.ceil((to - from) / COLUMN) + 1).fill(NaN)
  for (let k = 0; k < points.count; k++) {
    const y = points.y[k], z = points.z[k]
    if (y < from || y > to || z > ceiling) continue
    const c = Math.round((y - from) / COLUMN)
    if (!(tops[c] >= z)) tops[c] = z
  }
  return { from, tops, ground }
}

/** Column tops between y `a` and `b`, NaN dropped, sorted. */
function columns({ from, tops }, a, b) {
  const out = []
  const c0 = Math.max(0, Math.ceil((a - from) / COLUMN - 1e-9))
  const c1 = Math.min(tops.length - 1, Math.floor((b - from) / COLUMN + 1e-9))
  for (let c = c0; c <= c1; c++) if (!Number.isNaN(tops[c])) out.push(tops[c])
  return out.sort((x, y) => x - y)
}

/**
 * Where a head's inner edge may be: the surface a head wide on one side is
 * flat and high, and drops by MIN_DROP into a flangeway on the other.
 * `side` +1 finds the inner edges of left heads (the drop to the right), −1
 * those of right heads. `[{ y, z, drop }]`, y the edge between two columns,
 * z the head's top; the deepest drop within 5 cm.
 */
export function edgeCandidates(surface, from, to, headWidth, side) {
  const raw = []
  for (let c = 0; c < surface.tops.length - 1; c++) {
    const y = surface.from + (c + 0.5) * COLUMN   // between column c and c+1
    if (y < from || y > to) continue
    const head = side > 0
      ? columns(surface, y - headWidth + COLUMN, y)
      : columns(surface, y, y + headWidth - COLUMN)
    if (head.length < Math.round(headWidth / COLUMN) - 2) continue
    const z = quantile(head, 0.5)
    if (z - head[0] > HEAD_FLATNESS) continue
    const flange = side > 0
      ? columns(surface, y + FLANGEWAY[0], y + FLANGEWAY[1])
      : columns(surface, y - FLANGEWAY[1], y - FLANGEWAY[0])
    if (flange.length < 2) continue
    const drop = z - flange[flange.length - 1]
    if (drop >= MIN_DROP) raw.push({ y, z, drop })
  }
  raw.sort((a, b) => b.drop - a.drop)
  const out = []
  for (const e of raw) if (out.every(o => Math.abs(o.y - e.y) >= 0.05)) out.push(e)
  return out.sort((a, b) => a.y - b.y)
}

/**
 * The inner flank of a head near `edge` (its y on the columns), measured on
 * the points GAUGE_BAND under the head's top `z`: their median across.
 * `{ y, points }` or null where the flank was not seen.
 */
export function innerFlank(points, edge, z) {
  const ys = []
  for (let k = 0; k < points.count; k++) {
    const y = points.y[k], d = z - points.z[k]
    if (Math.abs(y - edge) <= 0.025 && d >= GAUGE_BAND[0] && d <= GAUGE_BAND[1]) ys.push(y)
  }
  if (ys.length < MIN_FLANK_POINTS) return null
  ys.sort((a, b) => a - b)
  return { y: quantile(ys, 0.5), points: ys.length }
}

/** The top of a head: the median of the column tops over its middle 5 cm. */
const headTop = (surface, y, fallback) => {
  const top = columns(surface, y - 0.025, y + 0.025)
  return top.length ? quantile(top, 0.5) : fallback
}

/** One head of a pair, from its edge candidate. */
function locateHead(points, surface, cand, side, headWidth) {
  const flank = innerFlank(points, cand.y, cand.z)
  const edge = flank?.y ?? cand.y
  const y = edge - side * headWidth / 2
  return { y, z: headTop(surface, y, cand.z), edge, flankPoints: flank?.points ?? 0 }
}

/**
 * The track in a slice: `{ left, right, axis, gauge, cant, quality }` or
 * `{ reason }` when there is none.
 *
 * - `points`: the slice (`{ count, y, z }`, y [m] to the right).
 * - `around`, `window`: where the axis is expected [m across] and how far off
 *   it may be — the guide's.
 * - `rail`: the profile (`RAILS` key) the track is laid with.
 *
 * `left` and `right` are the heads `{ y, z, edge, flankPoints }` seen in the
 * running direction — centre, top, inner flank; `axis` the middle between
 * the centres [m across]; `gauge` the distance of the flanks [m]; `cant` the
 * left head's height over the right one's [m, positive = left raised].
 * `quality`: 'good', or 'doubtful' when a flank was not seen (the edge is
 * then only known to the column) or the gauge is outside its tolerance.
 */
export function detectTrack(points, { around = 0, window = 0.3, rail } = {}) {
  const profile = railProfile(rail)
  const headWidth = profile.head / 1000
  // A head stands at least a worn rail's height over the ground beside the
  // track — the sleeper, the slab or the ballast lie lower still.
  const minHeight = profile.heightWorn / 1000 - HEIGHT_SLACK
  const gaugeNominal = TRACK_GAUGE / 1000
  const reach = window + gaugeNominal / 2 + GAUGE_WIDE + headWidth + FLANGEWAY[1] + 0.03
  const surface = topSurface(points, around - reach, around + reach)
  const lefts  = edgeCandidates(surface, around - reach, around + reach, headWidth, +1)
  const rights = edgeCandidates(surface, around - reach, around + reach, headWidth, -1)
  if (!lefts.length || !rights.length) return { reason: 'no_heads', edges: lefts.length + rights.length }

  let best = null
  for (const l of lefts) {
    for (const r of rights) {
      const dev = r.y - l.y - gaugeNominal
      if (dev < -GAUGE_NARROW - COLUMN_SLACK || dev > GAUGE_WIDE + COLUMN_SLACK) continue
      if (Math.abs(l.z - r.z) > MAX_CANT) continue
      if (Math.min(l.z, r.z) - surface.ground < minHeight) continue
      const axis = (l.y + r.y) / 2
      if (Math.abs(axis - around) > window) continue
      const score = Math.abs(axis - around) + Math.abs(dev)
      if (!best || score < best.score) best = { l, r, score }
    }
  }
  if (!best) return { reason: 'no_pair', edges: lefts.length + rights.length }

  const left  = locateHead(points, surface, best.l, +1, headWidth)
  const right = locateHead(points, surface, best.r, -1, headWidth)
  const gauge = right.edge - left.edge
  const doubtful =
    !left.flankPoints || !right.flankPoints ||
    gauge < gaugeNominal - GAUGE_NARROW || gauge > gaugeNominal + GAUGE_WIDE
  return {
    left, right,
    axis: (left.y + right.y) / 2,
    gauge,
    cant: left.z - right.z,
    ground: surface.ground,
    quality: doubtful ? 'doubtful' : 'good',
  }
}
