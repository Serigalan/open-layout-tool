/**
 * Which heights follow which (decisions 384–385): a height point may depend
 * on others, and a point that does is shown only — its height is worked out.
 *
 * - Lines (decision 270): every WA and ldS point of a main route lies on the
 *   straight line Q → P between the nearest points before and behind it that
 *   are not held by that line (free points, or points that depend on others)
 *   — along the way a train runs: approach, main route, on over the WA of the
 *   next turnout. Without a point before the WA the WA is the line's end. A
 *   branch's ldS that nothing else holds lies on the line between its
 *   neighbours on the branch the same way (an ldS between does not count).
 * - Standard (outside the design mode): a turnout's tracks meet — its
 *   branch's WA takes the main route's height, its branch's ldS lies in the
 *   plane over the main route's (switchGradient.ldsLift). The main route
 *   leads.
 * - Own (`dep` on a point: the id of the point it follows; kept in the
 *   project), the way `depMode` says (decision 390): 'wa' — the same height,
 *   as at a turnout's toe; 'lds' — the source's cant over the offset
 *   between the two (switchGradient.planeFrom; across a turnout's ldS its
 *   sleeper's plane, ldsLift); 'continue' — the gradient
 *   running into the source carried on to the point. Without a mode: 'wa'
 *   across a turnout's toe, else 'lds'.
 *   Made in the design mode, in force in both; one over a turnout's pair
 *   drops the standard one it would turn round, and one on a WA or ldS takes
 *   it off its line.
 * - None (`free` on a point, decision 387): a WA or ldS let go of its line
 *   and of the standard coupling in the design mode — a point like any
 *   other, entered by hand, until its rule is restored.
 *
 * The store works them out after every write (withSwitchHeights), every
 * source before what depends on it, for what the write touched. In the
 * design mode (Entwurfsmodus Weichen) the standard ones are off: heights are
 * taken over one by one as own dependencies, and the mode ends only once
 * every turnout fits (switchMisfits). A ring of dependencies is refused where
 * it would be made, and left as it is where it is found.
 *
 * A point's role follows from where it lies and what it says; a dependency
 * names its source by the point's id, which stays with the point however its
 * track is split or joined.
 */

import {
  endOfIndex, heightAt, jointGroup, pointAtStation, roundHeight, turnoutDivergingPort, turnoutLinePort, portTrack, portEnd,
} from '../track'
import { ldsLift, planeFrom, roundMm, STATION_TOL, switchCouplings, Z_TOL } from './switchGradient'

const MAX_STEPS = 400
/** Two heights fit to this — both are kept to 0.1 mm [m]. */
const FIT_TOL = 0.0002
/** Rounds of working the dependencies out, at most: the plane at an ldS reads the gradient around it. */
const MAX_PASSES = 4
/** A point this close to where a track is picked is the one picked [m]. */
const SNAP = 0.5

// ── Where the turnouts are: what follows from the geometry alone ────────────

/**
 * One coupled turnout: its three ports (track and the end at WA), the
 * stations of the ldS on its main route and branch, and its coupling (the
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
const keyOf = (r) => `${r.trackId}|${r.index}`
const zOf = (project, r) => heightsOf(project, r.trackId)?.[r.index]?.z ?? null
const isFree = (project, r) => !!heightsOf(project, r.trackId)?.[r.index]?.free

/** The stored index of a turnout's toe on one of its ports' tracks, or −1 where the heights do not reach it. */
function toeIndex(project, port) {
  const track = port && trackOf(project, port.trackId)
  const h = track?.heights
  if (!(h?.length >= 2)) return -1
  const index = port.endpoint === 'BEGIN' ? 0 : h.length - 1
  return endOfIndex(track, index) === port.endpoint ? index : -1
}

/**
 * A turnout's points at WA and ldS, as refs, null where the heights do not
 * reach: `mt` its toe on the main route (on the approach where the main
 * route's heights do not reach it), `bt` on the branch, `ml` and `bl` its
 * two ldS.
 */
