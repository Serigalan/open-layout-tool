/**
 * The heights at a turnout's toe (WA) and last through sleeper (ldS)
 * (decision 384, replacing Paket WK's rules 269–276 and the button of 383).
 * The points there are not entered: each follows from the points either
 * side of it.
 *
 * - Main route: every WA and ldS point lies on the straight line between the
 *   nearest free point before it and the nearest one behind it, along the
 *   way a train runs — approach, main route, on over the WA of the next
 *   turnout (decision 270). Without a point before the WA (an open end) the
 *   WA is the line's end itself.
 * - Branch (the connecting track of a crossover is the branch of both): its
 *   WA is the end of the track and follows nothing on it — it is taken over
 *   from the main route; its ldS lies on the straight line from the point
 *   before it (its WA, or a free point between) to the first point behind
 *   it, which has to be a free one and its own — in a crossover one behind
 *   either ldS. Where there is none, the ldS stays as it is.
 *
 * Every WA and ldS point is there on both tracks, once the heights reach it.
 *
 * Coupled — the default — the tracks of a turnout meet there: the same
 * height at WA, and at the ldS the branch in the plane of the main route,
 * u/1500 · y above it (switchGradient). The track a write changed leads, the
 * other follows: a branch takes the WA as it is and puts the free point
 * behind its ldS where the line through the ldS meets the plane; a main
 * route puts the free point behind its ldS where its line meets the branch's
 * ldS, the branch's WA following its own. In the design mode
 * (Entwurfsmodus Weichen) nothing couples: the lines still hold, and one
 * height at a time is taken over into the other track on request
 * (takeOverHeight) — the mode ends only once every turnout fits again
 * (switchMisfits).
 *
 * Everything works on the stored points: a point's role follows from where it
 * lies, nothing marks it.
 */

import { endOfIndex, heightAt, jointGroup, roundHeight, turnoutDivergingPort, turnoutLinePort, portTrack, portEnd } from '../track'
import { ldsLift, roundMm, STATION_TOL, switchCouplings, Z_TOL } from './switchGradient'

const MAX_STEPS = 400
/** Coupling and a write's knock-on round again until nothing moves, at most this often. */
const MAX_PASSES = 12
/** Two heights fit to this — both are kept to 0.1 mm [m]. */
const FIT_TOL = 0.0002

// ── Where the turnouts are: what follows from the geometry alone ────────────

/**
 * One coupled turnout as the lines see it: its three ports (track and the end
 * at WA), the stations of the ldS on its main route and branch, how the
 * stations of either run from WA (+1 away, −1 toward), and its coupling (the
 * geometry the plane is read from).
 */
function entryOf(c) {
  const sw = c.sw
  const port = (p) => (portTrack(sw, p)
    ? { trackId: portTrack(sw, p), endpoint: portEnd(sw, p) === 'END' ? 'END' : 'BEGIN' }
    : null)
  return {
    sw, c,
    approach: port('A'), main: port(turnoutLinePort(sw)), branch: port(turnoutDivergingPort(sw)),
    ldsMain: roundMm(c.ldsMain), ldsBranch: roundMm(c.ldsBranch),
    mainSense: c.main.sense, branchSense: c.branch.sense,
  }
}

let lastIndex = null

/**
 * Every coupled turnout of a project, and where to find them: by the track
 * end at a toe, by the tracks carrying an ldS, by the tracks it lies on. It
 * follows from the geometry, so it is kept while that stays — heights change
 * on every write.
 */
function indexOf(tracks, switches, opts) {
  const key = [switches, opts?.formOf, ...tracks.map(t => t.elements)]
  if (lastIndex && lastIndex.key.length === key.length && lastIndex.key.every((v, i) => v === key[i])) return lastIndex.ix
  const entries = switchCouplings(tracks, switches, opts).map(entryOf)
  const toe = new Map(), ldsOn = new Map(), onTrack = new Map()
  const add = (m, k, v) => m.set(k, [...(m.get(k) ?? []), v])
  for (const e of entries) {
    for (const role of ['approach', 'main', 'branch']) {
      if (!e[role]) continue
      toe.set(`${e[role].trackId}|${e[role].endpoint}`, { e, role })
      add(onTrack, e[role].trackId, e)
    }
    add(ldsOn, e.main.trackId, { e, side: 'main', station: e.ldsMain })
    add(ldsOn, e.branch.trackId, { e, side: 'branch', station: e.ldsBranch })
  }
  const ix = { entries, toe, ldsOn, onTrack, byId: new Map(entries.map(e => [e.sw.switchId, e])) }
  lastIndex = { key, ix }
  return ix
}

