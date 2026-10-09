/**
 * The coupling points at the ldS (Paket WK, decisions 269–272): no gradient
 * changes at the toe (WA) or the last through sleeper (ldS) of a turnout —
 * the points there are not entered but follow from points outside it.
 *
 * - Main route (270): every WA and ldS point lies on the straight line
 *   between the nearest free point before it and the nearest one behind it,
 *   along the way a train runs — approach, main route, on over the WA of the
 *   next turnout. Without a point before the WA (an open end, a switch that is
 *   not coupled) the WA is free itself.
 * - Branch (271): its ldS point lies in the turnout's plane (switchGradient,
 *   decision 269); the first point behind it lies on the continuation of the
 *   gradient the branch runs into the ldS with — only its station and the
 *   gradient beyond it are entered. Where the track ends first, its end is
 *   that point; at the WA of the next turnout that WA follows the
 *   continuation, and so does the next turnout's main route up to its own
 *   first free point.
 * - Crossover (272), the connecting track the branch of both turnouts: more
 *   than 20 m between the two ldS carry exactly one point, where the two
 *   continuations meet; 20 m or less carry none, and the leading turnout
 *   sets the toe of the other with its continuation, whose main route's line
 *   is shifted up or down to run through it — the points before and behind
 *   it on the other track rise or fall by the same amount. The leading one
 *   is the one whose track the write changed (decision 275); where it changed
 *   neither or both, the one that sets the other's toe already, and where
 *   none does, the one whose main track comes first in the project.
 *
 * The points between WA and ldS are paired on the sleepers as before
 * (switchGradient.pairedHeights, decisions 258–259, 264); a point of the main
 * route between them is a free point and splits its line.
 *
 * Everything works on the stored points: a point's role follows from where it
 * lies, nothing marks it. The store couples after every write
 * (coupleSwitchHeights), and `heightRoles` tells the profile what it may let
 * the user change.
 */

import { heightAt, gradientAt, jointGroup, roundHeight } from './heightUtils'
import {
  carried, couplingOf, isTurnout, ldsPlaneHeight, pairedHeights, roundMm, STATION_TOL, switchCouplings, touchedTurnouts, Z_TOL,
} from './switchGradient'
import { turnoutDivergingPort, turnoutLinePort } from './switchModel'

/** Between two ldS of a crossover, more than this carries a point of its own [m] (decision 272). */
export const CROSSOVER_SPAN = 20

const MAX_STEPS = 400

// ── Where the turnouts are: what follows from the geometry alone ────────────

/**
 * One coupled turnout as the chains see it: its three ports (track and the
 * end at WA), the stations of the ldS on its main route and branch, and how
 * the stations of either run from WA (+1 away, −1 toward).
 */
function entryOf(c, order) {
  const sw = c.sw
  const port = (p) => (sw[`port${p}_trackId`]
    ? { trackId: sw[`port${p}_trackId`], endpoint: sw[`port${p}_endpoint`] === 'END' ? 'END' : 'BEGIN' }
    : null)
  return {
    sw, order,
    approach: port('A'), main: port(turnoutLinePort(sw)), branch: port(turnoutDivergingPort(sw)),
    ldsMain: roundMm(c.ldsMain), ldsBranch: roundMm(c.ldsBranch),
    mainSense: c.main.sense, branchSense: c.branch.sense,
    branchWa: c.branch.station(0), branchReach: c.reach.branch,
    // Where its ldS sleeper lies in the part of another turnout (decision
    // 264), it carries no ldS point of its own.
    mainLdsOwn: c.owned.some(sl => sl.k === 'lds'),
  }
}

let lastIndex = null

/**
 * Every coupled turnout of a project, and where to find them: by the track
 * end at a toe, by the main track carrying an ldS, by the branch track. It
 * follows from the geometry, so it is kept while that stays — heights change
 * on every write.
 */
