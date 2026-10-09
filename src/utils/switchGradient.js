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
 * The turnout lies on sleepers (switchSleepers, decision 256), and every
 * height point between WA and the ldS sits on one of them and has a partner on
 * the same sleeper of the other track (decision 258). Either track can be
 * edited: after a write the track that led — the branch where only its heights
 * changed, the main route otherwise — decides which sleepers carry points, and
 * the other follows with the heights the plane gives (decision 259). WA is a
 * joint and carries one height already (jointGroup); the branch always has a
 * point on the ldS. Between the points the plane is not a straight line (the
 * offset grows along the branch arc), and the heights it gives there are only
 * computed where they are drawn, in the cross section — never stored.
 *
 * Where the ldS lies comes from the switch catalogue (db-ril-800-0120, `lds`):
 * how far behind the switch end (WE) it is. From WA that is the length of the
 * turnout's main route — its elements on the main track — and that distance
 * on. A form that does not state one is not coupled.
 */

import { gradientAt, roundHeight } from './heightUtils'
import { RUNNING_CIRCLE_DISTANCE, sectionAtStation } from './crossSectionUtils'
import { mainRouteLength, routeFrom, sleeperOffsets, sleeperThrough, switchLds, turnoutSleepers } from './switchSleepers'
import { turnoutLinePort } from './switchModel'

export { switchLds }

const STATION_TOL = 0.01    // m — a height point this close to the ldS is the ldS point
const Z_TOL = 0.00005       // m — heights that agree to this already agree (they are kept to 0.1 mm)
const roundMm = (x) => Math.round(x * 1000) / 1000

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