const trackOf = (project, id) => project.tracks.find(t => t.id === id) ?? null
const heightsOf = (project, id) => trackOf(project, id)?.heights ?? null
const indexAt = (h, station) => (h ?? []).findIndex(p => Math.abs(p.station - station) <= STATION_TOL)

/**
 * What a stored point is: the toe of a turnout ('wa', `role` the port's —
 * approach, main or branch), an ldS ('lds', `side` main or branch), or a
 * free point.
 */
function classify(ix, track, index) {
  const end = endOfIndex(track, index)
  const atToe = end && ix.toe.get(`${track.id}|${end}`)
  if (atToe) return { kind: 'wa', e: atToe.e, role: atToe.role }
  const st = track.heights[index].station
  for (const x of ix.ldsOn.get(track.id) ?? []) {
    if (Math.abs(st - x.station) <= STATION_TOL) return { kind: 'lds', e: x.e, side: x.side }
  }
  return { kind: 'free' }
}
/** Is the point one the line of a main route holds — a toe it runs over, or its ldS? */
const onMainRoute = (cls) => (cls.kind === 'wa' && cls.role !== 'branch') || (cls.kind === 'lds' && cls.side === 'main')

// ── The lines of the main routes (decision 270) ─────────────────────────────

/**
 * The next stored point along the way from `pos` ({ trackId, index, dir },
 * dir ±1 the way the index runs), and how far it is: on the same track, or
 * over the toe of a coupled turnout — from its approach onto its main route,
 * from either of its other tracks onto the approach. Null at any other end.
 */
function step(ix, project, pos) {
  const h = heightsOf(project, pos.trackId)
  const j = pos.index + pos.dir
  if (j >= 0 && j < h.length) return { trackId: pos.trackId, index: j, dir: pos.dir, ds: Math.abs(h[j].station - h[pos.index].station) }
  const atToe = ix.toe.get(`${pos.trackId}|${pos.dir < 0 ? 'BEGIN' : 'END'}`)
  if (!atToe) return null
  const port = atToe.e[atToe.role === 'approach' ? 'main' : 'approach']
  const nh = port && heightsOf(project, port.trackId)
  if (!(nh?.length >= 2)) return null
  const fromBegin = port.endpoint === 'BEGIN'
  const index = fromBegin ? 1 : nh.length - 2
  return { trackId: port.trackId, index, dir: fromBegin ? 1 : -1, ds: Math.abs(nh[index].station - nh[fromBegin ? 0 : nh.length - 1].station) }
}

/**
 * The bound points one way from `start`, and the point the way ends at: the
 * first one that is not bound — free, or held by a branch's own line — or
 * null at a dead end.
 */
function walk(ix, project, start) {
  const list = []
  const seen = new Set([`${start.trackId}|${start.index}`])
  let pos = start, d = 0
  for (let n = 0; n < MAX_STEPS; n++) {
    const next = step(ix, project, pos)
    if (!next) return { list, end: null }
    const k = `${next.trackId}|${next.index}`
    if (seen.has(k)) return { list, end: null }
    seen.add(k)
    d += next.ds
    const track = trackOf(project, next.trackId)
    const cls = classify(ix, track, next.index)
    const item = { trackId: next.trackId, index: next.index, dir: next.dir, d, z: track.heights[next.index].z, cls }
    if (cls.kind === 'free') return { list, end: item }
    // A toe reached over its turnout's branch, a branch's ldS: their own
    // lines hold them, and this one ends there.
    if (!onMainRoute(cls)) return { list, end: { ...item, cls: { kind: 'held' } } }
    list.push(item)
    pos = next
  }
  return { list, end: null }
}

