/**
 * The gradient of a turnout is one: the branch lies in the plane of the main
 * route, the way its plan follows the main route's radius.
 *
 * A turnout is laid on through sleepers from the switch toe (WA) to the last
 * through sleeper (ldS), and that grid of sleepers is one plane: the gradient
 * of the main route along it, tilted across it by the cant. So at every station
 * between WA and ldS the branch's height is the main route's, plus the tilt
 * over the distance between the two:
 *
 *   z_branch = z_main + u / 1500 · y
 *
 * with u the main route's cant there [mm] — stored signed, a positive cant
 * raises the left rail (rules/cant) — and y the branch axis' offset to the
 * left of the main axis [m]. Both heights are those of the rail that stays
 * down (track.heights), and that rail lies on the same side in both, so the
 * offset between the two axes is the offset between the two rails. Without
 * cant the branch simply has the main route's height; with it, a branch to
 * the raised side lies higher and one to the other side lower.
 *
 * The main route leads (decision 155): what is stored on the branch is its
 * point at the ldS — and any point it has between WA and ldS — with the height
 * the plane gives it; WA is a joint and carries one height already
 * (jointGroup). In between, the plane is not a straight line (the offset grows
 * along the branch arc), and the heights it gives are only computed where they
 * are drawn, in the cross section — never stored.
 *
 * Where the ldS lies comes from the switch catalogue (db-ril-800-0120, `lds`):
 * how far behind the switch end (WE) it is. From WA that is the length of the
 * turnout's main route — its elements on the main track — and that distance
 * on. A form that does not state one is not coupled.
 */

import { switchTypeByLabel } from './switch/catalogue'
import { elementAtStation, gradientAt, pointAtStationUtm, trackLength } from './heightUtils'
import { RUNNING_CIRCLE_DISTANCE, sectionAtStation } from './crossSectionUtils'
import { elementBelongsToSwitch, turnoutDivergingPort, turnoutLinePort, turnoutLineRoute } from './switchModel'

const STATION_TOL = 0.01    // m — a height point this close to the ldS is the ldS point
const Z_TOL = 0.0005        // m — heights that agree to this already agree
const roundMm = (x) => Math.round(x * 1000) / 1000

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
const mainRouteLength = (track, sw) => (track.elements ?? [])
  .filter(el => elementBelongsToSwitch(el, sw) && (el.switchRoute ?? 'main') === turnoutLineRoute(sw))
  .reduce((sum, el) => sum + (el.length ?? 0), 0)

/**
 * How far from WA along the main route the turnout's body reaches: to the
 * ldS, or to WE where the form states none. Null without a main route.
 */
export function ldsFromToe(tracks, sw, { formOf } = {}) {
  const main = tracks.find(t => t.id === sw?.[`port${turnoutLinePort(sw)}_trackId`])
  const we = main ? mainRouteLength(main, sw) : 0
  if (!(we > 0)) return null
  return we + (switchLds(sw, formOf) ?? 0)
}

const isTurnout = (sw) => (sw?.kind ?? 'turnout') === 'turnout'

