/**
 * Where the sleepers of a turnout lie (decision 256) — what "the same place"
 * on its main route and its branch is.
 *
 * They are laid along the **bisector** of the turnout: the line whose points
 * lie as far from the main route's axis as from the branch's. At the switch
 * toe (WA) it runs with the main route — the branch leaves it tangentially —
 * at the switch end (WE) along the bisector of the turnout angle, and in a
 * symmetric turnout it is the axis of symmetry. Sleeper k lies
 *
 *   s_k = 0.3 + 0.6 · k
 *
 * along the bisector from WA and square to it there; where it crosses the two
 * axes are the two points of a pair. The last through sleeper (ldS) stays where
 * the catalogue puts it — WE plus `lds` along the main route — as the sleeper
 * through that point of the main route, square to the bisector there; the grid
 * ends with the sleeper before it. Nothing here is a setting, and nothing is
 * stored: the sleepers follow from the geometry.
 *
 * The bisector is traced from WA in short steps: its direction is the mean of
 * the two axes' directions at the points nearest to it, and after each step it
 * is put back where both axes are equally far. Each step records where a
 * sleeper laid there would cross the two axes, and every question — a sleeper
 * of the grid, the ldS, the sleeper through a point of either track — is
 * answered from those steps.
 */

import { switchTypeByLabel } from './switch/catalogue'
import { elementAtStation, pointAtStationUtm, trackLength } from './heightUtils'
import { elementStations, pointOnElement } from './platformUtils'
import { elementBelongsToSwitch, turnoutDivergingPort, turnoutLinePort, turnoutLineRoute } from './switchModel'

/** Where the first sleeper lies behind WA, and how far apart they are [m]. */
export const FIRST_SLEEPER = 0.3
export const SLEEPER_SPACING = 0.6

const STEP = 1.0           // m along the bisector between two traced points
const NEWTON = 12
const EPS = 1e-9

/** How far behind WE the ldS lies [m], as the form states it, or null. */
export function switchLds(sw, formOf = switchTypeByLabel) {
  const lds = formOf(sw?.label)?.lds
  return Number.isFinite(lds) && lds >= 0 ? lds : null
}

/**
 * Length of the turnout's main route, WA to WE: its elements on the main track.
 * The main track is the line the turnout lies on, so on a swapped turnout it
 * is the branch that leads (switchModel.turnoutLinePort).
 */
export const mainRouteLength = (track, sw) => (track.elements ?? [])
  .filter(el => elementBelongsToSwitch(el, sw) && (el.switchRoute ?? 'main') === turnoutLineRoute(sw))
  .reduce((sum, el) => sum + (el.length ?? 0), 0)

/** Point [E, N] at a station of a track. */
function pointAt(track, station) {
  const hit = elementAtStation(track.elements, station)
  if (!hit) return null
  const p = pointAtStationUtm(hit.el, hit.s, track.epsg)
  return p ? [p.easting, p.northing] : null
}

/** Unit tangent at a station of a track, in the direction its stations run. */
function tangentAt(track, station, length = trackLength(track)) {
  const h = 0.05
  const a = pointAt(track, Math.max(0, station - h))
  const b = pointAt(track, Math.min(length, station + h))
  if (!a || !b) return null
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const n = Math.hypot(dx, dy)
  return n > 0 ? [dx / n, dy / n] : null
}

/** A track as seen from the switch toe: station ↔ distance from WA. */
export function routeFrom(tracks, sw, port) {
  const track = tracks.find(t => t.id === sw[`port${port}_trackId`])
  if (!track) return null
  const length = trackLength(track)
  const fromBegin = sw[`port${port}_endpoint`] !== 'END'
  return {
    track,
    length,
    station: (d) => (fromBegin ? d : length - d),
    distance: (station) => (fromBegin ? station : length - station),
    // +1 where the track's stations run away from WA, −1 where toward it.
    sense: fromBegin ? 1 : -1,
  }
}

// ── Plane vectors ───────────────────────────────────────────────────────────

const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1]
const unit = (v) => { const n = Math.hypot(v[0], v[1]); return n > EPS ? [v[0] / n, v[1] / n] : null }
const lerp = (a, b, t) => a + (b - a) * t

/**
 * A route's point and its direction away from WA at a distance d from WA —
 * straight from the element, which is what the tracing asks thousands of
 * times. The elements' stations are found once per route.
 */
function poseOf(route) {
  if (route.pose) return route.pose
  const rows = elementStations(route.track)
  const epsg = route.track.epsg
  route.pose = (d) => {
    const st = route.station(Math.max(0, Math.min(route.length, d)))
    let lo = 0, hi = rows.length - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (st <= rows[mid].end + 1e-9) hi = mid; else lo = mid + 1 }
    const row = rows[lo]
    if (!row) return null
    const e = pointOnElement(row.el, epsg, Math.max(0, Math.min(row.el.length ?? 0, st - row.start)))
    if (!e?.utm) return null
    const b = e.bearing * Math.PI / 180
    return { p: [e.utm.easting, e.utm.northing], t: [Math.sin(b) * route.sense, Math.cos(b) * route.sense] }
  }
  return route.pose
}
const at = (route, d) => poseOf(route)(d)?.p ?? null
const awayAt = (route, d) => poseOf(route)(d)?.t ?? null