/**
 * The run of bound points through `start` (a bound point), along a distance d
 * from it: S and E the points it ends at (null at a dead end), `bound` the
 * points between, in order.
 */
function chainThrough(ix, project, start) {
  const track = trackOf(project, start.trackId)
  const self = { ...start, d: 0, z: track.heights[start.index].z, cls: classify(ix, track, start.index) }
  const fwd = walk(ix, project, { ...start, dir: 1 })
  const back = walk(ix, project, { ...start, dir: -1 })
  const flip = (p) => ({ ...p, d: -p.d })
  return {
    S: back.end && flip(back.end),
    E: fwd.end,
    bound: [...back.list.map(flip).reverse(), self, ...fwd.list],
  }
}

/** The line a chain's points lie on: through its two ends, or the bound point it starts at where it has none. */
function chainLine({ S, E, bound }) {
  const first = S ?? bound[0], last = E ?? bound[bound.length - 1]
  if (!(last.d > first.d)) return null
  return { d0: first.d, z0: first.z, g: (last.z - first.z) / (last.d - first.d) }
}
const onLine = (L, d) => L.z0 + L.g * (d - L.d0)

/** The stored index of a turnout's toe on one of its ports' tracks, or −1 where the heights do not reach it. */
function toeIndex(project, port) {
  const track = port && trackOf(project, port.trackId)
  const h = track?.heights
  if (!(h?.length >= 2)) return -1
  const index = port.endpoint === 'BEGIN' ? 0 : h.length - 1
  return endOfIndex(track, index) === port.endpoint ? index : -1
}

/** The chain of `e`'s main route through its toe ('wa') or its ldS ('lds'), with the start; null without that point. */
function mainChain(ix, project, e, at) {
  const index = at === 'wa' ? toeIndex(project, e.main) : indexAt(heightsOf(project, e.main.trackId), e.ldsMain)
  if (index < 0) return null
  const start = { trackId: e.main.trackId, index }
  return { start, chain: chainThrough(ix, project, start) }
}

/**
 * The end of a main route's chain behind the turnout — away from the
 * approach, the way the main route's stations run from WA — where it is a
 * free point that can move: the P of the line Q → P.
 */
function farEnd({ chain }, e) {
  const end = e.mainSense > 0 ? chain.E : chain.S
  return end?.cls.kind === 'free' ? end : null
}

// ── The line of a branch's ldS ──────────────────────────────────────────────

/**
 * Where the line through a branch's ldS runs: { trackId, a, lds, p } — the
 * stored indices of the point before it (its WA, or the nearest free point
 * between), of the ldS point and of the free point behind it (−1 where the
 * next point behind is none, or not free). Null without the ldS point.
 */
function branchLine(ix, project, e) {
  const track = trackOf(project, e.branch.trackId)
  const h = track?.heights
  const lds = indexAt(h, e.ldsBranch)
  if (lds < 0) return null
  // Toward WA the index runs against the way the stations leave it.
  const back = -e.branchSense
  let a = -1
  for (let i = lds + back; i >= 0 && i < h.length; i += back) {
    const cls = classify(ix, track, i)
    if (cls.kind === 'free' || (cls.kind === 'wa' && cls.e === e)) { a = i; break }
  }
  const next = lds + e.branchSense
  const p = h[next] && classify(ix, track, next).kind === 'free' ? next : -1
  return { trackId: track.id, a, lds, p }
}

/**
 * Is the free point behind a branch's ldS its own — not the one behind the
 * ldS of another turnout on the same track as well (a crossover with one
 * point between its two ldS)?
 */
function ownFree(ix, project, e, line) {
  if (line?.p == null || line.p < 0) return false
  return !(ix.ldsOn.get(line.trackId) ?? []).some(x => x.side === 'branch' && x.e !== e
    && branchLine(ix, project, x.e)?.p === line.p)
}

// ── Writing ─────────────────────────────────────────────────────────────────

function withHeights(project, byTrack) {
  if (!byTrack.size) return project
  return { ...project, tracks: project.tracks.map(t => (byTrack.has(t.id) ? { ...t, heights: byTrack.get(t.id) } : t)) }
}

