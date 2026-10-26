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
 *   z_branch = z_main + u / 1500 · y        (a square sleeper; decision 257 for one that leans)
 *
 * with u the main route's cant there [mm] — stored signed, a positive cant
 * raises the left rail (rules/cant) — and y the branch axis' offset to the
 * left of the main axis [m]. Both heights are those of the rail that stays
 * down (track.heights), and that rail lies on the same side in both, so the
 * offset between the two axes is the offset between the two rails. Without
 * cant the branch simply has the main route's height; with it, a branch to
 * the raised side lies higher and one to the other side lower.
 *
 * The turnout lies on sleepers (switch/sleepers.js, decision 256); its ldS
 * sleeper is where the plane couples the two tracks' stored heights
 * (switchChain, decision 384): at WA they meet in one height, at the ldS the
 * branch lies in the plane over the main route. Between the two the plane is
 * not a straight line (the offset grows along the branch arc), and the
 * heights it gives there are only computed where they are drawn, in the
 * cross section — never stored.
 *
 * Where the ldS lies comes from the switch catalogue (db-ril-800-0120, `lds`):
 * how far behind the switch end (WE) it is. From WA that is the length of the
 * turnout's main route — its elements on the main track — and that distance
 * on. A form that does not state one is coupled up to WE, its ldS taken
 * there (decision 383).
 */

import { gradientAt, heightAt, pointAtStation, turnoutLinePort, portTrack } from '../track'
import { RUNNING_CIRCLE_DISTANCE, sectionAtStation } from '../crossSection'
import { mainRouteLength, routeFrom, sleeperOffsets, sleeperThrough, switchLds, turnoutSleepers } from '../switch'

export { switchLds }

export const STATION_TOL = 0.01    // m — a height point this close to the ldS is the ldS point
export const Z_TOL = 0.00005       // m — heights that agree to this already agree (they are kept to 0.1 mm)
export const roundMm = (x) => Math.round(x * 1000) / 1000

/**
 * How far from WA along the main route the turnout's body reaches: to the
 * ldS, or to WE where the form states none. Null without a main route.
 */
export function ldsFromToe(tracks, sw, { formOf } = {}) {
  const main = routeFrom(tracks, sw, turnoutLinePort(sw))
  const we = main ? mainRouteLength(main.track, sw) : 0
  if (!(we > 0)) return null
  return we + (switchLds(sw, formOf) ?? 0)
}

/** Longitudinal gradient [m/m] of a track's rounded gradient at a station. */
function slopeAt(heights, station) {
  const h = 0.05
  const a = gradientAt(heights, station - h), b = gradientAt(heights, station + h)
  return a == null || b == null ? 0 : (b - a) / (2 * h)
}

/**
 * Height of the branch on a sleeper (decision 257): the sleeper is a straight
 * line in the turnout's local plane at its foot P on the main route —
 * z_Q = z_P + g · a + u / 1500 · y, with g the main route's gradient there, u
 * its cant, a and y the sleeper's run along and across it. `zP` the main
 * route's height at P, its rounded gradient unless stated. Null without one.
 */
function planeHeight(c, sl, zP = gradientAt(c.main.track.heights, sl.main)) {
  if (zP == null) return null
  const off = sl.a != null ? sl : sleeperOffsets(c, sl)
  if (!off) return null
  const cant = sectionAtStation(c.main.track, sl.main)?.cant ?? 0
  return zP + slopeAt(c.main.track.heights, sl.main) * off.a + (cant / RUNNING_CIRCLE_DISTANCE) * off.y
}

/** The main route's cant on a sleeper [mm] — geometry, so kept with it. */
const cantOn = (c, sl) => (sl.cant ??= sectionAtStation(c.main.track, sl.main)?.cant ?? 0)

/**
 * How one turnout couples its branch to its main route, or null where it does
 * not: not a turnout, a track missing.
 *
 * Its sleepers (switch/sleepers.turnoutSleepers) with { offset, cant }: how far
 * the branch lies to the left of the main route on the ldS sleeper [m] and the
 * main route's cant there [mm].
 */
export function switchCoupling(tracks, sw, opts = {}) {
  // A form whose ldS the catalogue does not state is coupled up to WE (decision 383).
  const frame = turnoutSleepers(tracks, sw, { ...opts, ldsUnknown: 0 })
  if (!frame) return null
  const ldsSleeper = frame.sleepers[frame.sleepers.length - 1]
  return { ...frame, ldsSleeper, offset: ldsSleeper.y, cant: cantOn(frame, ldsSleeper) }
}

/**
 * Every coupling a project's turnouts make, each with the stretch it owns on
 * its two tracks. Where two turnouts reach into one track from its two ends —
 * the connecting track of a crossover is the branch of both — and their
 * stretches overlap, each owns its part up to the middle of the overlap
 * (decision 264): there the plane of the one turnout gives way to the other's.
 *
 * Each coupling gets `reach` { main, branch } — how far from WA its stretch
 * reaches on either track, to the ldS — and `end` — how far the part it owns
 * reaches, to the middle of an overlap.
 */
// The last answer, for the same project state: the profile and the cross
// section ask for every station they draw.
let lastCouplings = null

export function switchCouplings(tracks, switches, opts) {
  const formOf = opts?.formOf
  if (lastCouplings && lastCouplings.tracks === tracks && lastCouplings.switches === switches
    && lastCouplings.formOf === formOf) return lastCouplings.result
  const result = couplingsOf(tracks, switches, opts)
  lastCouplings = { tracks, switches, formOf, result }
  return result
}