/** The distance along a route of the point nearest to `x`, from a guess nearby. */
function foot(route, x, guess) {
  let d = guess
  for (let i = 0; i < NEWTON; i++) {
    const pose = poseOf(route)(d)
    if (!pose) return null
    const { p, t } = pose
    const step = dot(sub(x, p), t)
    d = Math.max(0, Math.min(route.length, d + step))
    if (Math.abs(step) < 1e-7) break
  }
  return d
}

/** The distance along a route where it crosses the line through `x` square to `dir`. */
function cut(route, x, dir, guess) {
  let d = guess
  for (let i = 0; i < NEWTON; i++) {
    const pose = poseOf(route)(d)
    if (!pose) return null
    const { p, t } = pose
    const f = dot(sub(p, x), dir), df = dot(t, dir)
    if (Math.abs(df) < EPS) return null
    const step = f / df
    d -= step
    if (d < -1e-6 || d > route.length + 1e-6) return null
    if (Math.abs(step) < 1e-7) break
  }
  return Math.max(0, Math.min(route.length, d))
}

// ── The turnout's frame ─────────────────────────────────────────────────────

const isTurnout = (sw) => (sw?.kind ?? 'turnout') === 'turnout'

/**
 * Trace the bisector from WA until its sleeper reaches `ldsMain` on the main
 * route. Each sample: { s, x, dir, m, b } — the distance along the bisector,
 * the point and direction there, and the distances from WA along the main
 * route and the branch where a sleeper laid there crosses them. Null where a
 * track ends first or the two do not part.
 */
function traceBisector(main, branch, ldsMain) {
  const start = at(main, 0)
  const t0 = awayAt(main, 0)
  if (!start || !t0) return null
  const samples = [{ s: 0, x: start, dir: t0, m: 0, b: 0 }]
  let x = start, dir = t0, s = 0, fm = 0, fb = 0, m = 0, b = 0
  const maxSteps = Math.ceil((ldsMain * 2 + 10) / STEP) + 20
  const direction = (p, gm, gb) => {
    const am = foot(main, p, gm), ab = foot(branch, p, gb)
    if (am == null || ab == null) return null
    const tm = awayAt(main, am), tb = awayAt(branch, ab)
    const d = tm && tb ? unit([tm[0] + tb[0], tm[1] + tb[1]]) : null
    return d ? { d, am, ab } : null
  }
  for (let i = 0; i < maxSteps && m < ldsMain; i++) {
    // The last step only just past the ldS: a track may end right behind it.
    const h = Math.min(STEP, Math.max(0.05, ldsMain - m + 0.02))
    // Midpoint step along the bisector's direction…
    const half = direction(add(x, dir, h / 2), fm, fb)
    if (!half) return null
    let next = add(x, half.d, h)
    // …and back to where both axes are equally far.
    for (let k = 0; k < 2; k++) {
      const am = foot(main, next, half.am), ab = foot(branch, next, half.ab)
      if (am == null || ab == null) return null
      const pm = at(main, am), pb = at(branch, ab)
      const gap = sub(pb, pm)
      const u = unit(gap)
      if (!u) break
      const dm = Math.hypot(...sub(next, pm)), db = Math.hypot(...sub(next, pb))
      if (Math.abs(db - dm) < 1e-7) break
      next = add(next, u, (db - dm) / 2)
    }
    const here = direction(next, half.am, half.ab)
    if (!here) return null
    s += Math.hypot(...sub(next, x))
    x = next; dir = here.d; fm = here.am; fb = here.ab
    const cm = cut(main, x, dir, fm), cb = cut(branch, x, dir, fb)
    if (cm == null || cb == null) return null
    m = cm; b = cb
    samples.push({ s, x, dir, m, b })
  }
  return m >= ldsMain ? samples : null
}

/** The sample state at a value of one key (s, m or b), interpolated linearly. */
function sampleAt(samples, key, value) {
  if (value <= samples[0][key]) return { ...samples[0] }
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], c = samples[i]
    if (value <= c[key] + EPS) {
      const t = c[key] - a[key] > EPS ? (value - a[key]) / (c[key] - a[key]) : 0
      return { s: lerp(a.s, c.s, t), m: lerp(a.m, c.m, t), b: lerp(a.b, c.b, t) }
    }
  }
  return null
}

// The geometry is worked out once per turnout and the shape of the two tracks
// it joins — the project's records are immutable, so a track whose elements
// change has a new elements array, while one whose heights change keeps it.
const geometries = new WeakMap()