function indexOf(tracks, switches, opts) {
  const key = [switches, opts?.formOf, ...tracks.map(t => t.elements)]
  if (lastIndex && lastIndex.key.length === key.length && lastIndex.key.every((v, i) => v === key[i])) return lastIndex.ix
  const trackOrder = new Map(tracks.map((t, i) => [t.id, i]))
  const swOrder = new Map((switches ?? []).map((s, i) => [s.switchId, i]))
  const entries = switchCouplings(tracks, switches, opts).map(c => entryOf(c, [
    trackOrder.get(c.main.track.id) ?? 0, swOrder.get(c.sw.switchId) ?? 0,
  ]))
  const toe = new Map(), ldsOn = new Map(), branchOn = new Map()
  const add = (m, k, v) => m.set(k, [...(m.get(k) ?? []), v])
  for (const e of entries) {
    for (const role of ['approach', 'main', 'branch']) {
      if (e[role]) toe.set(`${e[role].trackId}|${e[role].endpoint}`, { e, role })
    }
    if (e.mainLdsOwn) add(ldsOn, e.main.trackId, e)
    add(branchOn, e.branch.trackId, e)
  }
  const ix = { entries, toe, ldsOn, branchOn, byId: new Map(entries.map(e => [e.sw.switchId, e])) }
  lastIndex = { key, ix }
  return ix
}

const heightsOf = (project, id) => project.tracks.find(t => t.id === id)?.heights ?? null
const endOf = (h, index) => (index === 0 ? 'BEGIN' : index === h.length - 1 ? 'END' : null)
const leads = (a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]

/** Distance of a branch station from the turnout's WA. */
const branchDistance = (e, station) => (station - e.branchWa) * e.branchSense

/**
 * What a stored point is to the chains: the toe of a turnout ('wa'), the ldS
 * on a main route ('lds') — both bound to the line through their neighbours —,
 * a point of a branch from behind WA to its ldS ('plane', held by the
 * turnout's plane; `lds` where it is the ldS point), or a free point.
 */
function classify(ix, trackId, h, index) {
  const end = endOf(h, index)
  const atToe = end && ix.toe.get(`${trackId}|${end}`)
  if (atToe) return { kind: 'wa', e: atToe.e, role: atToe.role }
  const st = h[index].station
  for (const e of ix.branchOn.get(trackId) ?? []) {
    const d = branchDistance(e, st)
    if (d > STATION_TOL && d <= e.branchReach + STATION_TOL) {
      return { kind: 'plane', e, lds: Math.abs(st - e.ldsBranch) <= STATION_TOL }
    }
  }
  for (const e of ix.ldsOn.get(trackId) ?? []) {
    if (Math.abs(st - e.ldsMain) <= STATION_TOL) return { kind: 'lds', e }
  }
  return { kind: 'free' }
}
const bound = (cls) => cls.kind === 'wa' || cls.kind === 'lds'

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
 * first one that is not bound, or null at a dead end.
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
    const h = heightsOf(project, next.trackId)
    const item = { trackId: next.trackId, index: next.index, dir: next.dir, d, z: h[next.index].z, cls: classify(ix, next.trackId, h, next.index) }
    // A toe reached over its turnout's branch is not on this way: the line of
    // its own main route holds it, and this one ends there.
    if (item.cls.kind === 'wa' && item.cls.role === 'branch') return { list, end: { ...item, cls: { ...item.cls, kind: 'held' } } }
    if (!bound(item.cls)) return { list, end: item }
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
  const h = heightsOf(project, start.trackId)
  const self = { ...start, d: 0, z: h[start.index].z, cls: classify(ix, start.trackId, h, start.index) }
  const fwd = walk(ix, project, { ...start, dir: 1 })
  const back = walk(ix, project, { ...start, dir: -1 })
  const flip = (p) => ({ ...p, d: -p.d, back: true })
  return {
    S: back.end && flip(back.end),
    E: fwd.end,
    bound: [...back.list.map(flip).reverse(), self, ...fwd.list],
  }
}

/** A stored point closer than this to the ldS does not set the gradient into it [m]: its 0.1 mm would. */
const SLOPE_BASE = 2

/**
 * The line a branch runs on behind its ldS (decision 271): through the height
 * it has at the ldS — `z0`, or as stored there — with the gradient of the
 * stretch it runs into it from the WA side, from the last stored point at
 * least 2 m before it: { s0, z0, g } in the branch's stations. Null without
 * one.
 */
