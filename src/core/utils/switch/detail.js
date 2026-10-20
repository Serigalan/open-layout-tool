/**
 * A turnout drawn in detail (Paket WD, decisions 341 and 347): its sleepers and
 * its rails, in the turnout's own frame — WA at the origin, x along the main
 * route's tangent at WA, y toward the side the branch leaves to.
 *
 * The sleepers are the grid the heights lie on (sleepers.js, decisions 256 and
 * 349): WA and WE are rail joints in the middle of a sleeper bay, so the first
 * sleeper lies 0.30 m behind WA and the last before WE 0.30 m before it, the
 * ones between evenly spaced at about 0.60 m, and every 0.60 m behind WE. The
 * last through sleeper (ldS) is the grid sleeper nearest to where the
 * catalogue puts it. Each reaches from the outer rail of the
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

import {
  endPointCurvedUtm, endPointStraightUtm, bearingAfterUtm, transitionBearingAtUtm, transitionPointAtUtm,
} from '../geometry'
import { elementBelongsToSwitch } from '../track'
import { switchFormChain, switchStraightLength, switchTangents, switchTypeByLabel } from './catalogue'
import {
  FIRST_SLEEPER, SLEEPER_SPACING, routeCut, routePose, sleepersWeToLds, tableLds, turnoutSleepers,
} from './sleepers'

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
 * Distance WA–WM along the main route [m]: t1, where the branch's end tangent
 * crosses the through route — R · tan(α/2) for a form of one arc, half its
 * length for the symmetrical turnout.
 */