/**
 * The points one height is written to with `ref`: the points joined to it —
 * but the toe of a branch is a point of its own (it is taken over, not
 * joined), and the toe of a main route does not take it along.
 */
function groupOf(ix, project, ref) {
  const track = trackOf(project, ref.trackId)
  const end = endOfIndex(track, ref.index)
  const isBranchToe = (r) => {
    const tr = trackOf(project, r.trackId)
    const en = tr && endOfIndex(tr, r.index)
    return !!en && ix.toe.get(`${r.trackId}|${en}`)?.role === 'branch'
  }
  if (end && isBranchToe(ref)) return [ref]
  return jointGroup(project.tracks, project.switches, ref).filter(r => !isBranchToe(r))
}

/** The project with one point — and its group (groupOf) — at height z, unless it is there already. */
function setHeight(ix, project, ref, z) {
  const h = heightsOf(project, ref.trackId)
  if (!h?.[ref.index] || z == null || Math.abs(h[ref.index].z - z) <= Z_TOL) return project
  // Just beyond the tolerance it may round to what is there already.
  const zr = roundHeight(z)
  if (Math.abs(h[ref.index].z - zr) < 1e-9) return project
  const byTrack = new Map()
  for (const p of groupOf(ix, project, ref)) {
    const hh = byTrack.get(p.trackId) ?? heightsOf(project, p.trackId)
    if (!hh?.[p.index]) continue
    byTrack.set(p.trackId, hh.map((q, i) => (i === p.index ? { ...q, z: zr } : q)))
  }
  return withHeights(project, byTrack)
}

/**
 * The project with an ldS point on either track of `e` where the heights
 * reach over it and none is there yet — on the gradient as it runs there, so
 * nothing changes but that the point is there to hold it.
 */
function withLdsPoints(project, e) {
  const byTrack = new Map()
  for (const [port, s] of [[e.main, e.ldsMain], [e.branch, e.ldsBranch]]) {
    const h = heightsOf(project, port.trackId)
    if (!(h?.length >= 2) || indexAt(h, s) >= 0) continue
    if (s <= h[0].station + STATION_TOL || s >= h[h.length - 1].station - STATION_TOL) continue
    byTrack.set(port.trackId, [...h, { station: s, z: roundHeight(heightAt(h, s)) }].sort((a, b) => a.station - b.station))
  }
  return withHeights(project, byTrack)
}

/** The project with the toe and the ldS of `e`'s main route on their lines (decision 270). */
function withMainLines(ix, project, e) {
  for (const at of ['wa', 'lds']) {
    const mc = mainChain(ix, project, e, at)
    const L = mc && chainLine(mc.chain)
    if (!L) continue
    for (const p of mc.chain.bound) project = setHeight(ix, project, p, onLine(L, p.d))
  }
  return project
}

/** The project with `e`'s branch ldS on the line from the point before it to the free one behind it. */
function withBranchLine(ix, project, e) {
  const line = branchLine(ix, project, e)
  if (!line || line.a < 0 || line.p < 0) return project
  const h = heightsOf(project, line.trackId)
  const [A, L, P] = [h[line.a], h[line.lds], h[line.p]]
  const z = A.z + (P.z - A.z) * (L.station - A.station) / (P.station - A.station)
  return setHeight(ix, project, { trackId: line.trackId, index: line.lds }, z)
}

/** Every line through `e`'s points held: its main route's, then its branch's. */
const withLines = (ix, project, e) => withBranchLine(ix, withMainLines(ix, project, e), e)

// ── How a turnout fits ──────────────────────────────────────────────────────

/** The height of `e`'s toe on its main route — or its approach, where the main route's heights do not reach it. */
function mainToeZ(project, e) {
  for (const port of [e.main, e.approach]) {
    const i = toeIndex(project, port)
    if (i >= 0) return heightsOf(project, port.trackId)[i].z
  }
  return null
}
const branchToeZ = (project, e) => {
  const i = toeIndex(project, e.branch)
  return i >= 0 ? heightsOf(project, e.branch.trackId)[i].z : null
}
/** The height of an ldS: its point, else the gradient there; null where the heights do not reach it. */
function ldsZ(project, port, station) {
  const h = heightsOf(project, port.trackId)
  if (!(h?.length >= 2) || station < h[0].station - STATION_TOL || station > h[h.length - 1].station + STATION_TOL) return null
  const i = indexAt(h, station)
  return i >= 0 ? h[i].z : heightAt(h, station)
}