function ldsLine(h, s0, sense, z0 = heightAt(h ?? [], s0)) {
  if (!(h?.length >= 2) || z0 == null) return null
  const before = sense > 0
    ? [...h].reverse().find(p => p.station < s0 - SLOPE_BASE)
    : h.find(p => p.station > s0 + SLOPE_BASE)
  if (!before) return null
  return { s0, z0, g: (z0 - before.z) / (s0 - before.station) }
}
const onLine = (L, s) => L.z0 + L.g * (s - L.s0)

/** The other turnout of a crossover whose connecting track is `e`'s branch, or null. */
function crossoverPartner(ix, project, e) {
  const h = heightsOf(project, e.branch.trackId)
  if (!h) return null
  const farEnd = e.branch.endpoint === 'BEGIN' ? 'END' : 'BEGIN'
  return (ix.branchOn.get(e.branch.trackId) ?? []).find(o => o !== e && o.branch.endpoint === farEnd) ?? null
}

/** How far apart the two ldS of a crossover lie along its connecting track [m]. */
const crossoverGap = (e, o) => (o.ldsBranch - e.ldsBranch) * e.branchSense

/**
 * Does `a` lead over `b`, the other turnout of its crossover (decisions 272,
 * 275)? As the write decided (`opts.crossLead`), else by the order in the
 * project.
 */
const leadsOver = (a, b, opts) => opts?.crossLead?.get(a.sw.switchId) ?? leads(a, b) < 0

/** The end of the connecting track at `e`'s toe: its index there. */
const toeEndIndex = (h, e) => (e.branch.endpoint === 'BEGIN' ? 0 : h.length - 1)

/**
 * The height the continuation of `o` gives the toe of `e`, the other turnout
 * of its crossover: carried to `e`'s end of the connecting track. Null
 * without one.
 */
function toeFrom(project, e, o, opts) {
  const h = heightsOf(project, e.branch.trackId)
  if (!(h?.length >= 2)) return null
  // Where the two stretches overlap, the leading turnout has no ldS point of
  // its own (decision 264): its plane gives the height there.
  const own = h.find(p => Math.abs(p.station - o.ldsBranch) <= STATION_TOL)
  const c = !own && couplingOf(project.tracks, project.switches, o.sw, opts)
  const L = ldsLine(h, o.ldsBranch, o.branchSense, own ? own.z : c ? ldsPlaneHeight(c) : null)
  if (!L) return null
  return onLine(L, h[toeEndIndex(h, e)].station)
}

/**
 * The height a crossover's leading turnout gives the toe of the other (decision
 * 272), where the two ldS lie 20 m apart or less: its continuation carried to
 * that end of the connecting track. Null where `e` leads, or is no such toe.
 */
function crossoverToe(ix, project, e, opts) {
  const o = crossoverPartner(ix, project, e)
  if (!o || crossoverGap(e, o) > CROSSOVER_SPAN || !leadsOver(o, e, opts)) return null
  return toeFrom(project, e, o, opts)
}

/** A toe and the continuation of the other turnout agree to this where that one sets it [m]: both are kept to 0.1 mm. */
const SETS_TOL = 0.00015

/** The stations at which two height lists differ: a point in one that the other lacks, or has at another height. */
function changedStations(a, b) {
  const has = (h, p) => h.some(q => Math.abs(q.station - p.station) < 1e-9 && Math.abs(q.z - p.z) < 1e-9)
  return [...a.filter(p => !has(b, p)), ...b.filter(p => !has(a, p))].map(p => p.station)
}

/**
 * Did the write from `before` to `after` change the side of a crossover's
 * turnout `e` (decision 275): its main route's line through the toe — any
 * point from the one before WA to the one behind it, on whichever tracks the
 * way runs — or its own points on the connecting track, between WA and ldS?
 */