/** A track as seen from the switch toe: station ↔ distance from WA. */
function routeFrom(tracks, sw, port) {
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

/** Point [E, N] at a station of a track. */
function pointAt(track, station) {
  const hit = elementAtStation(track.elements, station)
  if (!hit) return null
  const p = pointAtStationUtm(hit.el, hit.s, track.epsg)
  return p ? [p.easting, p.northing] : null
}

/** Unit tangent at a station of a track, in the direction its stations run. */
function tangentAt(track, station, length) {
  const h = 0.05
  const a = pointAt(track, Math.max(0, station - h))
  const b = pointAt(track, Math.min(length, station + h))
  if (!a || !b) return null
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const n = Math.hypot(dx, dy)
  return n > 0 ? [dx / n, dy / n] : null
}

/**
 * The distance d from WA along `route` at which it crosses the line through
 * `p` perpendicular to `t` — where a sleeper laid square to the main route at
 * `p` meets the other route. Bisection: the routes part monotonically.
 */
function crossingDistance(route, p, t, maxD) {
  const f = (d) => {
    const q = pointAt(route.track, route.station(d))
    return q ? (q[0] - p[0]) * t[0] + (q[1] - p[1]) * t[1] : NaN
  }
  let lo = 0, hi = Math.min(maxD, route.length)
  let flo = f(lo)
  const fhi = f(hi)
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null
  for (let k = 0; k < 60 && hi - lo > 1e-5; k++) {
    const mid = (lo + hi) / 2, fm = f(mid)
    if (fm * flo > 0) { lo = mid; flo = fm } else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * The plane of the turnout at distance m from WA along the main route: the
 * main route's height there, its cant and tangent, and how far to the left the
 * branch lies on the sleeper laid there. Null where any of it is missing.
 */
function planeAt(c, m) {
  const { main, branch } = c
  const station = main.station(m)
  const p = pointAt(main.track, station)
  const t = tangentAt(main.track, station, main.length)
  if (!p || !t) return null
  // Square to the main route, measured along its WA-forward direction.
  const tf = [t[0] * main.sense, t[1] * main.sense]
  // Searched a little beyond the ldS: a sleeper square to the main route
  // meets the branch about as far from WA as it lies on the main route.
  const d = crossingDistance(branch, p, tf, Math.max(c.lds, c.ldsBranchDistance ?? 0) * 1.5 + 1)
  if (d == null) return null
  const q = pointAt(branch.track, branch.station(d))
  // Left of the main track in the direction of *its* stations — the frame its
  // signed cant is stated in.
  const y = t[0] * (q[1] - p[1]) - t[1] * (q[0] - p[0])
  const cant = sectionAtStation(main.track, station)?.cant ?? 0
  const z = gradientAt(main.track.heights, station)
  return { m, d, y, cant, z: z == null ? null : z + (cant / RUNNING_CIRCLE_DISTANCE) * y }
}

/**
 * How one turnout couples its branch to its main route, or null where it does
 * not: not a turnout, a track missing, no ldS for its form.
 *
 * Returns { sw, main, branch, lds, ldsMain, ldsBranch, offset, cant } with
 * `lds` the distance WA–ldS along the main route, `ldsMain` / `ldsBranch` the
 * stations of the ldS on either track and
 * `offset` the branch's distance to the left of the main route there [m].
 */
export function switchCoupling(tracks, sw, { formOf } = {}) {
  if (!isTurnout(sw)) return null
  const behindWe = switchLds(sw, formOf)
  if (behindWe == null) return null
  const main = routeFrom(tracks, sw, turnoutLinePort(sw))
  const branch = routeFrom(tracks, sw, turnoutDivergingPort(sw))
  if (!main || !branch || main.track.id === branch.track.id) return null
  const we = mainRouteLength(main.track, sw)
  if (!(we > 0)) return null
  const lds = we + behindWe
  if (Number(main.track.epsg) !== Number(branch.track.epsg) || lds > main.length) return null
  const c = { sw, main, branch, lds, ldsMain: main.station(lds) }
  const plane = planeAt(c, lds)
  if (!plane) return null
  return { ...c, ldsBranch: branch.station(plane.d), offset: plane.y, cant: plane.cant, ldsBranchDistance: plane.d }
}

/** Every coupling a project's turnouts make. */
export function switchCouplings(tracks, switches, opts) {
  return (switches ?? []).map(sw => switchCoupling(tracks, sw, opts)).filter(Boolean)
}

/** The stations of a coupled branch between WA (exclusive) and the ldS (inclusive). */
const inCoupledStretch = (c, station) => {
  const d = c.branch.distance(station)
  return d > STATION_TOL && d <= c.ldsBranchDistance + STATION_TOL
}

/**
 * The branch heights a coupling asks for: its point at the ldS, and every
 * point it already has between WA and ldS, at the plane's height — or null
 * where they already are, or where there is nothing to couple yet (a main
 * route without a gradient over WA–ldS, a branch without one: decision 64,
 * no gradient is made up).
 */
export function coupledBranchHeights(c) {
  const mainH = c.main.track.heights
  const branchH = c.branch.track.heights
  if (!(mainH?.length >= 2) || !(branchH?.length >= 2)) return null
  const [m0, m1] = [mainH[0].station, mainH[mainH.length - 1].station]
  const [wa, ldsM] = [c.main.station(0), c.ldsMain]
  if (Math.min(wa, ldsM) < m0 - STATION_TOL || Math.max(wa, ldsM) > m1 + STATION_TOL) return null

  let changed = false
  const heightAtBranch = (station) => {
    if (Math.abs(c.branch.distance(station) - c.ldsBranchDistance) <= STATION_TOL) {
      return planeAt(c, c.lds)?.z ?? null
    }
    return branchPlaneHeight(c, station)
  }
  const out = branchH.map(p => {
    if (!inCoupledStretch(c, p.station)) return p
    const z = heightAtBranch(p.station)
    if (z == null || Math.abs(z - p.z) <= Z_TOL) return p
    changed = true
    return { ...p, z: roundMm(z) }
  })
  const hasLds = out.some(p => Math.abs(p.station - c.ldsBranch) <= STATION_TOL)
  if (!hasLds) {
    const z = planeAt(c, c.lds)?.z
    // Only within the stretch the branch's heights cover: a branch whose
    // gradient stops short of the ldS is not given one beyond it.
    const [b0, b1] = [out[0].station, out[out.length - 1].station]
    if (z == null || c.ldsBranch < b0 || c.ldsBranch > b1) return changed ? out : null
    changed = true
    const at = { station: roundMm(c.ldsBranch), z: roundMm(z) }
    const i = out.findIndex(p => p.station > at.station)
    out.splice(i < 0 ? out.length : i, 0, at)
  }
  return changed ? out : null
}

/**
 * Height of a coupled branch at one of its stations between WA and ldS, from
 * the plane of the turnout — what the cross section draws there. The main
 * route's distance is found the other way round: where a sleeper square to
 * the main route passes through the branch point.
 */
export function branchPlaneHeight(c, station) {
  const d = c.branch.distance(station)
  if (d < 0 || d > c.ldsBranchDistance + STATION_TOL) return null
  const q = pointAt(c.branch.track, station)
  if (!q) return null
  // The main distance m whose square sleeper meets the branch at d.
  const f = (m) => {
    const st = c.main.station(m)
    const p = pointAt(c.main.track, st)
    const t = tangentAt(c.main.track, st, c.main.length)
    return p && t ? ((q[0] - p[0]) * t[0] + (q[1] - p[1]) * t[1]) * c.main.sense : NaN
  }
  let lo = 0, hi = Math.min(c.lds * 1.5 + 1, c.main.length)
  let flo = f(lo)
  if (!Number.isFinite(flo) || flo * f(hi) > 0) return null
  for (let k = 0; k < 60 && hi - lo > 1e-5; k++) {
    const mid = (lo + hi) / 2, fm = f(mid)
    if (fm * flo > 0) { lo = mid; flo = fm } else hi = mid
  }
  return planeAt(c, (lo + hi) / 2)?.z ?? null
}

/**
 * The project with every branch coupled to its main route — for the turnouts
 * `only` names (their switchIds), or all of them. The same project where
 * nothing had to change, so a write that touched no turnout costs nothing.
 */
export function coupleSwitchGradients(project, { only = null, formOf } = {}) {
  const switches = (project?.switches ?? []).filter(sw => !only || only.has(sw.switchId))
  if (!switches.length) return project
  let tracks = project.tracks ?? []
  let changed = false
  for (const sw of switches) {
    const c = switchCoupling(tracks, sw, { formOf })
    if (!c) continue
    const heights = coupledBranchHeights(c)
    if (!heights) continue
    changed = true
    tracks = tracks.map(t => (t.id === c.branch.track.id ? { ...t, heights } : t))
  }
  return changed ? { ...project, tracks } : project
}

/**
 * The switchIds of the turnouts a write reached: those whose main route or
 * branch track changed, or whose own record did. What the store couples after
 * a write, so an edit far from any turnout leaves the turnouts alone.
 */
export function touchedTurnouts(before, after) {
  const was = new Map((before?.tracks ?? []).map(t => [t.id, t]))
  const changedTrack = new Set((after?.tracks ?? []).filter(t => was.get(t.id) !== t).map(t => t.id))
  const wasSw = new Map((before?.switches ?? []).map(s => [s.switchId, s]))
  const ids = new Set()
  for (const sw of after?.switches ?? []) {
    if (!isTurnout(sw)) continue
    if (wasSw.get(sw.switchId) !== sw
      || changedTrack.has(sw.portB1_trackId) || changedTrack.has(sw.portB2_trackId)) ids.add(sw.switchId)
  }
  return ids
}

/**
 * The height point indices of a track that a coupling sets, with the switch
 * that sets them — the branch's ldS point and its points between WA and ldS.
 * What the profile locks.
 */
export function coupledPoints(tracks, switches, track, opts) {
  const out = new Map()
  for (const c of switchCouplings(tracks, switches, opts)) {
    if (c.branch.track.id !== track.id) continue
    ;(track.heights ?? []).forEach((p, i) => { if (inCoupledStretch(c, p.station)) out.set(i, c.sw) })
  }
  return out
}

/**
 * The height a track is built at, at one of its stations: the rounded
 * gradient, and on a coupled branch between WA and ldS the plane of the
 * turnout instead.
 */
export function trackHeightAt(tracks, switches, track, station, opts) {
  for (const c of switchCouplings(tracks, switches, opts)) {
    if (c.branch.track.id !== track.id || !inCoupledStretch(c, station)) continue
    const z = branchPlaneHeight(c, station)
    if (z != null) return z
  }
  return gradientAt(track.heights, station)
}

/**
 * What trackHeightAt needs of a project for `track`: the track, the main
 * routes of the turnouts it branches off from, and those turnouts — what a
 * long run on the server is sent instead of the whole project (AP 13.7).
 */
export function heightContext(tracks, switches, track, opts) {
  const couplings = switchCouplings(tracks, switches, opts).filter(c => c.branch.track.id === track.id)
  const mains = new Set(couplings.map(c => c.main.track.id))
  return {
    tracks: [track, ...(tracks ?? []).filter(t => t.id !== track.id && mains.has(t.id))],
    switches: couplings.map(c => c.sw),
  }
}

/**
 * The stretches of a track the Höhenplan treats as the turnout (WA to ldS,
 * decision 156), as [{ from, to }] in its stations — on the main route and on
 * the branch. A turnout whose form states no ldS reaches to its end (WE), as
 * far as its elements go; so does every other kind of switch.
 */
export function switchBodySpans(tracks, switches, track, opts) {
  const spans = []
  const covered = new Set()
  for (const sw of switches ?? []) {
    const c = switchCoupling(tracks, sw, opts)
    if (c && c.main.track.id === track.id) {
      spans.push(ordered(c.main.station(0), c.ldsMain)); covered.add(sw.switchId)
    } else if (c && c.branch.track.id === track.id) {
      spans.push(ordered(c.branch.station(0), c.ldsBranch)); covered.add(sw.switchId)
    }
  }
  // WA to WE: the elements the switch marks as its own on this track.
  let start = 0
  let open = null
  for (const el of track.elements ?? []) {
    const end = start + (el.length ?? 0)
    const id = el.switchId != null && !covered.has(el.switchId) ? el.switchId : null
    if (id && open?.id === id) open.to = end
    else {
      if (open) spans.push({ from: open.from, to: open.to })
      open = id ? { id, from: start, to: end } : null
    }
    start = end
  }
  if (open) spans.push({ from: open.from, to: open.to })
  return spans
}

const ordered = (a, b) => ({ from: Math.min(a, b), to: Math.max(a, b) })