function couplingsOf(tracks, switches, opts) {
  const cs = (switches ?? []).map(sw => switchCoupling(tracks, sw, opts)).filter(Boolean)
  for (const c of cs) {
    c.reach = { main: c.lds, branch: c.ldsBranchDistance }
    c.end = { ...c.reach }
  }
  const onTrack = new Map()
  for (const c of cs) {
    for (const side of ['main', 'branch']) {
      const id = c[side].track.id
      onTrack.set(id, [...(onTrack.get(id) ?? []), { c, side }])
    }
  }
  for (const entries of onTrack.values()) {
    for (const [i, e1] of entries.entries()) {
      for (const e2 of entries.slice(i + 1)) {
        if (e1.c[e1.side].sense === e2.c[e2.side].sense) continue
        const L = e1.c[e1.side].length
        const [r1, r2] = [e1.c.reach[e1.side], e2.c.reach[e2.side]]
        if (r1 + r2 <= L) continue
        const split = (r1 + L - r2) / 2
        e1.c.end[e1.side] = split
        e2.c.end[e2.side] = L - split
      }
    }
  }
  return cs
}

/** The coupling of one turnout, with the stretch it owns (switchCouplings). */
export function couplingOf(tracks, switches, sw, opts) {
  const own = switchCoupling(tracks, sw, opts)
  if (!own) return null
  // Only turnouts on its two tracks can share a stretch with it.
  const ids = new Set([own.main.track.id, own.branch.track.id])
  const near = (switches ?? []).filter(s => s.switchId === sw.switchId
    || [portTrack(s, 'B1'), portTrack(s, 'B2')].some(id => ids.has(id)))
  return couplingsOf(tracks, near, opts).find(c => c.sw.switchId === sw.switchId) ?? null
}

/** Is a station of one of the coupling's tracks behind WA, within the stretch it owns? */
function inBody(c, side, station) {
  const d = c[side].distance(station)
  return d > STATION_TOL && d <= c.end[side] + STATION_TOL
}

/**
 * How far the branch lies above the main route on the ldS sleeper (decision
 * 257): g · a + u/1500 · y, with g the main route's gradient there read from
 * `mainHeights`, u its cant, a and y the sleeper's run along and across it.
 */
export function ldsLift(c, mainHeights) {
  const sl = c.ldsSleeper
  const off = sl && (sl.a != null ? sl : sleeperOffsets(c, sl))
  if (!off) return 0
  return slopeAt(mainHeights, sl.main) * off.a + (cantOn(c, sl) / RUNNING_CIRCLE_DISTANCE) * off.y
}

/**
 * The height the plane of a track through one of its points gives a point
 * of another track (decision 384, a point depending on one): the source's
 * height, raised by the source track's gradient g over the run a along it and
 * by its cant over the offset y across it — z = z_src + g · a + u/1500 · y,
 * y to the left of the source track the way its stations run, u signed the
 * same way. Null where either point is not on its track.
 */
export function planeFrom(src, srcStation, zSrc, dst, dstStation) {
  const p = pointAtStation(src, srcStation), q = pointAtStation(dst, dstStation)
  if (!p || !q || zSrc == null) return null
  const b = p.bearing * Math.PI / 180
  const t = [Math.sin(b), Math.cos(b)]
  const v = [q.utm.easting - p.utm.easting, q.utm.northing - p.utm.northing]
  const a = t[0] * v[0] + t[1] * v[1]
  const y = t[0] * v[1] - t[1] * v[0]
  const h = src.heights ?? []
  const step = 0.05
  const s0 = Math.max(h[0]?.station ?? srcStation, srcStation - step), s1 = Math.min(h[h.length - 1]?.station ?? srcStation, srcStation + step)
  const g = s1 > s0 ? (heightAt(h, s1) - heightAt(h, s0)) / (s1 - s0) : 0
  return zSrc + g * a + ((sectionAtStation(src, srcStation)?.cant ?? 0) / RUNNING_CIRCLE_DISTANCE) * y
}

/**
 * Height of a coupled branch at one of its stations between WA and ldS, from
 * the plane of the turnout — what the cross section draws there: on the
 * sleeper laid through that point.
 */
export function branchPlaneHeight(c, station) {
  const sl = sleeperThrough(c, 'branch', station)
  return sl ? planeHeight(c, sl) : null
}

/**
 * The height a track is built at, at one of its stations: the rounded
 * gradient, and on a coupled branch between WA and ldS the plane of the
 * turnout instead.
 */
export function trackHeightAt(tracks, switches, track, station, opts) {
  for (const c of switchCouplings(tracks, switches, opts)) {
    if (c.branch.track.id !== track.id || !inBody(c, 'branch', station)) continue
    const z = branchPlaneHeight(c, station)
    if (z != null) return z
  }
  return gradientAt(track.heights, station)
}

/**
 * What trackHeightAt needs of a project for `track`: the track, the turnouts
 * on it and their tracks — the main routes it branches off from, and the
 * tracks of a turnout that shares a stretch with one of them — what a long
 * run on the server is sent instead of the whole project (AP 13.7).
 */
export function heightContext(tracks, switches, track, opts) {
  const couplings = switchCouplings(tracks, switches, opts)
    .filter(c => c.branch.track.id === track.id || c.main.track.id === track.id)
  const ids = new Set(couplings.flatMap(c => [c.main.track.id, c.branch.track.id]))
  ids.delete(track.id)
  const coupledHere = couplings.some(c => c.branch.track.id === track.id)
  return coupledHere
    ? { tracks: [track, ...(tracks ?? []).filter(t => ids.has(t.id))], switches: couplings.map(c => c.sw) }
    : { tracks: [track], switches: [] }
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