function sideEdited(ix, before, after, e, edited) {
  const changedWithin = (id, lo, hi) => {
    if (!edited.has(id)) return false
    const st = changedStations(heightsOf(before, id) ?? [], heightsOf(after, id) ?? [])
    return st.some(s => s >= lo - STATION_TOL && s <= hi + STATION_TOL)
  }
  const mh = heightsOf(after, e.main.trackId)
  if (mh?.length >= 2) {
    const ch = chainThrough(ix, after, { trackId: e.main.trackId, index: mainToeIndex(after, e) })
    const range = new Map()
    for (const p of [ch.S, ...ch.bound, ch.E]) {
      if (!p) continue
      const s = heightsOf(after, p.trackId)[p.index].station
      const r = range.get(p.trackId)
      range.set(p.trackId, r ? [Math.min(r[0], s), Math.max(r[1], s)] : [s, s])
    }
    // A way that ends at a dead end runs to the end of its track.
    for (const [p, q] of [[ch.S, ch.bound[0]], [ch.E, ch.bound[ch.bound.length - 1]]]) {
      if (p || !q) continue
      const h = heightsOf(after, q.trackId)
      const r = range.get(q.trackId)
      range.set(q.trackId, [Math.min(r[0], h[0].station), Math.max(r[1], h[h.length - 1].station)])
    }
    for (const [id, [lo, hi]] of range) if (changedWithin(id, lo, hi)) return true
  }
  const lo = Math.min(e.branchWa, e.branchWa + e.branchSense * e.branchReach)
  const hi = Math.max(e.branchWa, e.branchWa + e.branchSense * e.branchReach)
  return changedWithin(e.branch.trackId, lo + STATION_TOL, hi)
}

/**
 * Which turnout of every crossover with 20 m or less between its ldS leads
 * (decision 275), by switchId (true where it leads): the one whose side the
 * write changed; where it changed neither or both — or there was nothing
 * before — the one that sets the other's toe already, in the project as it
 * was where its geometry stayed; where neither or both do, the one whose main
 * track comes first in the project.
 */
function crossoverLeads(ix, before, after, opts) {
  const out = new Map()
  const was = before && new Map(before.tracks.map(t => [t.id, t]))
  const edited = was && new Set(after.tracks.filter(t => was.get(t.id)?.heights !== t.heights).map(t => t.id))
  const sameShape = was && before.switches === after.switches
    && before.tracks.length === after.tracks.length && after.tracks.every(t => was.get(t.id)?.elements === t.elements)
  const state = sameShape ? before : after
  const sets = (a, b) => {
    const z = toeFrom(state, b, a, opts)
    const h = heightsOf(state, b.branch.trackId)
    return z != null && h?.length >= 2 && Math.abs(h[toeEndIndex(h, b)].z - z) <= SETS_TOL
  }
  for (const e of ix.entries) {
    if (out.has(e.sw.switchId)) continue
    const o = crossoverPartner(ix, after, e)
    if (!o || crossoverGap(e, o) > CROSSOVER_SPAN) continue
    let eLeads = null
    if (edited?.size) {
      const [eEd, oEd] = [sideEdited(ix, before, after, e, edited), sideEdited(ix, before, after, o, edited)]
      if (eEd !== oEd) eLeads = eEd
    }
    if (eLeads == null) {
      const [eSets, oSets] = [sets(e, o), sets(o, e)]
      eLeads = eSets !== oSets ? eSets : leads(e, o) < 0
    }
    out.set(e.sw.switchId, eLeads)
    out.set(o.sw.switchId, !eLeads)
  }
  return out
}

/**
 * The continuation a chain end carries, where it is the ldS point of a branch
 * and the chain lies behind it (decision 271): the line in the chain's
 * distance d, or null.
 */
function continuationOf(project, end) {
  if (end?.cls.kind !== 'plane' || !end.cls.lds) return null
  const e = end.cls.e
  // Reached from behind the ldS means moving toward WA.
  if (end.dir !== -e.branchSense) return null
  const L = ldsLine(heightsOf(project, end.trackId), heightsOf(project, end.trackId)[end.index].station, e.branchSense)
  if (!L) return null
  // Rise per metre away from WA; the chain lies on that side of `end`, toward
  // larger d where `end` is S, smaller where it is E.
  const away = L.g * e.branchSense
  return { d0: end.d, z0: end.z, g: end.back ? away : -away }
}

/**
 * The heights a chain gives its points: { line, writes: [{ ref, z }], free }
 * — `free` the end it set on a continuation, if any (with the line, so the
 * profile can move it along it).
 */