function pairsOf(project, e) {
  const ref = (port, index) => (index >= 0 ? { trackId: port.trackId, index } : null)
  const mainToe = toeIndex(project, e.main)
  return {
    mt: mainToe >= 0 ? ref(e.main, mainToe) : e.approach ? ref(e.approach, toeIndex(project, e.approach)) : null,
    bt: ref(e.branch, toeIndex(project, e.branch)),
    ml: ref(e.main, indexAt(heightsOf(project, e.main.trackId), e.ldsMain)),
    bl: ref(e.branch, indexAt(heightsOf(project, e.branch.trackId), e.ldsBranch)),
  }
}

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

/**
 * The one stored point a toe of a main route is written as: of the approach's
 * end and the main route's start — one joint, one height — the main route's.
 */
function canon(ix, project, r) {
  const track = trackOf(project, r.trackId)
  const end = track && endOfIndex(track, r.index)
  const atToe = end && ix.toe.get(`${r.trackId}|${end}`)
  if (!atToe || atToe.role === 'branch') return { trackId: r.trackId, index: r.index }
  return pairsOf(project, atToe.e).mt ?? { trackId: r.trackId, index: r.index }
}

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
 * The bound points one way from `start`, and the point the way ends at — the
 * first one that is not bound (free, held by a line of its own, or depending
 * on a point: `own` the keys of those) —, or null at a dead end.
 */