/**
 * How far `e`'s tracks are apart from meeting: { wa, lds } [m] — the branch's
 * toe above the main route's, the branch's ldS above the plane of the main
 * route there —, each null where either track's heights do not reach it.
 */
function gaps(project, e) {
  const [zm, zb] = [mainToeZ(project, e), branchToeZ(project, e)]
  const [lm, lb] = [ldsZ(project, e.main, e.ldsMain), ldsZ(project, e.branch, e.ldsBranch)]
  const lift = lm != null && lb != null ? ldsLift(e.c, heightsOf(project, e.main.trackId)) : null
  return {
    wa: zm != null && zb != null ? zb - zm : null,
    lds: lift != null ? lb - (lm + lift) : null,
  }
}

/**
 * Where a project's turnouts do not fit — what keeps the design mode from
 * ending: [{ sw, at, dz }] with `at` 'wa' or 'lds' and dz how far the branch
 * lies above where it should [m], and [{ sw, at: 'lds', need: 'free_point' }]
 * where the branch has no free point of its own behind its ldS, which the
 * coupling would move. A turnout whose tracks have no heights there is left
 * out — nothing is made up.
 */
export function switchMisfits(project, opts) {
  if (!project?.tracks || !project.switches?.length) return []
  const ix = indexOf(project.tracks, project.switches, opts)
  const out = []
  for (const e of ix.entries) {
    const g = gaps(project, e)
    if (g.wa != null && Math.abs(g.wa) > FIT_TOL) out.push({ sw: e.sw, at: 'wa', dz: g.wa })
    if (g.lds != null && Math.abs(g.lds) > FIT_TOL) out.push({ sw: e.sw, at: 'lds', dz: g.lds })
    const line = g.lds != null && branchLine(ix, project, e)
    if (line && !ownFree(ix, project, e, line)) out.push({ sw: e.sw, at: 'lds', need: 'free_point' })
  }
  return out
}

// ── Taking a height over ────────────────────────────────────────────────────

/**
 * The project with a free point moved to where `residual` of the project —
 * after `apply` writes the point at a height, `z0` the one it has — comes to
 * nothing:
 * the secant from where it is, the residual running near enough straight
 * with it.
 */
function solveFree(project, apply, z0, residual) {
  let a = z0, ra = residual(apply(project, a))
  if (ra == null || Math.abs(ra) <= Z_TOL) return project
  let b = z0 + 0.01, rb = residual(apply(project, b))
  for (let k = 0; k < 4 && rb != null && Math.abs(rb) > Z_TOL / 2 && Math.abs(rb - ra) > 1e-12; k++) {
    const c = b - rb * (b - a) / (rb - ra)
    a = b; ra = rb
    b = c; rb = residual(apply(project, b))
  }
  return rb == null ? project : apply(project, roundHeight(b))
}

/** The branch of `e` given the toe of its main route, the line through its ldS with it. */
function branchToeFromMain(ix, project, e) {
  const z = mainToeZ(project, e)
  const i = toeIndex(project, e.branch)
  if (z == null || i < 0) return withBranchLine(ix, project, e)
  return withBranchLine(ix, setHeight(ix, project, { trackId: e.branch.trackId, index: i }, z), e)
}

/**
 * The branch's ldS brought into the plane of the main route: its own free
 * point behind it moved so the line through it meets the plane there. Null
 * where it has none.
 */
function branchLdsFromMain(ix, project, e) {
  const line = branchLine(ix, project, e)
  if (!ownFree(ix, project, e, line)) return null
  const ref = { trackId: line.trackId, index: line.p }
  const apply = (p, z) => withBranchLine(ix, setHeight(ix, p, ref, z), e)
  return solveFree(project, apply, heightsOf(project, ref.trackId)[ref.index].z, p => gaps(p, e).lds)
}