function solveChain(ix, project, chain, opts) {
  const { S, E, bound: pts } = chain
  const first = S ?? pts[0], last = E ?? pts[pts.length - 1]
  const cS = continuationOf(project, S), cE = continuationOf(project, E)
  const isFree = (p) => p && p.cls.kind === 'free'
  let line = null
  const set = []
  if (cS) { line = cS; if (isFree(E)) set.push(E) }
  else if (cE) { line = cE; if (isFree(S)) set.push(S) }
  else {
    if (!(last.d > first.d)) return null
    line = { d0: first.d, z0: first.z, g: (last.z - first.z) / (last.d - first.d) }
    // The toe a crossover's leading turnout sets (decision 272): the line is
    // shifted to run through it, its free ends with it — or turned about an
    // end the plane holds.
    const toeOf = (p) => (p.cls.kind === 'wa' ? crossoverToe(ix, project, p.cls.e, opts) : null)
    const held = pts.find(p => toeOf(p) != null)
    if (held) {
      const zA = toeOf(held)
      // A free end that a line held by another crossover ends at too — two
      // crossovers on the same pair of tracks — stays where it is: both lines
      // turn about it rather than move it in turn.
      const shared = (p) => isFree(p) && walk(ix, project, { trackId: p.trackId, index: p.index, dir: p.dir }).list
        .some(q => toeOf(q) != null)
      const pinned = (p) => p && (!isFree(p) || shared(p))
      const fixed = pinned(S) ? S : pinned(E) ? E : null
      if (fixed && fixed.d !== held.d) {
        line = { d0: fixed.d, z0: fixed.z, g: (zA - fixed.z) / (held.d - fixed.d) }
        for (const p of [S, E]) if (isFree(p) && !pinned(p)) set.push(p)
      } else {
        line = { ...line, z0: line.z0 + zA - (line.z0 + line.g * (held.d - line.d0)) }
        for (const p of [S, E]) if (isFree(p)) set.push(p)
      }
    }
  }
  const at = (d) => line.z0 + line.g * (d - line.d0)
  const writes = [...pts, ...set].map(p => ({ ref: { trackId: p.trackId, index: p.index }, z: at(p.d) }))
  const cont = cS ? E : cE ? S : null
  return { line, writes, free: cont && isFree(cont) ? { point: cont, line } : null }
}

// ── Writing ─────────────────────────────────────────────────────────────────

/** The project with one point — and every point joined to it — at height z, unless it is there already. */
function setHeight(project, ref, z) {
  const h = heightsOf(project, ref.trackId)
  if (!h?.[ref.index] || z == null || Math.abs(h[ref.index].z - z) <= Z_TOL) return project
  const zr = roundHeight(z)
  const group = jointGroup(project.tracks, project.switches, ref)
  const byTrack = new Map()
  for (const p of group) {
    const hh = byTrack.get(p.trackId) ?? heightsOf(project, p.trackId)
    if (!hh?.[p.index]) continue
    byTrack.set(p.trackId, hh.map((q, i) => (i === p.index ? { ...q, z: zr } : q)))
  }
  return withHeights(project, byTrack)
}

function withHeights(project, byTrack) {
  if (!byTrack.size) return project
  return { ...project, tracks: project.tracks.map(t => (byTrack.has(t.id) ? { ...t, heights: byTrack.get(t.id) } : t)) }
}

/** The main route of `e` with a point on its ldS (decision 269), on the gradient it has there. */
function withMainLds(project, e) {
  const h = heightsOf(project, e.main.trackId)
  if (!e.mainLdsOwn || !(h?.length >= 2) || h.some(p => Math.abs(p.station - e.ldsMain) <= STATION_TOL)) return project
  if (e.ldsMain <= h[0].station || e.ldsMain >= h[h.length - 1].station) return project
  const z = gradientAt(h, e.ldsMain)
  if (z == null) return project
  const next = [...h, { station: e.ldsMain, z: roundHeight(z) }].sort((a, b) => a.station - b.station)
  return withHeights(project, new Map([[e.main.trackId, next]]))
}

/** The stored index of the ldS on `e`'s main route, or −1. */
const mainLdsIndex = (project, e) => (!e.mainLdsOwn ? -1 : (heightsOf(project, e.main.trackId) ?? []).findIndex(p => Math.abs(p.station - e.ldsMain) <= STATION_TOL))
/** The stored index of `e`'s toe on its main route. */
const mainToeIndex = (project, e) => (e.main.endpoint === 'BEGIN' ? 0 : (heightsOf(project, e.main.trackId)?.length ?? 0) - 1)

