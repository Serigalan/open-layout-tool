/**
 * A turnout drawn in detail (Paket WD, decisions 341 and 347): its sleepers and
 * its rails, in the turnout's own frame — WA at the origin, x along the main
 * route's tangent at WA, y toward the side the branch leaves to.
 *
 * The sleepers are the grid the heights already lie on (sleepers.js, decision
 * 256): the first 0.30 m behind WA, then every 0.60 m along the bisector, the
 * last through sleeper (ldS) last — taking the place of the grid sleeper
 * before it where that lies less than half a spacing short of it. Each reaches from the outer rail of the
 * main track to the outer rail of the branch, 0.55 m beyond either — the
 * 0.75 m from axis to rail plus that overhang is the 1.30 m half of an
 * ordinary 2.60 m sleeper.
 *
 * The sleepers outside WA–ldS are the brackets of the table's sleeper count,
 * e.g. "48 (3/5/6)": before WA, behind the ldS on the main track, behind it on
 * the branch. They carry on the grid's spacing — before WA as ordinary
 * sleepers square to the main track; behind the ldS one per track, square to
 * it, 1.30 m on the outer side and on the inner side shortened to 5 cm short
 * of the middle between the two axes, where the other track's sleeper begins.
 * The counts come from the variant the turnout is built as
 * (catalogue.switchVariantFor), none where its form has no variant.
 *
 * Nothing here is stored: it all follows from the two tracks and the form.
 */

import { endPointCurvedUtm, endPointStraightUtm, bearingAfterUtm } from '../geometry'
import { elementBelongsToSwitch } from '../track'
import { switchFormChain, switchStraightLength, switchTypeByLabel, switchVariantFor } from './catalogue'
import { FIRST_SLEEPER, SLEEPER_SPACING, routeCut, routePose, turnoutSleepers } from './sleepers'

/** From a track's axis to the middle of its rail [m] (decision 341). */
export const RAIL_OFFSET = 0.75
/** How far a sleeper reaches beyond the rail [m]. */
export const SLEEPER_OVERHANG = 0.55
const SLEEPER_HALF = RAIL_OFFSET + SLEEPER_OVERHANG
/** How far short of the middle between two tracks a shortened sleeper ends [m]. */
const SLEEPER_GAP = 0.05
/** Rail points every so many metres. */
const RAIL_STEP = 0.5
/** How far a rail runs beyond the last sleeper [m]. */
const RAIL_BEYOND = 0.3

const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1]
const left = (v) => [-v[1], v[0]]
const unit = (v) => { const n = Math.hypot(v[0], v[1]); return n > 1e-12 ? [v[0] / n, v[1] / n] : null }

/**
 * Distance WA–WM along the main route [m]: the tangent of the branch's arc,
 * R · tan(α/2) — for the symmetrical turnout half its length.
 */
function tangentLength(form) {
  if (!form?.R || !form?.ratio) return null
  if (form.symmetric) return switchStraightLength(form) / 2
  return form.R * Math.tan(Math.atan(1 / form.ratio) / 2)
}

/** Length of the branch's own elements, WA–WE on the branch track. */
const branchRouteLength = (track, sw) => (track.elements ?? [])
  .filter(el => elementBelongsToSwitch(el, sw))
  .reduce((sum, el) => sum + (el.length ?? 0), 0)

/**
 * The detail of one turnout, or null where turnoutSleepers finds none (not a
 * turnout, a track missing, no ldS for its form, a track shorter than WA–ldS).
 *
 * `rail` is the rail profile of the main track at WA (crossSection
 * superstructureAt), which picks the variant. Returns
 *
 *   { sw, form, variant, origin, axes: { x, y }, sleepers, rails, marks, counts }
 *
 * with every point [x, y] in the turnout's frame (a plane point is
 * origin + x·axes.x + y·axes.y). `sleepers`: [{ kind, k, ends, m, b, main,
 * branch }] — kind 'grid' or 'lds' (WA–ldS, `m`/`b` their distance from WA
 * along either track, `main`/`branch` their stations), 'before' (before WA,
 * `m` negative), 'main' or 'branch' (behind the ldS on that track). `rails`:
 * [{ track: 'main' | 'branch', side: 'outer' | 'inner', points }], inner the
 * rail toward the other track. `marks`: WA, WM, WE and ldS, the last two on
 * both tracks.
 */