function walk(ix, project, start, own) {
  const list = []
  const seen = new Set([keyOf(start)])
  let pos = start, d = 0
  for (let n = 0; n < MAX_STEPS; n++) {
    const next = step(ix, project, pos)
    if (!next) return { list, end: null }
    if (seen.has(keyOf(next))) return { list, end: null }
    seen.add(keyOf(next))
    d += next.ds
    const track = trackOf(project, next.trackId)
    const item = { trackId: next.trackId, index: next.index, dir: next.dir, d }
    if (own.has(keyOf(canon(ix, project, item))) || !onMainRoute(classify(ix, track, next.index))) return { list, end: item }
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
function chainThrough(ix, project, start, own) {
  const fwd = walk(ix, project, { ...start, dir: 1 }, own)
  const back = walk(ix, project, { ...start, dir: -1 }, own)
  const flip = (p) => ({ ...p, d: -p.d })
  return {
    S: back.end && flip(back.end),
    E: fwd.end,
    bound: [...back.list.map(flip).reverse(), { ...start, d: 0 }, ...fwd.list],
  }
}

// ── The dependencies ────────────────────────────────────────────────────────

/** Every point id of a project: Map(id → { trackId, index }). */
function pointIds(project) {
  const out = new Map()
  for (const t of project.tracks) (t.heights ?? []).forEach((p, index) => { if (p.id && !out.has(p.id)) out.set(p.id, { trackId: t.id, index }) })
  return out
}

/** How a point may depend on another (decision 390). */
export const DEPENDENCY_MODES = ['wa', 'lds', 'continue']

/** Are `src` and `dst` a turnout's pair at WA or ldS (one on either track)? Its { e, at, side } of `src`, or null. */
function pairOfBoth(pairOf, src, dst) {
  const a = pairOf.get(keyOf(src)), b = pairOf.get(keyOf(dst))
  return a && b && a.e === b.e && a.at === b.at && a.side !== b.side ? a : null
}

/** The mode a dependency has where it states none: the same height across a turnout's toe, else the plane. */
const modeOf = (p, pair) => (DEPENDENCY_MODES.includes(p?.depMode) ? p.depMode : pair?.at === 'wa' ? 'wa' : 'lds')

/**
 * The height a point depending on `src` takes, the way `mode` says: 'wa' the
 * same; 'lds' the source's cant over the offset across — across a turnout's
 * ldS the plane on its sleeper (ldsLift), elsewhere planeFrom; 'continue' the
 * gradient running into the source, from the side away from the point,
 * carried on to it — along the source's track, over the run from the source
 * to the point (on another track: its foot along the source's).
 */
function followZ(project, src, dst, pairOf, mode) {
  const zs = zOf(project, src)
  if (zs == null) return null
  if (mode === 'wa') return zs
  const st = trackOf(project, src.trackId), dt = trackOf(project, dst.trackId)
  const s0 = st.heights[src.index].station, s1 = dt.heights[dst.index].station
  if (mode === 'continue') {
    const h = st.heights
    let a = s1 - s0
    if (dt.id !== st.id) {
      const p = pointAtStation(st, s0), q = pointAtStation(dt, s1)
      if (!p || !q) return null
      const b = p.bearing * Math.PI / 180
      a = Math.sin(b) * (q.utm.easting - p.utm.easting) + Math.cos(b) * (q.utm.northing - p.utm.northing)
    }
    const into = (n) => (n ? (zs - n.z) / (s0 - n.station) : null)
    const before = into(h[src.index - 1]), after = into(h[src.index + 1])
    return zs + (a >= 0 ? before ?? after ?? 0 : after ?? before ?? 0) * a
  }
  const pair = pairOfBoth(pairOf, src, dst)
  if (pair?.at === 'lds') {
    const lift = ldsLift(pair.e.c, heightsOf(project, pair.e.main.trackId))
    return pair.side === 'main' ? zs + lift : zs - lift
  }
  if (pair?.at === 'wa') return zs
  return planeFrom(st, s0, zs, dt, s1)
}

/**
 * Every point of a project whose height depends on others: Map(key → { ref,
 * kind, mode, sources, z }) — `kind` 'own' (its `dep`), 'standard' (a
 * turnout's branch on its main route, outside the design mode) or 'line'
 * (between two points: decision 270 on a main route, the neighbours on a
 * branch), `mode` how (DEPENDENCY_MODES, or 'line'), and `z(project)` the
 * height it takes there.
 */
function dependencies(ix, project, { design = false } = {}) {
  const nodes = new Map()
  const pairOf = new Map()
  for (const e of ix.entries) {
    const pr = pairsOf(project, e)
    for (const [k, at, side] of [['mt', 'wa', 'main'], ['bt', 'wa', 'branch'], ['ml', 'lds', 'main'], ['bl', 'lds', 'branch']]) {
      if (pr[k]) pairOf.set(keyOf(pr[k]), { e, at, side })
    }
  }
  // Own dependencies: what a point says it follows.
  const ids = pointIds(project)
  for (const t of project.tracks) {
    (t.heights ?? []).forEach((p, index) => {
      const src = p.dep && ids.get(p.dep)
      if (!src) return
      const ref = canon(ix, project, { trackId: t.id, index })
      const from = canon(ix, project, src)
      if (keyOf(from) === keyOf(ref)) return
      const mode = modeOf(p, pairOfBoth(pairOf, from, ref))
      nodes.set(keyOf(ref), { ref, kind: 'own', mode, sources: [from], z: (q) => followZ(q, from, ref, pairOf, mode) })
    })
  }
  const followsOwn = (a, b) => nodes.get(keyOf(a))?.sources.some(s => keyOf(s) === keyOf(b))
  // Standard: a turnout's branch follows its main route at WA and ldS.
  if (!design) {
    for (const e of ix.entries) {
      const { mt, bt, ml, bl } = pairsOf(project, e)
      for (const [m, b, mode] of [[mt, bt, 'wa'], [ml, bl, 'lds']]) {
        if (!m || !b || nodes.has(keyOf(b)) || followsOwn(m, b) || isFree(project, b)) continue
        nodes.set(keyOf(b), { ref: b, kind: 'standard', mode, sources: [m], z: (q) => followZ(q, m, b, pairOf, mode) })
      }
    }
  }
  // Lines of the main routes: a point that depends on others, or that is let go, ends them.
  const own = new Set(nodes.keys())
  for (const t of project.tracks) (t.heights ?? []).forEach((p, index) => { if (p.free) own.add(keyOf(canon(ix, project, { trackId: t.id, index }))) })
  for (const e of ix.entries) {
    const { mt, ml } = pairsOf(project, e)
    for (const start of [mt, ml]) {
      if (!start || own.has(keyOf(start))) continue
      const ch = chainThrough(ix, project, start, own)
      const first = ch.S ?? ch.bound[0], last = ch.E ?? ch.bound[ch.bound.length - 1]
      if (!(last.d > first.d)) continue
      const ends = [first, last].map(p => canon(ix, project, p))
      for (const b of ch.bound) {
        if (b === first || b === last) continue
        const ref = canon(ix, project, b)
        if (nodes.has(keyOf(ref))) continue
        nodes.set(keyOf(ref), {
          ref, kind: 'line', mode: 'line', sources: ends,
          z: (q) => {
            const [z0, z1] = ends.map(r => zOf(q, r))
            return z0 == null || z1 == null ? null : z0 + (z1 - z0) * (b.d - first.d) / (last.d - first.d)
          },
        })
      }
    }
  }
  // A branch's ldS that nothing holds: on the line between its neighbours there.
  for (const [trackId, list] of ix.ldsOn) {
    const h = heightsOf(project, trackId)
    if (!(h?.length >= 3)) continue
    const bound = (i) => list.some(x => x.side === 'branch' && Math.abs(h[i].station - x.station) <= STATION_TOL)
      && !nodes.has(keyOf({ trackId, index: i })) && !h[i].free
    for (let i = 1; i < h.length - 1; i++) {
      if (!bound(i)) continue
      let a = i - 1, b = i + 1
      while (a >= 0 && bound(a)) a--
      while (b < h.length && bound(b)) b++
      if (a < 0 || b >= h.length) continue
      const ends = [a, b].map(index => canon(ix, project, { trackId, index }))
      nodes.set(keyOf({ trackId, index: i }), {
        ref: { trackId, index: i }, kind: 'line', mode: 'line', sources: ends,
        z: (q) => {
          const hh = heightsOf(q, trackId)
          return hh[a].z + (hh[b].z - hh[a].z) * (hh[i].station - hh[a].station) / (hh[b].station - hh[a].station)
        },
      })
    }
  }
  return nodes
}

/**
 * The keys of the nodes in the order they follow one another — every source
 * before what depends on it — and the ring: those that depend on themselves
 * over others, which are left out.
 */
function ordered(nodes) {
  const out = [], state = new Map(), ring = new Set()
  const visit = (k, path) => {
    if (state.get(k) === 2) return
    if (state.get(k) === 1) { for (const x of path.slice(path.indexOf(k))) ring.add(x); return }
    state.set(k, 1)
    for (const s of nodes.get(k).sources) if (nodes.has(keyOf(s))) visit(keyOf(s), [...path, k])
    state.set(k, 2)
    out.push(k)
  }
  for (const k of nodes.keys()) visit(k, [])
  return { order: out.filter(k => !ring.has(k)), ring }
}

// ── Writing ─────────────────────────────────────────────────────────────────

function withHeights(project, byTrack) {
  if (!byTrack.size) return project
  return { ...project, tracks: project.tracks.map(t => (byTrack.has(t.id) ? { ...t, heights: byTrack.get(t.id) } : t)) }
}

/**
 * The points one height is written to with `ref`: the points joined to it —
 * but the toe of a branch is a point of its own (it follows, it is not
 * joined), and the toe of a main route does not take it along.
 */
function groupOf(ix, project, ref) {
  const isBranchToe = (r) => {
    const tr = trackOf(project, r.trackId)
    const en = tr && endOfIndex(tr, r.index)
    return !!en && ix.toe.get(`${r.trackId}|${en}`)?.role === 'branch'
  }
  if (isBranchToe(ref)) return [ref]
  return jointGroup(project.tracks, project.switches, ref).filter(r => !isBranchToe(r))
}

/** The project with the fields of `patch` on one point and its group (groupOf); a field null goes. */
function patchPoint(ix, project, ref, patch) {
  const byTrack = new Map()
  for (const p of groupOf(ix, project, ref)) {
    const hh = byTrack.get(p.trackId) ?? heightsOf(project, p.trackId)
    if (!hh?.[p.index]) continue
    byTrack.set(p.trackId, hh.map((q, i) => {
      if (i !== p.index) return q
      const out = { ...q, ...patch }
      for (const k of Object.keys(patch)) if (patch[k] == null) delete out[k]
      return out
    }))
  }
  return withHeights(project, byTrack)
}

/** The project with one point — and its group — at height z, unless it is there already. */
function setHeight(ix, project, ref, z) {
  const h = heightsOf(project, ref.trackId)
  if (!h?.[ref.index] || z == null || Math.abs(h[ref.index].z - z) <= Z_TOL) return project
  // Just beyond the tolerance it may round to what is there already.
  const zr = roundHeight(z)
  if (Math.abs(h[ref.index].z - zr) < 1e-9) return project
  return patchPoint(ix, project, ref, { z: zr })
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

/**
 * The project with every turnout's ldS points there (withLdsPoints) — what a
 * project gets as it is opened, so each WA and ldS can be picked (decision
 * 390). The same project where none is missing.
 */
export function withAllLdsPoints(project, opts) {
  if (!project?.tracks || !project.switches?.length) return project
  const ix = indexOf(project.tracks, project.switches, opts)
  return ix.entries.reduce((p, e) => withLdsPoints(p, e), project)
}

/** The project without a `dep` that names no point any more. */
function withoutLostLinks(project) {
  const ids = new Set(pointIds(project).keys())
  let changed = false
  const tracks = project.tracks.map(t => {
    if (!t.heights?.some(p => p.dep && !ids.has(p.dep))) return t
    changed = true
    return { ...t, heights: t.heights.map(p => {
      if (!p.dep || ids.has(p.dep)) return p
      const { dep: _d, ...rest } = p
      return rest
    }) }
  })
  return changed ? { ...project, tracks } : project
}

/**
 * What the store does to a write (`after`, from `before`): links to points
 * gone dropped, every turnout on a track it changed given its ldS points, and
 * every height that depends on what it changed worked out again, every source
 * before what depends on it. `design`: the design mode, without the standard
 * dependencies. The same project where nothing changes.
 */
export function withSwitchHeights(before, after, { design = false, opts } = {}) {
  if (!after?.tracks) return after
  const was = new Map((before?.tracks ?? []).map(t => [t.id, t]))
  const changed = new Set(after.tracks.filter(t => {
    const b = was.get(t.id)
    return !b || b.heights !== t.heights || b.elements !== t.elements
  }).map(t => t.id))
  if (!changed.size) return after
  let p = withoutLostLinks(after)
  const ix = indexOf(p.tracks, p.switches ?? [], opts)
  for (const e of new Set([...changed].flatMap(id => ix.onTrack.get(id) ?? []))) p = withLdsPoints(p, e)
  const nodes = dependencies(ix, p, { design })
  const { order } = ordered(nodes)
  // What the write touched: every point on a track it changed, and on from there.
  const dirty = new Set()
  for (const k of order) {
    const n = nodes.get(k)
    if (changed.has(n.ref.trackId) || n.sources.some(s => changed.has(s.trackId) || dirty.has(keyOf(s)))) dirty.add(k)
  }
  // The plane at an ldS reads the main route's gradient there, which the
  // line through it may move after: round again until nothing moves.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const start = p
    for (const k of order) {
      if (!dirty.has(k)) continue
      const n = nodes.get(k)
      p = setHeight(ix, p, n.ref, n.z(p))
    }
    if (p === start) break
  }
  return p
}

// ── How a turnout fits ──────────────────────────────────────────────────────

/**
 * Where a project's turnouts do not fit — what keeps the design mode from
 * ending: [{ sw, at, dz }] with `at` 'wa' or 'lds' and dz how far the branch
 * lies above where it should [m] — at WA the main route's height, at the ldS
 * the plane over it. A turnout whose tracks have no heights there is left
 * out — nothing is made up.
 */
export function switchMisfits(project, opts) {
  if (!project?.tracks || !project.switches?.length) return []
  const ix = indexOf(project.tracks, project.switches, opts)
  const out = []
  // An ldS not stored yet is read on the gradient.
  const ldsZ = (port, s, r) => {
    if (r) return zOf(project, r)
    const h = heightsOf(project, port.trackId)
    return h?.length >= 2 && s > h[0].station && s < h[h.length - 1].station ? heightAt(h, s) : null
  }
  for (const e of ix.entries) {
    const { mt, bt, ml, bl } = pairsOf(project, e)
    if (mt && bt) {
      const dz = zOf(project, bt) - zOf(project, mt)
      if (Math.abs(dz) > FIT_TOL) out.push({ sw: e.sw, at: 'wa', dz })
    }
    const [zm, zb] = [ldsZ(e.main, e.ldsMain, ml), ldsZ(e.branch, e.ldsBranch, bl)]
    if (zm != null && zb != null) {
      const dz = zb - (zm + ldsLift(e.c, heightsOf(project, e.main.trackId)))
      if (Math.abs(dz) > FIT_TOL) out.push({ sw: e.sw, at: 'lds', dz })
    }
  }
  return out
}

// ── Making and taking away dependencies (the design mode) ───────────────────

/** A point id not yet in the project. */
function newPointId(project) {
  const ids = pointIds(project)
  for (;;) {
    const id = Math.random().toString(36).slice(2, 10)
    if (id.length === 8 && !ids.has(id)) return id
  }
}

/**
 * The project with the point `dst` depending on `src` (refs { trackId,
 * index }): `src` given an id where it has none, `dst` — with the points
 * joined to it — told to follow it the way `mode` says (DEPENDENCY_MODES;
 * null: the default for the pair); where `src` followed `dst`, that is
 * turned round. Returns { project } or { error }: 'same' (one point), 'ring'
 * (it would come to depend on itself, over other dependencies).
 */
export function dependOn(project, dst, src, { mode = null, design = true, opts } = {}) {
  const ix = indexOf(project.tracks, project.switches ?? [], opts)
  const [d, s] = [canon(ix, project, dst), canon(ix, project, src)]
  if (keyOf(d) === keyOf(s)) return { error: 'same' }
  let p = project
  let id = heightsOf(p, s.trackId)[s.index].id
  if (!id) {
    id = newPointId(p)
    p = patchPoint(ix, p, s, { id })
  }
  const had = heightsOf(p, d.trackId)[d.index]
  if (had.dep === id && (had.depMode ?? null) === (mode ?? null)) return { project: p }
  const dstId = heightsOf(p, d.trackId)[d.index].id
  if (dstId && heightsOf(p, s.trackId)[s.index].dep === dstId) p = patchPoint(ix, p, s, { dep: null })
  p = patchPoint(ix, p, d, { dep: id, depMode: DEPENDENCY_MODES.includes(mode) ? mode : null, free: null })
  if (ordered(dependencies(ix, p, { design })).ring.has(keyOf(d))) return { error: 'ring' }
  return { project: p }
}

/**
 * The project with the point `ref` (and those joined to it) let go of one
 * dependency: of its own one where it has it, else — a WA or ldS on its line
 * or following the main route — of that, the point `free` from then on
 * (decision 387). The same project where it depends on nothing.
 */
export function releaseDependency(project, ref, { design = true, opts } = {}) {
  const ix = indexOf(project.tracks, project.switches ?? [], opts)
  const r = canon(ix, project, ref)
  const p = heightsOf(project, r.trackId)?.[r.index]
  if (!p) return project
  if (p.dep) return patchPoint(ix, project, r, { dep: null, depMode: null })
  return dependencies(ix, project, { design }).has(keyOf(r)) ? patchPoint(ix, project, r, { free: true }) : project
}

/** The project with the point `ref` (and those joined to it) back under its rule: no longer `free`. */
export function restoreDependency(project, ref, opts) {
  const ix = indexOf(project.tracks, project.switches ?? [], opts)
  return patchPoint(ix, project, canon(ix, project, ref), { free: null })
}

/**
 * The project with the way the point `ref` follows its own source changed to
 * `mode` (DEPENDENCY_MODES). The same project where it has no source of its own.
 */
export function setDependencyMode(project, ref, mode, opts) {
  const ix = indexOf(project.tracks, project.switches ?? [], opts)
  const r = canon(ix, project, ref)
  if (!heightsOf(project, r.trackId)?.[r.index]?.dep || !DEPENDENCY_MODES.includes(mode)) return project
  return patchPoint(ix, project, r, { depMode: mode })
}

/**
 * The project with a point depending on the point `src`, picked on the map
 * (decision 390): `target` a height point { trackId, index }, or a place on
 * a track { trackId, station } — the point there within 0.5 m, else a new
 * one on the gradient. Returns { project, ref } or { error }: 'no_height'
 * (the track has no gradient there), 'same', 'ring'.
 */
export function addDependentAt(project, src, target, { mode = null, design = true, opts } = {}) {
  let p = project
  let ref = target.index != null ? { trackId: target.trackId, index: target.index } : null
  if (!ref) {
    const h = heightsOf(p, target.trackId)
    if (!(h?.length >= 2) || target.station < h[0].station - STATION_TOL || target.station > h[h.length - 1].station + STATION_TOL) {
      return { error: 'no_height' }
    }
    const near = h.reduce((best, q, i) => (Math.abs(q.station - target.station) <= SNAP
      && (best < 0 || Math.abs(q.station - target.station) < Math.abs(h[best].station - target.station)) ? i : best), -1)
    if (near >= 0) ref = { trackId: target.trackId, index: near }
    else {
      const station = roundMm(target.station)
      const next = [...h, { station, z: roundHeight(heightAt(h, station)) }].sort((x, y) => x.station - y.station)
      p = withHeights(p, new Map([[target.trackId, next]]))
      ref = { trackId: target.trackId, index: next.findIndex(q => q.station === station) }
    }
  }
  const r = dependOn(p, ref, src, { mode, design, opts })
  return r.error ? r : { project: r.project, ref }
}

// ── What the profile shows ──────────────────────────────────────────────────

let lastRoles = null

/**
 * What the points of a project are, by track and stored index — what the
 * profile and its table show only:
 *   { kind: 'wa', sw, side }     toe of a turnout ('main' on the approach and
 *                                main route, 'branch' on the branch)
 *   { kind: 'lds', sw, side }    ldS point on the main route or branch —
 *                                either with `free` where it is let go, and
 *                                then entered like any other
 *   { kind: 'own' }              a point following another one of its own
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
  for (const t of project.tracks) (t.heights ?? []).forEach((p, index) => { if (p.dep) put(t.id, index, { kind: 'own' }) })
  // A WA or ldS let go (decision 387) says so: it is entered like a free point.
  const free = (trackId, index) => (heightsOf(project, trackId)?.[index]?.free ? { free: true } : {})
  for (const e of ix.entries) {
    for (const [port, s, side] of [[e.main, e.ldsMain, 'main'], [e.branch, e.ldsBranch, 'branch']]) {
      const i = indexAt(heightsOf(project, port.trackId), s)
      put(port.trackId, i, { kind: 'lds', sw: e.sw, side, ...free(port.trackId, i) })
    }
  }
  for (const e of ix.entries) {
    for (const role of ['approach', 'main', 'branch']) {
      if (!e[role]) continue
      const i = toeIndex(project, e[role])
      put(e[role].trackId, i, { kind: 'wa', sw: e.sw, side: role === 'branch' ? 'branch' : 'main', ...free(e[role].trackId, i) })
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

/**
 * Which points a point depends on and which depend on it, for the profile:
 * Map(`trackId|index` → { kind, mode, from: [refs], to: [refs] }) — `kind`
 * what it depends by ('own', 'standard', 'line'; null where it depends on
 * nothing), `mode` how (DEPENDENCY_MODES, or 'line'). The
 * approach's end of a toe answers as the main route's start, the one point
 * they are.
 */
export function heightLinks(project, { design = false, opts } = {}) {
  if (!project?.tracks) return new Map()
  const ix = indexOf(project.tracks, project.switches ?? [], opts)
  const out = new Map()
  const at = (r) => {
    const k = keyOf(r)
    if (!out.has(k)) out.set(k, { kind: null, from: [], to: [] })
    return out.get(k)
  }
  for (const n of dependencies(ix, project, { design }).values()) {
    const me = at(n.ref)
    me.kind = n.kind
    me.mode = n.mode
    me.from = n.sources
    for (const s of n.sources) at(s).to.push(n.ref)
  }
  for (const e of ix.entries) {
    const ai = toeIndex(project, e.approach)
    const { mt } = pairsOf(project, e)
    if (ai >= 0 && mt && mt.trackId !== e.approach.trackId && out.has(keyOf(mt))) out.set(keyOf({ trackId: e.approach.trackId, index: ai }), out.get(keyOf(mt)))
  }
  return out
}