/** The project with the toe and the main route's ldS of `e` on their lines (decision 270). */
function withMainLines(ix, project, e, opts) {
  for (const index of [mainToeIndex(project, e), mainLdsIndex(project, e)]) {
    if (index < 0) continue
    const r = solveChain(ix, project, chainThrough(ix, project, { trackId: e.main.trackId, index }), opts)
    if (!r) continue
    for (const w of r.writes) project = setHeight(project, w.ref, w.z)
  }
  return project
}

/**
 * The project with `e`'s branch behind its ldS as decisions 271–272 ask: the
 * first point there on the continuation, or the crossover's stretch between
 * the two ldS with its one point or none. Returns { project, rerun } — the
 * other turnout of a crossover whose toe `e` now sets.
 */
function withBranchBeyond(ix, project, e, opts) {
  const id = e.branch.trackId
  const h = heightsOf(project, id)
  if (!(h?.length >= 2)) return { project, rerun: null }
  const o = crossoverPartner(ix, project, e)
  if (o) return withCrossoverMiddle(ix, project, e, o, opts)
  const iL = h.findIndex(p => Math.abs(p.station - e.ldsBranch) <= STATION_TOL)
  if (iL < 0) return { project, rerun: null }
  const iN = iL + e.branchSense
  const L = ldsLine(h, e.ldsBranch, e.branchSense)
  if (!h[iN] || !L) return { project, rerun: null }
  return { project: setHeight(project, { trackId: id, index: iN }, onLine(L, h[iN].station)), rerun: null }
}

function withCrossoverMiddle(ix, project, e, o, opts) {
  const id = e.branch.trackId
  const h = heightsOf(project, id)
  const gap = crossoverGap(e, o)
  const rerun = gap <= CROSSOVER_SPAN && leadsOver(e, o, opts) ? o.sw.switchId : null
  // Where the two stretches overlap, the long sleepers hold what lies between (decision 264).
  if (!(gap > STATION_TOL)) return { project, rerun }
  const lo = Math.min(e.ldsBranch, o.ldsBranch), hi = Math.max(e.ldsBranch, o.ldsBranch)
  const between = h.filter(p => p.station > lo + STATION_TOL && p.station < hi - STATION_TOL)
  const rest = h.filter(p => !between.includes(p))
  let middle = []
  if (gap > CROSSOVER_SPAN) {
    const L1 = ldsLine(h, e.ldsBranch, e.branchSense), L2 = ldsLine(h, o.ldsBranch, o.branchSense)
    if (L1 && L2 && Math.abs(L1.g - L2.g) > 1e-12) {
      const s = (L2.z0 - L1.z0 + L1.g * L1.s0 - L2.g * L2.s0) / (L1.g - L2.g)
      if (s > lo + STATION_TOL && s < hi - STATION_TOL) {
        const had = between.reduce((best, p) => (!best || Math.abs(p.station - s) < Math.abs(best.station - s) ? p : best), null)
        const station = roundMm(s)
        // At the meeting point itself, not the station rounded to the
        // millimetre: there both lines agree, whichever turnout asks.
        const z = onLine(L1, s)
        middle = [{
          station, z: had && Math.abs(had.station - station) < 1e-9 && Math.abs(had.z - z) <= Z_TOL ? had.z : roundHeight(z),
          ...(had ? carried(had) : {}),
        }]
      }
    }
  }
  const same = between.length === middle.length && between.every((p, i) => p.station === middle[i].station && p.z === middle[i].z)
  const next = same ? project : withHeights(project, new Map([[id, [...rest, ...middle].sort((a, b) => a.station - b.station)]]))
  return { project: next, rerun }
}

// ── After a write ───────────────────────────────────────────────────────────

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

/** The project with one turnout's pairs written, the track `leader` names leading. */
function withPairs(project, sw, leader, opts) {
  const c = couplingOf(project.tracks, project.switches, sw, opts)
  const r = c && pairedHeights(c, leader)
  if (!r) return project
  return withHeights(project, new Map([[c.main.track.id, r.main], [c.branch.track.id, r.branch]].filter(([, h]) => h)))
}

/**
 * One turnout coupled as Paket WK asks: the branch's own points between WA and
 * ldS first where it led, then the ldS point on the main route, the lines
 * through toe and ldS, the pairs from the main route, and the branch behind
 * its ldS.
 */