export function switchDetail(tracks, sw, { formOf = switchTypeByLabel, rail = null } = {}) {
  const frame = turnoutSleepers(tracks, sw, { formOf })
  if (!frame) return null
  const { main, branch } = frame
  const form = formOf(sw.label)
  const variant = form ? switchVariantFor(form, rail) : null
  const [before, behindMain, behindBranch] = variant?.klammer ?? [0, 0, 0]

  const wa = routePose(main, 0)
  if (!wa) return null
  // Before WA the main route runs on along its tangent there: the 1.5 m of the
  // three sleepers leave a curve of R 300 by under 4 mm.
  const mainPose = (d) => (d < 0 ? { p: add(wa.p, wa.t, d), t: wa.t } : routePose(main, d))

  // The side the branch lies to, seen from the main route — at the ldS, where
  // the two are well apart.
  const ldsMain = routePose(main, frame.lds)
  const ldsBranch = routePose(branch, frame.ldsBranchDistance)
  const side = Math.sign(dot(sub(ldsBranch.p, ldsMain.p), left(ldsMain.t))) || 1
  const toward = (t) => { const n = left(t); return [n[0] * side, n[1] * side] }

  const origin = wa.p
  const X = wa.t
  const Y = toward(X)
  const local = (p) => { const v = sub(p, origin); return [dot(v, X), dot(v, Y)] }

  // A grid sleeper closer than half a spacing before the ldS is the ldS: two
  // sleepers a few centimetres apart do not exist, and the table counts one —
  // with it, its count is reached to one sleeper for every form. The heights
  // keep the grid as it is (decision 256).
  const through = frame.sleepers.filter((sl, i, all) => !(
    i === all.length - 2 && all[i + 1].k === 'lds' && all[i + 1].s - sl.s < SLEEPER_SPACING / 2))

  const sleepers = []
  for (const sl of through) {
    const P = routePose(main, sl.m), Q = routePose(branch, sl.b)
    if (!P || !Q) continue
    // Square to the bisector, whose direction is the mean of the two tracks'.
    const n = toward(unit(add(P.t, Q.t)) ?? P.t)
    const reachMain = SLEEPER_HALF / Math.max(0.5, Math.abs(dot(n, toward(P.t))))
    const reachBranch = SLEEPER_HALF / Math.max(0.5, Math.abs(dot(n, toward(Q.t))))
    sleepers.push({
      kind: sl.k === 'lds' ? 'lds' : 'grid', k: sl.k, m: sl.m, b: sl.b, main: sl.main, branch: sl.branch,
      ends: [local(add(P.p, n, -reachMain)), local(add(Q.p, n, reachBranch))],
    })
  }

  for (let j = 1; j <= before; j++) {
    const d = FIRST_SLEEPER - SLEEPER_SPACING * j
    const P = mainPose(d)
    sleepers.push({
      kind: 'before', k: -j, m: d,
      ends: [local(add(P.p, Y, -SLEEPER_HALF)), local(add(P.p, Y, SLEEPER_HALF))],
    })
  }

  // Behind the ldS: one sleeper per track, shortened on the inner side.
  const behind = (own, other, start, otherStart, count, kind, inward) => {
    for (let j = 1; j <= count; j++) {
      const d = start + SLEEPER_SPACING * j
      if (d > own.length) break
      const P = routePose(own, d)
      if (!P) break
      const n = inward(P.t)
      const hit = routeCut(other, P.p, P.t, otherStart + SLEEPER_SPACING * j)
      const Q = hit == null ? null : routePose(other, hit)
      const gap = Q ? Math.hypot(...sub(Q.p, P.p)) : Infinity
      const inner = Math.max(0, Math.min(SLEEPER_HALF, gap / 2 - SLEEPER_GAP))
      sleepers.push({
        kind, k: j, [kind === 'main' ? 'm' : 'b']: d, [kind]: own.station(d),
        ends: [local(add(P.p, n, -SLEEPER_HALF)), local(add(P.p, n, inner))],
      })
    }
  }
  behind(main, branch, frame.lds, frame.ldsBranchDistance, behindMain, 'main', toward)
  behind(branch, main, frame.ldsBranchDistance, frame.lds, behindBranch, 'branch', (t) => {
    const n = toward(t)
    return [-n[0], -n[1]]
  })

  // The rails, from the first sleeper's end to the last one's, plus a little.
  const railsOf = (track, from, to, pose, inward) => {
    const out = { outer: [], inner: [] }
    const n = Math.max(1, Math.ceil((to - from) / RAIL_STEP))
    for (let i = 0; i <= n; i++) {
      const P = pose(from + (to - from) * i / n)
      if (!P) continue
      const k = inward(P.t)
      out.outer.push(local(add(P.p, k, -RAIL_OFFSET)))
      out.inner.push(local(add(P.p, k, RAIL_OFFSET)))
    }
    return [{ track, side: 'outer', points: out.outer }, { track, side: 'inner', points: out.inner }]
  }
  const mainFrom = before ? FIRST_SLEEPER - SLEEPER_SPACING * before - RAIL_BEYOND : 0
  const mainTo = Math.min(main.length, frame.lds + SLEEPER_SPACING * behindMain + RAIL_BEYOND)
  const branchTo = Math.min(branch.length, frame.ldsBranchDistance + SLEEPER_SPACING * behindBranch + RAIL_BEYOND)
  const rails = [
    ...railsOf('main', mainFrom, mainTo, mainPose, toward),
    ...railsOf('branch', 0, branchTo, (d) => routePose(branch, d), toward),
  ]

  const a = tangentLength(form)
  const weBranch = branchRouteLength(branch.track, sw)
  const marks = {
    WA: [0, 0],
    WM: a != null && a <= main.length ? local(routePose(main, a).p) : null,
    WE: { main: local(routePose(main, frame.we).p), branch: weBranch > 0 ? local(routePose(branch, weBranch).p) : null },
    ldS: { main: local(ldsMain.p), branch: local(ldsBranch.p) },
  }

  const counted = (kind) => sleepers.filter(s => s.kind === kind).length
  return {
    sw, form, variant, origin, axes: { x: X, y: Y }, sleepers, rails, marks,
    counts: {
      throughSleepers: counted('grid') + counted('lds'), before: counted('before'),
      behindMain: counted('main'), behindBranch: counted('branch'),
    },
  }
}