const isTurnout = (sw) => (sw?.kind ?? 'turnout') === 'turnout'

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
export function planeHeight(c, sl, zP = gradientAt(c.main.track.heights, sl.main)) {
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
 * not: not a turnout, a track missing, no ldS for its form.
 *
 * Its sleepers (switchSleepers.turnoutSleepers) with { offset, cant }: how far
 * the branch lies to the left of the main route on the ldS sleeper [m] and the
 * main route's cant there [mm].
 */
export function switchCoupling(tracks, sw, opts = {}) {
  const frame = turnoutSleepers(tracks, sw, opts)
  if (!frame) return null
  const ldsSleeper = frame.sleepers[frame.sleepers.length - 1]
  return { ...frame, ldsSleeper, offset: ldsSleeper.y, cant: cantOn(frame, ldsSleeper) }
}

/**
 * Every coupling a project's turnouts make, each with the stretch it owns on
 * its two tracks. Where two turnouts reach into one track from its two ends —
 * the connecting track of a crossover is the branch of both — and their
 * stretches overlap, the long sleepers there carry all three tracks
 * (decision 264): each turnout keeps its own grid of sleepers up to the
 * middle of the overlap, and every sleeper in it couples the shared track to
 * the other track of both turnouts.
 *
 * Each coupling gets `reach` { main, branch } — how far from WA its stretch
 * reaches on either track, to the ldS — `end` — how far the part it owns
 * reaches, to the middle of an overlap — `owned`, its sleepers within that,
 * and `slots`: the sleepers it pairs points on, its own and, beyond the
 * middle of an overlap, the other turnout's laid through its frame.
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
  const overlaps = []
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
        overlaps.push([e1, e2])
      }
    }
  }
  for (const c of cs) {
    c.owned = c.sleepers.filter(sl => sl.m <= c.end.main + STATION_TOL && sl.b <= c.end.branch + STATION_TOL)
    c.guests = []
  }
  for (const [e1, e2] of overlaps) {
    addGuests(e1, e2)
    addGuests(e2, e1)
  }
  for (const c of cs) c.slots = [...c.owned, ...c.guests].sort((x, y) => x.m - y.m)
  return cs
}

/**
 * The sleepers of `host`'s neighbour on the track they share that lie beyond
 * the middle of the overlap but within `host`'s reach, laid through `host`'s
 * frame: the same sleeper on the shared track, where it meets `host`'s other
 * track there, and how it sits.
 */
function addGuests({ c: host, side }, { c: other, side: otherSide }) {
  for (const sl of other.owned) {
    const st = sl[otherSide]
    const d = host[side].distance(st)
    if (d <= host.end[side] + STATION_TOL || d > host.reach[side] + STATION_TOL) continue
    const through = sleeperThrough(host, side, st)
    const off = through && sleeperOffsets(host, through)
    if (!off) continue
    host.guests.push({ ...through, [side]: st, k: sl.k, of: other.sw, a: off.a, y: off.y })
  }
}

/** The coupling of one turnout, with the stretch it owns (switchCouplings). */
export function couplingOf(tracks, switches, sw, opts) {
  const own = switchCoupling(tracks, sw, opts)
  if (!own) return null
  // Only turnouts on its two tracks can share a stretch with it.
  const ids = new Set([own.main.track.id, own.branch.track.id])
  const near = (switches ?? []).filter(s => s.switchId === sw.switchId
    || [s.portB1_trackId, s.portB2_trackId].some(id => ids.has(id)))
  return couplingsOf(tracks, near, opts).find(c => c.sw.switchId === sw.switchId) ?? null
}

/** Is a station of one of the coupling's tracks behind WA, within the stretch it owns? */
export function inBody(c, side, station) {
  const d = c[side].distance(station)
  return d > STATION_TOL && d <= c.end[side] + STATION_TOL
}

/** Is a station of one of the coupling's tracks behind WA, within its reach — to the ldS? */
const inReach = (c, side, station) => {
  const d = c[side].distance(station)
  return d > STATION_TOL && d <= c.reach[side] + STATION_TOL
}

/** The sleeper nearest to a station of one of the coupling's tracks, among `among`. */
function nearestOf(among, c, side, station) {
  const key = side === 'main' ? 'm' : 'b'
  const d = c[side].distance(station)
  let best = null
  for (const sl of among) if (!best || Math.abs(sl[key] - d) < Math.abs(best[key] - d)) best = sl
  return best
}
const nearestSlot = (c, side, station) => nearestOf(c.slots, c, side, station)

/**
 * How far the branch lies above the main route on a sleeper (decision 257):
 * g · a + u/1500 · y, with g from the main route's heights `mainH`.
 */
const lift = (c, sl, mainH) => slopeAt(mainH, sl.main) * sl.a + (cantOn(c, sl) / RUNNING_CIRCLE_DISTANCE) * sl.y

/** Do the heights reach over a stretch of the track? */
const covers = (h, a, b) => Math.min(a, b) >= h[0].station - STATION_TOL && Math.max(a, b) <= h[h.length - 1].station + STATION_TOL

const byStation = (a, b) => a.station - b.station
/** What a point's partner takes over besides its height: its curve, the length that counts for it, and its reason. */
const carried = (p) => ({
  ...(p.rv != null ? { rv: p.rv } : {}), ...(p.la != null ? { la: p.la } : {}), ...(p.reason ? { reason: p.reason } : {}),
})
const samePoints = (a, b) => a.length === b.length && a.every((p, i) => {
  const q = b[i]
  return Math.abs(p.station - q.station) < 1e-9 && Math.abs(p.z - q.z) < 1e-9
    && (p.rv ?? null) === (q.rv ?? null) && (p.la ?? null) === (q.la ?? null) && (p.reason ?? null) === (q.reason ?? null)
})
/** The point a track already has on a sleeper, if any. */
const pointOn = (h, station) => h.find(p => Math.abs(p.station - station) <= STATION_TOL)
/** A height for a partner: the one it has where that is the plane's to the millimetre. */
const kept = (had, z) => (had && Math.abs(had.z - z) <= Z_TOL + 1e-9 ? had.z : roundHeight(z))

/**
 * The heights of both tracks of a turnout with every point in its stretch
 * paired (decision 258), `leader` ('main' or 'branch') the track whose points
 * count (decision 259): each of them on its nearest sleeper, one per sleeper,
 * and the other track with a point on the same sleeper — at the height the
 * plane gives it, with the same curve and reason — and no other point there.
 * The branch always has a point on the ldS; the main route only where the
 * branch's ldS height asks for one.
 *
 * Returns { main, branch } — the new heights of either, null where they stay —
 * or null where nothing changes, or where there is nothing to pair: a track
 * without a gradient over the stretch (decision 64, none is made up).
 */
export function pairedHeights(c, leader = 'main') {
  const mainH = c.main.track.heights, branchH = c.branch.track.heights
  if (!(mainH?.length >= 2) || !(branchH?.length >= 2) || !c.slots?.length) return null
  const last = c.slots[c.slots.length - 1]
  if (!covers(mainH, c.main.station(0), last.main) || !covers(branchH, c.branch.station(0), last.branch)) return null

  const lead = leader === 'branch' ? 'branch' : 'main'
  const onSleeper = new Map()
  for (const p of c[lead].track.heights) {
    if (!inReach(c, lead, p.station)) continue
    const sl = nearestSlot(c, lead, p.station)
    const had = onSleeper.get(sl)
    if (!had || Math.abs(c[lead].distance(p.station) - sl[lead === 'main' ? 'm' : 'b'])
      < Math.abs(c[lead].distance(had.station) - sl[lead === 'main' ? 'm' : 'b'])) onSleeper.set(sl, p)
  }
  const outside = (h, side) => h.filter(p => !inReach(c, side, p.station))
  const ldsSl = c.owned.find(sl => sl.k === 'lds') ?? null

  let newMain, newBranch
  if (lead === 'main') {
    newMain = [...outside(mainH, 'main'),
      ...[...onSleeper].map(([sl, p]) => ({ ...p, station: roundMm(sl.main) }))].sort(byStation)
    const pairs = [...onSleeper].map(([sl, p]) => ({ sl, z: p.z, from: p }))
    if (ldsSl && !onSleeper.has(ldsSl)) {
      const z = gradientAt(newMain, ldsSl.main)
      if (z != null) pairs.push({ sl: ldsSl, z, from: {} })
    }
    newBranch = [...outside(branchH, 'branch'), ...pairs.map(({ sl, z, from }) => ({
      station: roundMm(sl.branch), z: kept(pointOn(branchH, sl.branch), z + lift(c, sl, newMain)), ...carried(from),
    }))].sort(byStation)
  } else {
    newBranch = [...outside(branchH, 'branch'),
      ...[...onSleeper].map(([sl, p]) => ({ ...p, station: roundMm(sl.branch) }))].sort(byStation)
    const base = outside(mainH, 'main')
    const grid = [...onSleeper].filter(([sl]) => sl !== ldsSl)
    // The lift reads the main route's gradient, which these points make: twice round.
    newMain = base
    for (let k = 0; k < 2; k++) {
      newMain = [...base, ...grid.map(([sl, p]) => ({
        station: roundMm(sl.main), z: kept(pointOn(mainH, sl.main), p.z - lift(c, sl, newMain)), ...carried(p),
      }))].sort(byStation)
    }
    const atLds = ldsSl && onSleeper.get(ldsSl)
    if (atLds) {
      const z = atLds.z - lift(c, ldsSl, newMain)
      const had = pointOn(mainH, ldsSl.main)
      const there = gradientAt(newMain, ldsSl.main)
      if (had || there == null || Math.abs(there - z) > Z_TOL) {
        newMain = [...newMain, { station: roundMm(ldsSl.main), z: kept(had, z), ...carried(atLds) }].sort(byStation)
      }
    } else if (ldsSl) {
      // The branch's ldS point came away: it is the main route's again.
      const z = gradientAt(newMain, ldsSl.main)
      if (z != null) {
        newBranch = [...newBranch, { station: roundMm(ldsSl.branch), z: roundHeight(z + lift(c, ldsSl, newMain)) }].sort(byStation)
      }
    }
  }
  const main = samePoints(newMain, mainH) ? null : newMain
  const branch = samePoints(newBranch, branchH) ? null : newBranch
  return main || branch ? { main, branch } : null
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
 * Which track of a turnout a write led with (decision 259): the branch where
 * only its heights changed and the main route stayed as it was, the main
 * route in every other case — its heights, its shape or its cant changed, or
 * there is nothing before to compare with.
 */
function leaderOf(wasTrack, c) {
  const mainBefore = wasTrack.get(c.main.track.id), branchBefore = wasTrack.get(c.branch.track.id)
  const branchEdited = branchBefore && branchBefore.heights !== c.branch.track.heights
    && branchBefore.elements === c.branch.track.elements
  return branchEdited && mainBefore === c.main.track ? 'branch' : 'main'
}

const touches = (sw, ids) => [sw.portA_trackId, sw.portB1_trackId, sw.portB2_trackId].some(id => ids.has(id))

/**
 * The project after a write with every turnout the write reached paired again
 * (decisions 258, 259) — in the same step, so one undo takes back both. A
 * turnout that changes a track passes it on to the turnouts on that track: in
 * a run of turnouts the branch of one is the main route of the next. Each
 * turnout once per write; a turnout whose heights are locked is left alone.
 * The same project where nothing had to change.
 */
export function coupleSwitchHeights(before, after, { only = touchedTurnouts(before, after), formOf } = {}) {
  if (!only?.size) return after
  const wasTrack = new Map((before?.tracks ?? []).map(t => [t.id, t]))
  let project = after
  const queue = [...only]
  const done = new Set()
  while (queue.length) {
    const id = queue.shift()
    if (done.has(id)) continue
    done.add(id)
    const sw = (project.switches ?? []).find(s => s.switchId === id)
    if (!sw || sw.heightsLocked) continue
    const c = couplingOf(project.tracks ?? [], project.switches, sw, { formOf })
    if (!c) continue
    const r = pairedHeights(c, leaderOf(wasTrack, c))
    if (!r) continue
    const write = new Map([[c.main.track.id, r.main], [c.branch.track.id, r.branch]].filter(([, h]) => h))
    project = { ...project, tracks: project.tracks.map(t => (write.has(t.id) ? { ...t, heights: write.get(t.id) } : t)) }
    const ids = new Set(write.keys())
    for (const s of project.switches ?? []) if (!done.has(s.switchId) && isTurnout(s) && touches(s, ids)) queue.push(s.switchId)
  }
  return project
}

/**
 * The project with every turnout paired, its main route leading — for the
 * turnouts `only` names (their switchIds), or all of them: a project from
 * before the pairing, or the button that does it for all.
 */
export function coupleSwitchGradients(project, { only = null, formOf } = {}) {
  const ids = new Set((project?.switches ?? []).filter(sw => isTurnout(sw) && (!only || only.has(sw.switchId)))
    .map(sw => sw.switchId))
  return coupleSwitchHeights(null, project, { only: ids, formOf })
}

/** The turnouts whose heights are not paired yet — what „Alle Weichen koppeln“ would change. */
export function unpairedTurnouts(tracks, switches, opts) {
  return switchCouplings(tracks, switches, opts).filter(c => !c.sw.heightsLocked && pairedHeights(c, 'main'))
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
 * The height points of a track that lie in a turnout's stretch, by index:
 * { sw, side, sleeper } — the turnout, which of its tracks this is, and the
 * sleeper the point sits on (or would snap to). Each has a partner on the
 * same sleeper of the other track; what the profile marks, and locks where
 * the turnout's heights are locked. `dz` where the pair no longer lies in the
 * turnout's plane (planeDeviations), `also` the turnouts that share the
 * sleeper — in an overlap it carries three tracks (decision 264).
 */
export function coupledPoints(tracks, switches, track, opts) {
  const out = new Map()
  const cs = switchCouplings(tracks, switches, opts)
  for (const c of cs) {
    for (const side of ['main', 'branch']) {
      if (c[side].track.id !== track.id) continue
      const off = new Map(planeDeviations(c).map(d => [d.sleeper, d.dz]))
      ;(track.heights ?? []).forEach((p, i) => {
        if (!inBody(c, side, p.station)) return
        const sleeper = nearestSlot(c, side, p.station)
        out.set(i, {
          sw: c.sw, side, sleeper, also: sleeper.of ? [sleeper.of] : [],
          ...(off.has(sleeper) ? { dz: off.get(sleeper) } : {}),
        })
      })
    }
  }
  // Beyond the middle of an overlap a point is the neighbour's, and coupled
  // through this turnout as well (decision 264).
  for (const c of cs) {
    for (const side of ['main', 'branch']) {
      if (c[side].track.id !== track.id) continue
      ;(track.heights ?? []).forEach((p, i) => {
        const info = out.get(i)
        if (!info || info.sw === c.sw || !inReach(c, side, p.station) || info.also.includes(c.sw)) return
        out.set(i, { ...info, also: [...info.also, c.sw] })
      })
    }
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

// ── Locked heights (decision 260) ───────────────────────────────────────────

/**
 * What a locked turnout holds: the shape it lies on (the two tracks'
 * elements, how far its stretch reaches), the height of either track at WA
 * and on every sleeper it owns — as built, the gradient with its curves, so a
 * point moved beyond the stretch that tilts the gradient through it counts —
 * and the points stored there with their curves and reasons. Null where the
 * turnout has no coupling.
 */
function heldPoints(tracks, switches, sw, opts) {
  const c = couplingOf(tracks, switches, sw, opts)
  if (!c) return null
  const points = ['main', 'branch'].flatMap(side => {
    const h = c[side].track.heights ?? []
    // At the stations points are stored at, to the mm: a sleeper's own
    // station may lie a fraction of a mm beside its point.
    const built = [c[side].station(0), ...c.slots.map(sl => roundMm(sl[side]))]
      .map(st => ({ side, d: c[side].distance(st), z: gradientAt(h, st) }))
    const stored = h.map(p => ({ side, d: c[side].distance(p.station), z: p.z, rv: p.rv ?? null, reason: p.reason ?? null }))
      .filter(({ d }) => d >= -STATION_TOL && d <= c.reach[side] + STATION_TOL)
    return [...built, ...stored]
  })
  return { shape: [c.main.track.elements, c.branch.track.elements, c.reach.main, c.reach.branch], points }
}

const sameHeld = (a, b) => a.length === b.length && a.every((x, i) => {
  const y = b[i]
  return x.side === y.side && Math.abs(x.d - y.d) < 1e-6 && (x.z == null ? y.z == null : Math.abs(x.z - y.z) < 1e-9)
    && (x.rv ?? null) === (y.rv ?? null) && (x.reason ?? null) === (y.reason ?? null)
})

/**
 * The turnouts whose heights are locked — before the write and after it — and
 * which a write would change there: what the store refuses (decision 260).
 * A write that changes the shape a turnout lies on is not one of them: the
 * heights stay as they are, and planeDeviations says what no longer fits.
 */
export function lockedHeightsChanged(before, after, opts) {
  const wasSw = new Map((before?.switches ?? []).map(s => [s.switchId, s]))
  const out = []
  for (const id of touchedTurnouts(before, after)) {
    const sw = (after.switches ?? []).find(s => s.switchId === id)
    const was = wasSw.get(id)
    if (!sw?.heightsLocked || !was?.heightsLocked) continue
    const a = heldPoints(before.tracks ?? [], before.switches, was, opts)
    const b = heldPoints(after.tracks ?? [], after.switches, sw, opts)
    if (!a || !b || a.shape.some((v, i) => v !== b.shape[i])) continue
    if (!sameHeld(a.points, b.points)) out.push(sw)
  }
  return out
}

/** How far apart two heights may be before the plane counts as broken [m]: 0.2 mm. */
const PLANE_TOL = 0.0002

/**
 * Where a turnout's two tracks no longer lie in its plane (decision 260): on
 * every sleeper it owns that carries a point on either track, how far the
 * branch lies above or below where the plane puts it — [{ sleeper, main,
 * branch, dz }] with the stations on either track and dz [m], beyond 0.2 mm
 * (the heights are kept to 0.1 mm on both). Empty where it fits, or where
 * either track has no gradient there.
 */
export function planeDeviations(c) {
  const mainH = c.main.track.heights, branchH = c.branch.track.heights
  if (!(mainH?.length >= 2) || !(branchH?.length >= 2) || !c.slots?.length) return []
  const out = []
  for (const sl of c.slots) {
    const pm = pointOn(mainH, sl.main), pb = pointOn(branchH, sl.branch)
    if (!pm && !pb) continue
    const zm = pm?.z ?? gradientAt(mainH, sl.main)
    const zb = pb?.z ?? gradientAt(branchH, sl.branch)
    if (zm == null || zb == null) continue
    const dz = zb - (zm + lift(c, sl, mainH))
    if (Math.abs(dz) > PLANE_TOL) out.push({ sleeper: sl, main: sl.main, branch: sl.branch, dz })
  }
  return out
}