function coupleOne(ix, project, e, leader, opts) {
  if (!(heightsOf(project, e.main.trackId)?.length >= 2)) return { project, rerun: null }
  if (leader === 'branch') project = withPairs(project, e.sw, 'branch', opts)
  project = withMainLds(project, e)
  project = withMainLines(ix, project, e, opts)
  project = withPairs(project, e.sw, 'main', opts)
  return withBranchBeyond(ix, project, e, opts)
}

/**
 * The project after a write with every turnout the write reached coupled
 * again (decisions 258, 259, 269–272) — in the same step, so one undo takes
 * back all of it. A turnout that changes a track passes it on to the turnouts
 * on that track; the leading turnout of a crossover has the other coupled
 * after it. The same project where nothing had to change.
 */
export function coupleSwitchHeights(before, after, { only = touchedTurnouts(before, after), formOf } = {}) {
  if (!only?.size || !after?.tracks) return after
  // Who leads in a crossover is the write's to say, and stays so over every pass.
  const opts = { formOf, crossLead: crossoverLeads(indexOf(after.tracks, after.switches, { formOf }), before, after, { formOf }) }
  // One turnout's lines run through the next: until nothing moves any more,
  // the turnouts a pass changed are coupled again.
  let project = couplePass(before, after, only, opts)
  let last = after
  for (let n = 0; n < MAX_PASSES && project !== last; n++) {
    const again = touchedTurnouts(last, project)
    last = project
    project = couplePass(null, project, again, opts)
  }
  return project
}

const MAX_PASSES = 24

function couplePass(before, after, only, opts) {
  const ix = indexOf(after.tracks, after.switches, opts)
  const wasTrack = new Map((before?.tracks ?? []).map(t => [t.id, t]))
  let project = after
  const queue = [...only]
  const done = new Set()
  const again = new Set()
  while (queue.length) {
    const id = queue.shift()
    if (done.has(id) && !again.has(id)) continue
    if (done.has(id)) again.delete(id)
    const first = !done.has(id)
    done.add(id)
    const e = ix.byId.get(id)
    if (!e) continue
    const was = project
    const c = first ? couplingOf(project.tracks, project.switches, e.sw, opts) : null
    const r = coupleOne(ix, project, e, c ? leaderOf(wasTrack, c) : 'main', opts)
    project = r.project
    if (r.rerun && !again.has(r.rerun)) { again.add(r.rerun); queue.unshift(r.rerun) }
    if (project === was) continue
    const changed = new Set(project.tracks.filter((t, i) => t !== was.tracks[i]).map(t => t.id))
    for (const s of project.switches ?? []) {
      if (!done.has(s.switchId) && isTurnout(s) && touches(s, changed)) queue.push(s.switchId)
    }
  }
  return project
}

/**
 * The project with every turnout coupled — those `only` names (their
 * switchIds), or all of them: a project from before the coupling, or the
 * button that does it for all.
 */
export function coupleSwitchGradients(project, { only = null, formOf } = {}) {
  const ids = new Set((project?.switches ?? []).filter(sw => isTurnout(sw) && (!only || only.has(sw.switchId)))
    .map(sw => sw.switchId))
  return coupleSwitchHeights(null, project, { only: ids, formOf })
}

let lastPending = null

/**
 * The turnouts coupling would still change — what „Weichen jetzt koppeln“
 * does: those one of whose tracks it writes.
 */
export function pendingTurnouts(project, opts) {
  if (!project?.tracks) return []
  if (lastPending?.project === project && lastPending.formOf === opts?.formOf) return lastPending.result
  const coupled = coupleSwitchGradients(project, opts)
  const changed = new Set(coupled.tracks.filter((t, i) => t !== project.tracks[i]).map(t => t.id))
  const result = indexOf(project.tracks, project.switches, opts).entries
    .filter(e => [e.approach, e.main, e.branch].some(p => p && changed.has(p.trackId))).map(e => e.sw)
  lastPending = { project, formOf: opts?.formOf, result }
  return result
}

// ── What the profile may change ─────────────────────────────────────────────

let lastRoles = null