/**
 * The main route's ldS brought under the branch's, which stays: the free
 * point behind it on the main route moved so its line meets the plane there
 * — and with `toe`, the branch's toe following the main route's as it moves
 * (the coupled tracks). Null where the line ends at no free point.
 */
function mainLdsFromBranch(ix, project, e, { toe = false } = {}) {
  const mc = mainChain(ix, project, e, 'lds')
  const end = mc && farEnd(mc, e)
  if (!end) return null
  const lb = ldsZ(project, e.branch, e.ldsBranch)
  if (lb == null) return null
  const ref = { trackId: end.trackId, index: end.index }
  const apply = (p, z) => {
    const q = withMainLines(ix, setHeight(ix, p, ref, z), e)
    return toe ? branchToeFromMain(ix, q, e) : q
  }
  return solveFree(project, apply, heightsOf(project, ref.trackId)[ref.index].z, p => gaps(p, e).lds)
}

/**
 * The main route's toe brought to the branch's: the free point behind it on
 * the main route moved so its line meets that height at WA — or, with nothing
 * before the toe, the toe itself, which is the line's end. Null where the line
 * ends at no free point.
 */
function mainToeFromBranch(ix, project, e) {
  const z = branchToeZ(project, e)
  const mc = mainChain(ix, project, e, 'wa')
  if (z == null || !mc) return null
  const before = e.mainSense > 0 ? mc.chain.S : mc.chain.E
  if (!before) return withMainLines(ix, setHeight(ix, project, mc.start, z), e)
  const end = farEnd(mc, e)
  if (!end) return null
  const ref = { trackId: end.trackId, index: end.index }
  const apply = (p, q) => withMainLines(ix, setHeight(ix, p, ref, q), e)
  return solveFree(project, apply, heightsOf(project, ref.trackId)[ref.index].z, p => mainToeZ(p, e) - z)
}

/**
 * The project with one height of a turnout taken over into its other track
 * (the design mode's button): `at` 'wa' or 'lds', `from` 'main' or 'branch'
 * — the track whose height counts. Into the branch: its toe takes the main
 * route's height; at the ldS the free point behind it moves so the line
 * through it meets the plane. Into the main route: the free point behind the
 * point — the P of the line Q → P — moves so the line meets the branch's
 * height there, or under it by the plane at the ldS. Returns { project }
 * (the same where it fits already) or { error }: 'not_coupled', 'no_height'
 * (a track's heights do not reach the point), 'no_free_point' (no free point
 * to move).
 */
export function takeOverHeight(project, switchId, at, from, opts) {
  const ix = indexOf(project.tracks, project.switches, opts)
  const e = ix.byId.get(switchId)
  if (!e) return { error: 'not_coupled' }
  let p = withLines(ix, withLdsPoints(project, e), e)
  const g = gaps(p, e)
  if (g[at] == null) return { error: 'no_height' }
  if (Math.abs(g[at]) <= FIT_TOL) return { project: p }
  const next = at === 'wa'
    ? (from === 'main' ? branchToeFromMain(ix, p, e) : mainToeFromBranch(ix, p, e))
    : (from === 'main' ? branchLdsFromMain(ix, p, e) : mainLdsFromBranch(ix, p, e))
  return next ? { project: next } : { error: 'no_free_point' }
}

// ── After every write (the store) ───────────────────────────────────────────

/**
 * Which track of `e` leads: the one the write changed; where it changed both
 * or neither, the main route. A track whose heights did not reach the
 * turnout before never leads while the other's did.
 */
function leaderOf(e, before, written) {
  const covered = (id, s) => {
    const tr = before.get(id)
    const h = tr?.heights
    return h?.length >= 2 && s >= h[0].station - STATION_TOL && s <= h[h.length - 1].station + STATION_TOL
  }
  const [mainNew, branchNew] = [!covered(e.main.trackId, e.ldsMain), !covered(e.branch.trackId, e.ldsBranch)]
  if (branchNew && !mainNew) return 'main'
  if (mainNew && !branchNew) return 'branch'
  return written.has(e.branch.trackId) && !written.has(e.main.trackId) ? 'branch' : 'main'
}