/**
 * The sleepers of one turnout, or null where it has none to speak of: not a
 * turnout, a track missing or in another plane, no ldS for its form, a track
 * shorter than the turnout.
 *
 * Returns { sw, main, branch, we, lds, ldsMain, ldsBranch, samples, sleepers }:
 * `main` / `branch` the two tracks as seen from WA (routeFrom), `we` and
 * `lds` the distances WA–WE and WA–ldS along the main route, `ldsMain` /
 * `ldsBranch` the stations of the ldS on either track, and `sleepers` every
 * sleeper from the first to the ldS — [{ k, s, m, b, main, branch, a, y }]
 * with `k` its number ('lds' for the last), `s` its distance along the
 * bisector, `m` / `b` its distance from WA along each track, `main` /
 * `branch` its station on each and `a` / `y` how it sits in the main track's
 * frame (sleeperOffsets).
 */
export function turnoutSleepers(tracks, sw, { formOf } = {}) {
  if (!isTurnout(sw)) return null
  const behindWe = switchLds(sw, formOf)
  if (behindWe == null) return null
  const main = routeFrom(tracks, sw, turnoutLinePort(sw))
  const branch = routeFrom(tracks, sw, turnoutDivergingPort(sw))
  if (!main || !branch || main.track.id === branch.track.id) return null
  if (Number(main.track.epsg) !== Number(branch.track.epsg)) return null

  const key = [main.track.elements, branch.track.elements, main.sense, branch.sense, behindWe]
  const cached = geometries.get(sw)
  let geo = cached && cached.key.every((v, i) => v === key[i]) ? cached.geo : undefined
  if (geo === undefined) {
    geo = buildGeometry(sw, main, branch, behindWe)
    geometries.set(sw, { key, geo })
  }
  return geo && { sw, main, branch, ...geo }
}

function buildGeometry(sw, main, branch, behindWe) {
  const we = mainRouteLength(main.track, sw)
  if (!(we > 0)) return null
  const lds = we + behindWe
  if (lds > main.length) return null
  const samples = traceBisector(main, branch, lds)
  if (!samples) return null
  const last = sampleAt(samples, 'm', lds)
  if (!last || !(last.b > 0)) return null
  const sleepers = []
  for (let k = 0; ; k++) {
    const s = FIRST_SLEEPER + SLEEPER_SPACING * k
    if (s >= last.s - EPS) break
    const p = sampleAt(samples, 's', s)
    if (!p) break
    sleepers.push({ k, s, m: p.m, b: p.b, main: main.station(p.m), branch: branch.station(p.b) })
  }
  sleepers.push({ k: 'lds', s: last.s, m: lds, b: last.b, main: main.station(lds), branch: branch.station(last.b) })
  for (const sl of sleepers) Object.assign(sl, sleeperOffsets({ main, branch }, sl) ?? { a: 0, y: 0 })
  return {
    we, lds, ldsMain: main.station(lds), ldsBranch: branch.station(last.b), ldsBranchDistance: last.b,
    samples, sleepers,
  }
}

/**
 * The sleeper nearest to a station of one of the turnout's tracks (`side`
 * 'main' or 'branch'), among those behind WA up to the ldS — or null where
 * the station lies before WA or beyond the ldS.
 */
export function sleeperNear(frame, side, station, tol = 0.01) {
  const route = frame[side]
  const key = side === 'main' ? 'm' : 'b'
  const d = route.distance(station)
  const end = frame.sleepers[frame.sleepers.length - 1][key]
  if (d < tol || d > end + tol) return null
  let best = null
  for (const sl of frame.sleepers) {
    if (!best || Math.abs(sl[key] - d) < Math.abs(best[key] - d)) best = sl
  }
  return best
}

/** The sleeper laid through a station of the branch (or the main route), anywhere WA–ldS. */
export function sleeperThrough(frame, side, station) {
  const key = side === 'main' ? 'm' : 'b'
  const d = frame[side].distance(station)
  const end = frame.sleepers[frame.sleepers.length - 1][key]
  if (d < -1e-6 || d > end + 1e-6) return null
  const p = sampleAt(frame.samples, key, d)
  return p ? { ...p, main: frame.main.station(p.m), branch: frame.branch.station(p.b) } : null
}

/**
 * How a sleeper (anything with `main` and `branch` stations) sits in the
 * main track's frame: from P on the main axis to Q on the branch axis, `a`
 * along the main track in the direction of its stations and `y` to the left
 * of it [m]. What the plane needs (decision 257).
 */
export function sleeperOffsets(frame, sl) {
  const p = pointAt(frame.main.track, sl.main)
  const q = pointAt(frame.branch.track, sl.branch)
  const t = tangentAt(frame.main.track, sl.main, frame.main.length)
  if (!p || !q || !t) return null
  const v = sub(q, p)
  return { a: dot(v, t), y: t[0] * v[1] - t[1] * v[0] }
}