function tangentLength(form) {
  if (!form?.R || !form?.ratio) return null
  if (form.symmetric) return switchStraightLength(form) / 2
  return switchTangents(form).t1
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
 * both tracks, and `joints` — WA and WE as the rail joints they are, a point
 * on each rail: `joints.WA` the two of the main track, `joints.WE` those of
 * the main track and of the branch.
 */
export function switchDetail(tracks, sw, { formOf = switchTypeByLabel, rail = null } = {}) {
  const frame = turnoutSleepers(tracks, sw, { formOf, rail })
  if (!frame) return null
  const { main, branch, variant } = frame
  const form = formOf(sw.label)
  const [before, behindMain, behindBranch] = variant?.klammer ?? [0, 0, 0]

  const wa = routePose(main, 0)
  if (!wa) return null
  // Before WA the main route runs on along its tangent there: the 1.5 m of the
  // three sleepers leave a curve of R 300 by under 4 mm.
  const mainPose = (d) => (d < 0 ? { p: add(wa.p, wa.t, d), t: wa.t } : routePose(main, d))

  // The side the branch lies to, seen from the main route — at the ldS, where
  // the two are well apart.
  const ldsMainPose = routePose(main, frame.lds)
  const ldsBranchPose = routePose(branch, frame.ldsBranchDistance)
  const side = Math.sign(dot(sub(ldsBranchPose.p, ldsMainPose.p), left(ldsMainPose.t))) || 1
  const toward = (t) => { const n = left(t); return [n[0] * side, n[1] * side] }
  const away = (t) => { const n = toward(t); return [-n[0], -n[1]] }

  const origin = wa.p
  const X = wa.t
  const Y = toward(X)
  const local = (p) => { const v = sub(p, origin); return [dot(v, X), dot(v, Y)] }
  // How far along direction n a sleeper reaches from an axis whose own normal is `normal`.
  const reach = (n, normal) => SLEEPER_HALF / Math.max(0.5, Math.abs(dot(n, normal)))

  const sleepers = []
  // WA–WE: square to the bisector, as many as the table counts (decision 350).
  const sWe = frame.weBisector ?? Infinity
  for (const sl of (frame.grid ?? frame.sleepers).filter(s => s.k !== 'lds' && s.s < sWe - 1e-6)) {
    const P = routePose(main, sl.m), Q = routePose(branch, sl.b)
    if (!P || !Q) continue
    const n = toward(unit(add(P.t, Q.t)) ?? P.t)
    sleepers.push({
      kind: 'grid', k: sleepers.length, m: sl.m, b: sl.b, main: sl.main, branch: sl.branch,
      ends: [local(add(P.p, n, -reach(n, toward(P.t)))), local(add(Q.p, n, reach(n, toward(Q.t))))],
    })
  }

  // WE to the ldS: laid off along both following axes from WE — the same
  // distance on the main track and on the branch, the ldS at the table's — so
  // each sleeper joins the two points, and that gives the ldS its angle.
  const weBranch = branchRouteLength(branch.track, sw)
  const lds = tableLds(variant, frame.lds - frame.we)
  let ldsDir = null
  for (const d of sleepersWeToLds(lds)) {
    const m = frame.we + d, b = weBranch + d
    if (m > main.length || b > branch.length) break
    const P = routePose(main, m), Q = routePose(branch, b)
    const n = P && Q ? unit(sub(Q.p, P.p)) : null
    if (!n) break
    sleepers.push({
      kind: 'grid', k: sleepers.length, m, b, main: main.station(m), branch: branch.station(b),
      ends: [local(add(P.p, n, -reach(n, toward(P.t)))), local(add(Q.p, n, reach(n, toward(Q.t))))],
    })
    ldsDir = n
  }
  // The last of them is the ldS — or, where the table puts the ldS before WE,
  // the last sleeper before it.
  const ldsSleeper = sleepers[sleepers.length - 1]
  if (ldsSleeper) ldsSleeper.kind = 'lds'
  if (!ldsDir && ldsSleeper) {
    const [e0, e1] = ldsSleeper.ends
    const v = unit(sub(e1, e0))
    ldsDir = [v[0] * X[0] + v[1] * Y[0], v[0] * X[1] + v[1] * Y[1]]
  }

  for (let j = 1; j <= before; j++) {
    const d = FIRST_SLEEPER - SLEEPER_SPACING * j
    const P = mainPose(d)
    sleepers.push({
      kind: 'before', k: -j, m: d,
      ends: [local(add(P.p, Y, -SLEEPER_HALF)), local(add(P.p, Y, SLEEPER_HALF))],
    })
  }

  // Behind the ldS: one sleeper per track every 0.60 m, carrying the ldS's
  // angle on and turning linearly until the last one lies square to its
  // track; on the inner side shortened to 5 cm short of the middle between
  // the two axes.
  const behind = (own, other, start, otherStart, count, kind, inward, dirAtLds) => {
    if (!dirAtLds) return
    const P0 = routePose(own, start)
    const n0 = inward(P0.t)
    const turn = Math.atan2(n0[0] * dirAtLds[1] - n0[1] * dirAtLds[0], dot(n0, dirAtLds))
    for (let j = 1; j <= count; j++) {
      const d = start + SLEEPER_SPACING * j
      if (d > own.length) break
      const P = routePose(own, d)
      if (!P) break
      const normal = inward(P.t)
      const a = turn * (1 - j / count)
      const n = [normal[0] * Math.cos(a) - normal[1] * Math.sin(a), normal[0] * Math.sin(a) + normal[1] * Math.cos(a)]
      const hit = routeCut(other, P.p, left(n), otherStart + SLEEPER_SPACING * j)
      const Q = hit == null ? null : routePose(other, hit)
      const gap = Q ? Math.hypot(...sub(Q.p, P.p)) : Infinity
      const full = reach(n, normal)
      const inner = Math.max(0, Math.min(full, gap / 2 - SLEEPER_GAP))
      sleepers.push({
        kind, k: j, [kind === 'main' ? 'm' : 'b']: d, [kind]: own.station(d),
        ends: [local(add(P.p, n, -full)), local(add(P.p, n, inner))],
      })
    }
  }
  const ldsM = ldsSleeper?.m ?? frame.lds
  const ldsB = ldsSleeper?.b ?? frame.ldsBranchDistance
  behind(main, branch, ldsM, ldsB, behindMain, 'main', toward, ldsDir)
  behind(branch, main, ldsB, ldsM, behindBranch, 'branch', away, ldsDir && [-ldsDir[0], -ldsDir[1]])

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
  const mainTo = Math.min(main.length, Math.max(frame.we, ldsM) + SLEEPER_SPACING * behindMain + RAIL_BEYOND)
  const branchTo = Math.min(branch.length, Math.max(weBranch, ldsB) + SLEEPER_SPACING * behindBranch + RAIL_BEYOND)
  const rails = [
    ...railsOf('main', mainFrom, mainTo, mainPose, toward),
    ...railsOf('branch', 0, branchTo, (d) => routePose(branch, d), toward),
  ]

  const a = tangentLength(form)
  const weMain = routePose(main, frame.we)
  const weBranchPose = weBranch > 0 ? routePose(branch, weBranch) : null
  // A joint on both rails of a track (decision 349): on each rail in the
  // middle of the bay between the two sleepers it lies between — measured
  // along that rail, since the sleepers stand square to the bisector and not
  // to the track, and 0.75 m off the axis the bay moves by up to some
  // centimetres. Without a sleeper on one side, 0.30 m from the other.
  const onRails = (P, d, key) => {
    const near = sleepers.filter(s => s[key] != null)
    const before = near.filter(s => s[key] < d).reduce((a, s) => (!a || s[key] > a[key] ? s : a), null)
    const after = near.filter(s => s[key] > d).reduce((a, s) => (!a || s[key] < a[key] ? s : a), null)
    const tl = [dot(P.t, X), dot(P.t, Y)]
    return [-RAIL_OFFSET, RAIL_OFFSET].map(off => {
      const r = local(add(P.p, toward(P.t), off))
      // Where the rail, r + u·tl, crosses a sleeper's centre line.
      const cross = (s) => {
        if (!s) return null
        const [e0, e1] = s.ends
        const e = sub(e1, e0)
        const den = tl[0] * e[1] - tl[1] * e[0]
        if (Math.abs(den) < 1e-12) return null
        return ((e0[0] - r[0]) * e[1] - (e0[1] - r[1]) * e[0]) / den
      }
      const ub = cross(before), ua = cross(after)
      const u = ub != null && ua != null ? (ub + ua) / 2
        : ua != null ? ua - FIRST_SLEEPER : ub != null ? ub + FIRST_SLEEPER : 0
      return add(r, tl, u)
    })
  }
  const marks = {
    WA: [0, 0],
    WM: a != null && a <= main.length ? local(routePose(main, a).p) : null,
    WE: { main: local(weMain.p), branch: weBranchPose ? local(weBranchPose.p) : null },
    ldS: { main: local(routePose(main, ldsM).p), branch: local(routePose(branch, ldsB).p) },
    joints: {
      WA: onRails(wa, 0, 'm'),
      WE: [onRails(weMain, frame.we, 'm'), ...(weBranchPose ? [onRails(weBranchPose, weBranch, 'b')] : [])],
    },
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

/** Elements along a chain of { length, signedR, signedREnd? } from a point on a bearing. */
function chainElements(start, bearing, chain, fields) {
  const elements = []
  let p = start, b = bearing
  for (const piece of chain) {
    const { length, signedR } = piece
    let el, end, endBearing
    if ('signedREnd' in piece && piece.signedREnd !== signedR) {
      const r2 = piece.signedREnd
      end = transitionPointAtUtm(p, b, length, signedR, r2, 'clothoid', length)
      endBearing = transitionBearingAtUtm(b, length, signedR, r2, 'clothoid', length)
      el = { elementType: 2, transitionType: 'clothoid', r1: signedR, r2, startNode: node(p), endNode: node(end), bearing: b, endBearing, length }
    } else if (signedR) {
      end = endPointCurvedUtm(p, b, length, signedR)
      endBearing = bearingAfterUtm(b, length, signedR)
      el = { elementType: 1, startNode: node(p), endNode: node(end), bearing: b, endBearing, radius: signedR, length }
    } else {
      end = endPointStraightUtm(p, b, length)
      endBearing = b
      el = { elementType: 0, startNode: node(p), endNode: node(end), bearing: b, length }
    }
    elements.push({ ...el, ...fields })
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