// ── A form that is not laid ─────────────────────────────────────────────────

const ORIGIN = { easting: 500000, northing: 5600000, zone: 25832 }
const node = (p) => [p.easting, p.northing]

/** Elements along a chain of { length, signedR } from a point on a bearing. */
function chainElements(start, bearing, chain, fields) {
  const elements = []
  let p = start, b = bearing
  for (const piece of chain) {
    const end = piece.signedR ? endPointCurvedUtm(p, b, piece.length, piece.signedR) : endPointStraightUtm(p, b, piece.length)
    const endBearing = bearingAfterUtm(b, piece.length, piece.signedR)
    elements.push(piece.signedR
      ? { elementType: 1, startNode: node(p), endNode: node(end), bearing: b, endBearing, radius: piece.signedR, length: piece.length, ...fields }
      : { elementType: 0, startNode: node(p), endNode: node(end), bearing: b, length: piece.length, ...fields })
    p = end; b = endBearing
  }
  return { elements, end: p, bearing: b }
}

/**
 * The detail of a catalogue form that is not laid anywhere: the form put on
 * two helper tracks from WA eastward, branching to `side`, with the tracks
 * running on long enough for every sleeper behind the ldS. What a picker shows
 * before a turnout exists.
 */
export function formDetail(form, { rail = null, side = 'left' } = {}) {
  if (!form || form.art !== 'weiche') return null
  const sw = {
    switchId: 'detail', kind: 'turnout', label: form.label,
    ports: { A: { trackId: 'detail-a', endpoint: 'END' }, B1: { trackId: 'detail-b', endpoint: 'BEGIN' }, B2: { trackId: 'detail-m', endpoint: 'BEGIN' } },
  }
  const onward = (form.lds ?? 0) + SLEEPER_SPACING * 30 + 10
  const own = { switchId: sw.switchId }
  const mainChain = form.symmetric
    ? switchFormChain(form, side === 'left' ? 'right' : 'left')
    : [{ length: switchStraightLength(form), signedR: null }]
  const m = chainElements(ORIGIN, 90, mainChain, { ...own, switchRoute: 'main' })
  const mOn = chainElements(m.end, m.bearing, [{ length: onward, signedR: null }], {})
  const b = chainElements(ORIGIN, 90, switchFormChain(form, side), { ...own, switchRoute: 'branch' })
  const bOn = chainElements(b.end, b.bearing, [{ length: onward, signedR: null }], {})
  const tracks = [
    { id: 'detail-m', epsg: 25832, elements: [...m.elements, ...mOn.elements] },
    { id: 'detail-b', epsg: 25832, elements: [...b.elements, ...bOn.elements] },
  ]
  return switchDetail(tracks, sw, { formOf: (label) => (label === form.label ? form : null), rail })
}