/** One turnout coupled, `leader` the track that counts. */
function couple(ix, project, e, leader) {
  const g = gaps(project, e)
  if ((g.wa == null || Math.abs(g.wa) <= FIT_TOL) && (g.lds == null || Math.abs(g.lds) <= FIT_TOL)) return project
  if (leader === 'branch' && g.lds != null) {
    const p = mainLdsFromBranch(ix, project, e, { toe: true })
    if (p) return p
  }
  // The main route leads — or has to, where its line has no free point to move.
  const p = branchToeFromMain(ix, project, e)
  return branchLdsFromMain(ix, p, e) ?? p
}

/**
 * What the store does to a write (`after`, from `before`): every turnout on a
 * track it changed gets its ldS points, its WA and ldS on their lines, and —
 * unless `design` — its tracks coupled, the track the write changed leading;
 * then again for the turnouts on the tracks that moved with it, until nothing
 * moves. The same project where nothing changes.
 */
export function withSwitchHeights(before, after, { design = false, opts } = {}) {
  if (!after?.tracks || !after.switches?.length) return after
  const ix = indexOf(after.tracks, after.switches, opts)
  if (!ix.entries.length) return after
  const was = new Map((before?.tracks ?? []).map(t => [t.id, t]))
  const changedFrom = (from, to) => new Set(to.tracks.filter(t => {
    const b = from.get(t.id)
    return !b || b.heights !== t.heights || b.elements !== t.elements
  }).map(t => t.id))
  const written = new Set(after.tracks.filter(t => was.get(t.id)?.heights !== t.heights).map(t => t.id))
  let changed = changedFrom(was, after)
  let p = after
  for (let n = 0; n < MAX_PASSES && changed.size; n++) {
    const todo = new Set([...changed].flatMap(id => ix.onTrack.get(id) ?? []))
    if (!todo.size) break
    const start = p
    for (const e of todo) p = withLines(ix, withLdsPoints(p, e), e)
    if (!design) for (const e of todo) p = couple(ix, p, e, leaderOf(e, was, written))
    changed = changedFrom(new Map(start.tracks.map(t => [t.id, t])), p)
  }
  return p
}

// ── What the profile may change ─────────────────────────────────────────────

let lastRoles = null

/**
 * What every WA and ldS point of a project is, by track and stored index —
 * what the profile and its table show only:
 *   { kind: 'wa', sw, side }     toe of a turnout ('main' on the approach and
 *                                main route, 'branch' on the branch)
 *   { kind: 'lds', sw, side }    ldS point on the main route or branch
 *   { kind: 'locked', was }      a point locked by hand (Entscheidung 382),
 *                                `was` the role it has besides, or null
 */
export function heightRoles(project, opts) {
  if (!project?.tracks) return new Map()
  if (lastRoles?.tracks === project.tracks && lastRoles.switches === project.switches && lastRoles.formOf === opts?.formOf) {
    return lastRoles.result
  }
  const ix = indexOf(project.tracks, project.switches ?? [], opts)
  const out = new Map()
  const put = (trackId, index, role) => {
    if (index < 0) return
    if (!out.has(trackId)) out.set(trackId, new Map())
    out.get(trackId).set(index, role)
  }
  for (const e of ix.entries) {
    put(e.main.trackId, indexAt(heightsOf(project, e.main.trackId), e.ldsMain), { kind: 'lds', sw: e.sw, side: 'main' })
    put(e.branch.trackId, indexAt(heightsOf(project, e.branch.trackId), e.ldsBranch), { kind: 'lds', sw: e.sw, side: 'branch' })
  }
  for (const e of ix.entries) {
    for (const role of ['approach', 'main', 'branch']) {
      if (e[role]) put(e[role].trackId, toeIndex(project, e[role]), { kind: 'wa', sw: e.sw, side: role === 'branch' ? 'branch' : 'main' })
    }
  }
  for (const t of project.tracks) {
    (t.heights ?? []).forEach((p, index) => {
      if (p.locked) put(t.id, index, { kind: 'locked', was: out.get(t.id)?.get(index) ?? null })
    })
  }
  lastRoles = { tracks: project.tracks, switches: project.switches, formOf: opts?.formOf, result: out }
  return out
}