/**
 * What every coupled point of a project is, by track and stored index — what
 * the profile and its table let the user change:
 *   { kind: 'wa', sw }               toe of a turnout: shown only
 *   { kind: 'lds', sw, side }        ldS point on the main route or branch: shown only
 *   { kind: 'middle', sw, other }    the one point between the ldS of a crossover: its
 *                                    curve and reason only
 *   { kind: 'continuation', sw, line: { s0, z0, g }, free }
 *                                    on a turnout's continuation: its station and the
 *                                    gradient on its `free` side (±1, the way its
 *                                    stations run), its curve and reason; z = z0 + g·(s − s0)
 */
export function heightRoles(project, opts) {
  if (!project?.tracks) return new Map()
  if (lastRoles?.tracks === project.tracks && lastRoles.switches === project.switches && lastRoles.formOf === opts?.formOf) {
    return lastRoles.result
  }
  const ix = indexOf(project.tracks, project.switches, opts)
  opts = { ...opts, crossLead: crossoverLeads(ix, null, project, opts) }
  const out = new Map()
  const put = (trackId, index, role, strong = true) => {
    if (!out.has(trackId)) out.set(trackId, new Map())
    const m = out.get(trackId)
    if (strong || !m.has(index)) m.set(index, role)
  }
  for (const e of ix.entries) {
    const mh = heightsOf(project, e.main.trackId)
    if (!(mh?.length >= 2)) continue
    // Continuations first, the stronger roles over them.
    for (const index of [mainToeIndex(project, e), mainLdsIndex(project, e)]) {
      if (index < 0) continue
      const r = solveChain(ix, project, chainThrough(ix, project, { trackId: e.main.trackId, index }), opts)
      if (r?.free) put(r.free.point.trackId, r.free.point.index, continuationRole(project, e, r.free), false)
    }
    const bh = heightsOf(project, e.branch.trackId)
    const o = crossoverPartner(ix, project, e)
    if (bh?.length >= 2 && o) {
      const lo = Math.min(e.ldsBranch, o.ldsBranch), hi = Math.max(e.ldsBranch, o.ldsBranch)
      bh.forEach((p, i) => {
        if (p.station > lo + STATION_TOL && p.station < hi - STATION_TOL) put(e.branch.trackId, i, { kind: 'middle', sw: e.sw, other: o.sw }, false)
      })
    } else if (bh?.length >= 2) {
      const iL = bh.findIndex(p => Math.abs(p.station - e.ldsBranch) <= STATION_TOL)
      const L = iL >= 0 && ldsLine(bh, e.ldsBranch, e.branchSense)
      if (L && bh[iL + e.branchSense]) {
        put(e.branch.trackId, iL + e.branchSense, { kind: 'continuation', sw: e.sw, line: L, free: e.branchSense }, false)
      }
    }
  }
  for (const e of ix.entries) {
    const iM = mainLdsIndex(project, e)
    if (iM >= 0) put(e.main.trackId, iM, { kind: 'lds', sw: e.sw, side: 'main' })
    const bh = heightsOf(project, e.branch.trackId)
    const iB = (bh ?? []).findIndex(p => Math.abs(p.station - e.ldsBranch) <= STATION_TOL)
    if (iB >= 0) put(e.branch.trackId, iB, { kind: 'lds', sw: e.sw, side: 'branch' })
  }
  for (const e of ix.entries) {
    for (const port of [e.approach, e.main, e.branch]) {
      const h = port && heightsOf(project, port.trackId)
      if (h?.length >= 2) put(port.trackId, port.endpoint === 'BEGIN' ? 0 : h.length - 1, { kind: 'wa', sw: e.sw })
    }
  }
  lastRoles = { tracks: project.tracks, switches: project.switches, formOf: opts?.formOf, result: out }
  return out
}

/**
 * A chain's free end on a continuation as a role: the line in that point's
 * own stations, and the side its gradient is free on — away from the chain.
 */
function continuationRole(project, e, { point, line }) {
  const s = heightsOf(project, point.trackId)[point.index].station
  // Along the index, d grows on the forward side and shrinks on the back one.
  const sigma = point.back ? -point.dir : point.dir
  return {
    kind: 'continuation', sw: e.sw,
    line: { s0: s, z0: line.z0 + line.g * (point.d - line.d0), g: line.g * sigma },
    free: point.dir,
  }
}
