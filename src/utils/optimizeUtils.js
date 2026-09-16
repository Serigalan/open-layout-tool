import { transitionShift, computeClothoidUtm, sampleTransitionUtm } from './clothoidUtils'
import {
  arcCenter, computeStraightValuesUtm, computeCurvedValuesUtm, arcCoordsFromRadiusUtm,
} from './elementUtils'
import { utmToWgs84 } from './coordinateUtils'
import {
  SAGITTA_ELEMENT, SAGITTA_TRACK, cantSign, MAX_SWITCH_CANT, MAX_SWITCH_CANT_DEF,
} from './mapConstants'

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

// Minimum ramp length factor: l ≥ k · v · Δu / 1000  [l m, v km/h, Δu mm]
const RAMP_FACTOR = { clothoid: 8, bloss: 6 }

const U_MAX  = 160    // max cant [mm]
const U_STEP = 5      // cant grid step [mm]

/**
 * A curve group that runs through a turnout is held to the switch's limits
 * rather than the line's: cant to MAX_SWITCH_CANT and deficiency to
 * MAX_SWITCH_CANT_DEF. The exception that lifts the cant to 120 is deliberately
 * not read here — it is a decision a designer writes down for one element, not
 * headroom an automatic run may help itself to.
 *
 * The group keeps its own pair, so a uf the caller asks for cannot lift the
 * ceiling back over what a switch admits.
 */
const groupUMax = (g) => (g.onSwitch ? MAX_SWITCH_CANT : U_MAX)
const groupUf   = (g, params) => (g.onSwitch ? Math.min(params.uf, MAX_SWITCH_CANT_DEF) : params.uf)

/** Permissible speed [km/h] for radius R [m], cant u and cant deficiency uf [mm]. */
export function permissibleSpeed(R, u, uf) {
  return Math.sqrt(Math.abs(R) * (u + uf) / 11.8)
}

const dirOf = (bearingDeg) => ({ e: Math.sin(bearingDeg * DEG2RAD), n: Math.cos(bearingDeg * DEG2RAD) })

// ── Track parsing ────────────────────────────────────────────────────────────

const isStraight   = (el) => el.radius == null && el.elementType !== 2
const isTransition = (el) => el.elementType === 2
const isArc        = (el) => el.radius != null

/**
 * Split a track into optimizable curve groups: straight – [transition] – arc –
 * [transition] – straight, where the bounding straights are shared between
 * neighbouring groups. Returns { groups, straights } or { error } when the
 * chain has an unsupported topology (must start/end with a straight, every
 * arc bounded by straights with at most one transition per side).
 */
export function parseTrackForOptimization(track) {
  const els = track.elements ?? []
  if (els.length < 3) return { error: 'optimize_no_curves' }
  if (!isStraight(els[0]) || !isStraight(els[els.length - 1])) return { error: 'optimize_ends' }

  const zone = track.epsg
  const groups = []
  let i = 0
  let entryIdx = 0                       // index of the current leading straight
  i = 1
  while (i < els.length) {
    if (isStraight(els[i])) { entryIdx = i; i++; continue }
    // start of a curve group
    let t1 = null, t2 = null
    if (isTransition(els[i])) { t1 = i; i++ }
    if (i >= els.length || !isArc(els[i])) return { error: 'optimize_topology' }
    const arcIdx = i; i++
    if (i < els.length && isTransition(els[i])) { t2 = i; i++ }
    if (i >= els.length || !isStraight(els[i])) return { error: 'optimize_topology' }
    groups.push(buildGroup(els, entryIdx, t1, arcIdx, t2, i, zone))
    entryIdx = i
    i++
  }
  if (groups.length === 0) return { error: 'optimize_no_curves' }
  return { groups, zone }
}

function nodeUtm(node, zone) {
  return { easting: node[0], northing: node[1], zone }
}

function buildGroup(els, entryIdx, t1Idx, arcIdx, t2Idx, exitIdx, zone) {
  const entry = els[entryIdx]
  const exit  = els[exitIdx]
  const arc   = els[arcIdx]
  const svIn  = computeStraightValuesUtm(nodeUtm(entry.startNode, zone), nodeUtm(entry.endNode, zone))
  const svOut = computeStraightValuesUtm(nodeUtm(exit.startNode, zone),  nodeUtm(exit.endNode, zone))
  const t1 = t1Idx != null ? els[t1Idx] : null
  const t2 = t2Idx != null ? els[t2Idx] : null
  const g = {
    entryIdx, t1Idx, arcIdx, t2Idx, exitIdx, zone,
    p1: { e: entry.startNode[0], n: entry.startNode[1] },   // fixed outer end of entry straight
    d1: dirOf(svIn.bearing),
    b1: svIn.bearing,
    p2: { e: exit.endNode[0], n: exit.endNode[1] },          // fixed outer end of exit straight
    d2: dirOf(svOut.bearing),
    b2: svOut.bearing,
    rAlt:  Math.abs(arc.radius),
    // The solver works with magnitudes throughout; the sign is re-applied from
    // the resulting curve direction when the elements are rebuilt.
    uAlt:  Math.abs(arc.cant ?? 0),
    speedAlt: arc.speed ?? 0,
    type1: t1?.transitionType === 'bloss' ? 'bloss' : 'clothoid',
    type2: t2?.transitionType === 'bloss' ? 'bloss' : 'clothoid',
    hasT1: !!t1,
    hasT2: !!t2,
    // The curve part is what the run re-cants; the bounding straights carry no
    // cant of their own and are shared with the neighbouring groups, so a
    // turnout on one of them is not this group's business.
    onSwitch: els.slice(entryIdx + 1, exitIdx).some(el => el.switchBranch),
  }
  g.refPoly = buildReferencePolyline(els, entryIdx, exitIdx, zone)
  g.refCurvePts = buildReferencePolyline(els, entryIdx + 1, exitIdx - 1, zone)
  return g
}

// ── Sampling (all in the track's native CRS plane) ───────────────────────────

// Sample an arc given by its two endpoints and signed radius.
function sampleArcUtm(sE, sN, eE, eN, signedR, maxStepAngle = 0.02) {
  const ac = arcCenter(sE, sN, eE, eN, signedR)
  if (!ac) return [[sE, sN], [eE, eN]]
  const { cx, cy, absR } = ac
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const a1 = Math.atan2(sN - cy, sE - cx)
  const a2 = Math.atan2(eN - cy, eE - cx)
  const sweep = signedR >= 0
    ? -((norm(a1) - norm(a2) + 2 * Math.PI) % (2 * Math.PI))
    : (norm(a2) - norm(a1) + 2 * Math.PI) % (2 * Math.PI)
  const nSeg = Math.max(2, Math.min(200, Math.ceil(Math.abs(sweep) / maxStepAngle)))
  const pts = []
  for (let i = 0; i <= nSeg; i++) {
    const a = a1 + (i / nSeg) * sweep
    pts.push([cx + absR * Math.cos(a), cy + absR * Math.sin(a)])
  }
  return pts
}

// Polyline over an index range of the original elements.
function buildReferencePolyline(els, from, to, zone) {
  const pts = []
  for (let i = from; i <= to; i++) {
    const el = els[i]
    const [sE, sN] = el.startNode
    const [eE, eN] = el.endNode
    let part
    if (isArc(el)) {
      part = sampleArcUtm(sE, sN, eE, eN, el.radius)
    } else if (isTransition(el)) {
      const sv = computeStraightValuesUtm(nodeUtm(el.startNode, zone), nodeUtm(el.endNode, zone))
      part = sampleTransitionUtm({ easting: sE, northing: sN }, el.bearing ?? sv.bearing, el.length,
        el.r1 ?? null, el.r2 ?? null, el.transitionType === 'bloss' ? 'bloss' : 'clothoid')
    } else {
      part = [[sE, sN], [eE, eN]]
    }
    if (pts.length) part = part.slice(1)
    pts.push(...part)
  }
  return pts
}

function distPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const den = dx * dx + dy * dy
  const t = den > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / den)) : 0
  const qx = ax + t * dx, qy = ay + t * dy
  return Math.hypot(px - qx, py - qy)
}

function maxDistToPolyline(points, poly) {
  let max = 0
  for (const [px, py] of points) {
    let best = Infinity
    for (let j = 0; j + 1 < poly.length; j++) {
      const d = distPointToSegment(px, py, poly[j][0], poly[j][1], poly[j + 1][0], poly[j + 1][1])
      if (d < best) best = d
    }
    if (best > max) max = best
  }
  return max
}

// ── Geometric fit of one curve group (splice math, UTM native) ───────────────

/**
 * Fit transition–arc–transition between the two fixed tangent lines of a group
 * for radius R and transition lengths l1/l2. Returns null when no valid fit
 * exists (degenerate corner or reflex sweep).
 */
export function fitCurveGroup(g, R, l1, l2) {
  const { p1, d1, p2, d2 } = g
  const cross = d1.e * d2.n - d1.n * d2.e
  const dot   = d1.e * d2.e + d1.n * d2.n
  const turn  = Math.atan2(cross, dot)
  if (Math.abs(turn) < 1e-9) return null
  const curveSide = turn > 0 ? 'left' : 'right'
  const curveSign = curveSide === 'right' ? 1 : -1
  const signedR   = curveSide === 'left' ? -R : R

  const s1 = transitionShift(l1, R, g.type1)
  const s2 = transitionShift(l2, R, g.type2)

  // Arc centre: signed distance R+p from each tangent line.
  const rhs1 = curveSign * (R + s1.p) + p1.e * d1.n - p1.n * d1.e
  const rhs2 = curveSign * (R + s2.p) + p2.e * d2.n - p2.n * d2.e
  const det  = cross
  const Ce = (-rhs1 * d2.e + rhs2 * d1.e) / det
  const Cn = (d1.n * rhs2 - d2.n * rhs1) / det

  // Perpendicular feet on the tangents → transition start/end points.
  const proj1 = (Ce - p1.e) * d1.e + (Cn - p1.n) * d1.n
  const virt1 = { e: p1.e + proj1 * d1.e, n: p1.n + proj1 * d1.n }
  const proj2 = (Ce - p2.e) * d2.e + (Cn - p2.n) * d2.n
  const virt2 = { e: p2.e + proj2 * d2.e, n: p2.n + proj2 * d2.n }
  const clStart = { e: virt1.e - s1.t * d1.e, n: virt1.n - s1.t * d1.n }
  const clEnd   = { e: virt2.e + s2.t * d2.e, n: virt2.n + s2.t * d2.n }

  const th1 = Math.atan2(virt1.n - Cn, virt1.e - Ce)
  const th2 = Math.atan2(virt2.n - Cn, virt2.e - Ce)
  const arcStartAng = th1 - s1.phi * curveSign
  const arcEndAng   = th2 + s2.phi * curveSign
  let sweep = arcEndAng - arcStartAng
  if (curveSide === 'left'  && sweep < 0) sweep += 2 * Math.PI
  if (curveSide === 'right' && sweep > 0) sweep -= 2 * Math.PI
  if (Math.abs(sweep) < 1e-6 || Math.abs(sweep) > Math.PI + 1e-6) return null

  const arcStart = { e: Ce + R * Math.cos(arcStartAng), n: Cn + R * Math.sin(arcStartAng) }
  const arcEnd   = { e: Ce + R * Math.cos(arcEndAng),   n: Cn + R * Math.sin(arcEndAng) }

  // Consumed straight lengths, measured from the fixed outer ends.
  const entryLen = (clStart.e - p1.e) * d1.e + (clStart.n - p1.n) * d1.n
  const exitLen  = (p2.e - clEnd.e) * d2.e + (p2.n - clEnd.n) * d2.n

  return {
    R, signedR, curveSide, Ce, Cn, arcStartAng, sweep,
    clStart, clEnd, arcStart, arcEnd,
    arcLen: Math.abs(sweep) * R,
    entryLen, exitLen,
  }
}

// Samples of the fitted curve zone (transitions + arc), for the offset check.
function sampleFit(g, fit, l1, l2) {
  const pts = []
  if (l1 > 0) {
    pts.push(...sampleTransitionUtm({ easting: fit.clStart.e, northing: fit.clStart.n }, g.b1, l1, null, fit.signedR, g.type1))
  }
  const arc = sampleArcUtm(fit.arcStart.e, fit.arcStart.n, fit.arcEnd.e, fit.arcEnd.n, fit.signedR)
  pts.push(...(pts.length ? arc.slice(1) : arc))
  if (l2 > 0) {
    const arcEndBearing = fit.signedR >= 0
      ? (Math.atan2(Math.sin(fit.arcStartAng + fit.sweep), -Math.cos(fit.arcStartAng + fit.sweep)) * RAD2DEG + 360) % 360
      : (Math.atan2(-Math.sin(fit.arcStartAng + fit.sweep), Math.cos(fit.arcStartAng + fit.sweep)) * RAD2DEG + 360) % 360
    pts.push(...sampleTransitionUtm({ easting: fit.arcEnd.e, northing: fit.arcEnd.n }, arcEndBearing, l2, fit.signedR, null, g.type2).slice(1))
  }
  return pts
}

// Max lateral deviation between the fitted group and the original alignment.
function fitOffset(g, fit, l1, l2) {
  const newPts  = sampleFit(g, fit, l1, l2)
  const newPoly = [[g.p1.e, g.p1.n], ...newPts, [g.p2.e, g.p2.n]]
  return Math.max(
    maxDistToPolyline(newPts, g.refPoly),
    maxDistToPolyline(g.refCurvePts, newPoly),
  )
}

// ── Optimization ─────────────────────────────────────────────────────────────

// Required transition lengths for speed v and cant u (≥ min element length).
function rampLengths(g, v, u) {
  const minLen = 0.2 * v
  const l1 = g.hasT1 ? Math.max(minLen, RAMP_FACTOR[g.type1] * v * u / 1000) : 0
  const l2 = g.hasT2 ? Math.max(minLen, RAMP_FACTOR[g.type2] * v * u / 1000) : 0
  return { l1, l2, minLen }
}

function evaluate(g, R, u, params) {
  const v = permissibleSpeed(R, u, groupUf(g, params))
  const { l1, l2, minLen } = rampLengths(g, v, u)
  const fit = fitCurveGroup(g, R, l1, l2)
  if (!fit) return null
  if (fit.arcLen < minLen) return null
  if (fit.entryLen < minLen || fit.exitLen < minLen) return null
  const offset = fitOffset(g, fit, l1, l2)
  if (offset > params.corridor) return null
  return { R, u, v, l1, l2, fit, offset }
}

// Largest feasible R for a fixed cant u (offset grows monotonically with R).
function maxRadiusFor(g, u, params) {
  const feasible = (R) => evaluate(g, R, u, params)
  let lo = null, hi = null
  if (feasible(g.rAlt)) {
    lo = g.rAlt
    let R = g.rAlt
    for (let k = 0; k < 60 && !hi; k++) {
      R *= 1.5
      if (feasible(R)) lo = R
      else hi = R
      if (R > 1e6) break
    }
    if (!hi) return feasible(lo)
  } else {
    let R = g.rAlt
    for (let k = 0; k < 40 && lo == null; k++) {
      R *= 0.85
      if (feasible(R)) lo = R
    }
    if (lo == null) return null
    hi = lo / 0.85
  }
  while (hi - lo > 0.01) {
    const mid = (lo + hi) / 2
    if (feasible(mid)) lo = mid
    else hi = mid
  }
  return feasible(lo)
}

/**
 * Optimize one curve group: maximize the permissible speed v over (R, u).
 * u runs on a grid from the existing cant up to 160 mm (only when both sides
 * have transitions to carry the ramp); per u the largest feasible R is found
 * by bisection. Returns the best candidate or null (no feasible change).
 */
export function optimizeGroup(g, params) {
  // The existing cant is always a candidate, even where it already stands above
  // what the group may be raised to: the run improves an alignment, it does not
  // quietly re-cant one that is already over its limit.
  const uValues = [g.uAlt]
  if (g.hasT1 && g.hasT2) {
    const uMax = groupUMax(g)
    for (let u = Math.ceil(g.uAlt / U_STEP) * U_STEP; u <= uMax; u += U_STEP) {
      if (u > g.uAlt) uValues.push(u)
    }
  }
  let best = null
  for (const u of uValues) {
    const cand = maxRadiusFor(g, u, params)
    if (cand && (!best || cand.v > best.v)) best = cand
  }
  return best
}

// ── Element building ─────────────────────────────────────────────────────────

const wgs = (e, n, zone) => utmToWgs84(e, n, zone)

function straightElement(from, to, zone, base = {}) {
  const sv = computeStraightValuesUtm({ easting: from.e, northing: from.n, zone }, { easting: to.e, northing: to.n, zone })
  return {
    elementType: 0,
    startNode: sv.startNode, endNode: sv.endNode,
    bearing: sv.bearing, length: sv.length, absLength: sv.length,
    speed: base.speed ?? 0, ...(base.cant != null ? { cant: base.cant } : {}),
    geometry: { type: 'LineString', coordinates: [wgs(from.e, from.n, zone), wgs(to.e, to.n, zone)] },
  }
}

function transitionElement(start, bearing, L, r1, r2, type, zone, speed) {
  const startUtm = { easting: start.e, northing: start.n, zone }
  const cl  = computeClothoidUtm(startUtm, bearing, L, r1, r2, SAGITTA_ELEMENT, type)
  const clR = computeClothoidUtm(startUtm, bearing, L, r1, r2, SAGITTA_TRACK, type)
  return {
    elementType: 2, transitionType: type, r1, r2,
    startNode: [start.e, start.n], endNode: [cl.endUtm.easting, cl.endUtm.northing],
    bearing, endBearing: cl.endBearing, length: L, absLength: L, speed,
    geometry: { type: 'LineString', coordinates: cl.coords },
    renderCoords: clR.coords,
  }
}

// `cant` is a magnitude; it is signed here from the fitted curve direction.
function arcElement(fit, zone, speed, cant) {
  const s = { easting: fit.arcStart.e, northing: fit.arcStart.n, zone }
  const e = { easting: fit.arcEnd.e,   northing: fit.arcEnd.n,   zone }
  const cv = computeCurvedValuesUtm(s, e, fit.signedR)
  return {
    elementType: 1, radius: fit.signedR,
    startNode: cv.startNode, endNode: cv.endNode,
    bearing: cv.bearing, endBearing: cv.endBearing,
    length: cv.length, absLength: cv.length, speed,
    cant: cantSign(fit.signedR) * Math.abs(cant),
    geometry:     { type: 'LineString', coordinates: arcCoordsFromRadiusUtm(s, e, fit.signedR, SAGITTA_ELEMENT) ?? [wgs(s.easting, s.northing, zone), wgs(e.easting, e.northing, zone)] },
    renderCoords: arcCoordsFromRadiusUtm(s, e, fit.signedR, SAGITTA_TRACK) ?? undefined,
  }
}

// ── Whole-track optimization ─────────────────────────────────────────────────

/**
 * Optimize the curve groups of a track (straights stay on their existing
 * lines; endpoints of the track are fixed).
 *
 * params: { corridor [m], uf [mm] }
 * targetElementIdx: optional — optimize only the curve group containing this
 * element (arc or transition); all other groups keep their geometry.
 * Returns { elements, results } or { error }.
 * results: one row per optimized curve group with old/new R, u, v and the
 * used offset; groups without a feasible improvement keep their geometry.
 */
export function optimizeTrack(track, params, targetElementIdx = null) {
  const parsed = parseTrackForOptimization(track)
  if (parsed.error) return { error: parsed.error }
  const { groups, zone } = parsed
  const els = track.elements

  let targetGi = null
  if (targetElementIdx != null) {
    targetGi = groups.findIndex(g =>
      g.arcIdx === targetElementIdx || g.t1Idx === targetElementIdx || g.t2Idx === targetElementIdx)
    if (targetGi < 0) return { error: 'optimize_element_pick' }
  }

  const solutions = groups.map((g, gi) =>
    (targetGi == null || gi === targetGi) ? optimizeGroup(g, params) : null)

  // Shared straights: both neighbouring groups trim the same element. Each
  // group's exitLen/entryLen is measured against the straight's opposite end,
  // so the remaining piece is exitLen_A + entryLen_B − originalLength. If it
  // gets too short, drop the change of the group that gains less speed.
  for (let i = 0; i + 1 < groups.length; i++) {
    const gA = groups[i], gB = groups[i + 1]
    if (gA.exitIdx !== gB.entryIdx) continue
    const straight = els[gA.exitIdx]
    const fullLen = computeStraightValuesUtm(nodeUtm(straight.startNode, zone), nodeUtm(straight.endNode, zone)).length
    for (;;) {
      const a = solutions[i], b = solutions[i + 1]
      if (!a && !b) break
      const remaining = (a ? a.fit.exitLen : fullLen) + (b ? b.fit.entryLen : fullLen) - fullLen
      const need = 0.2 * Math.max(a?.v ?? 0, b?.v ?? 0)
      if (remaining >= need) break
      const gainA = a ? a.v - permissibleSpeed(gA.rAlt, gA.uAlt, groupUf(gA, params)) : -Infinity
      const gainB = b ? b.v - permissibleSpeed(gB.rAlt, gB.uAlt, groupUf(gB, params)) : -Infinity
      if (gainA <= gainB) solutions[i] = null
      else solutions[i + 1] = null
    }
  }

  // Assemble the new element chain.
  const out = []
  const results = []
  // Tangent points per straight: [fromPrevGroup, toNextGroup]
  const cuts = new Map()   // straight element index → { start: {e,n}|null, end: {e,n}|null }
  groups.forEach((g, gi) => {
    const sol = solutions[gi]
    if (!sol) return
    const entryCut = cuts.get(g.entryIdx) ?? {}
    entryCut.end = sol.fit.clStart
    cuts.set(g.entryIdx, entryCut)
    const exitCut = cuts.get(g.exitIdx) ?? {}
    exitCut.start = sol.fit.clEnd
    cuts.set(g.exitIdx, exitCut)
  })

  for (let i = 0; i < els.length; i++) {
    const el = els[i]
    if (isStraight(el)) {
      const cut = cuts.get(i)
      if (!cut) { out.push({ ...el }); continue }
      const from = cut.start ?? { e: el.startNode[0], n: el.startNode[1] }
      const to   = cut.end   ?? { e: el.endNode[0],   n: el.endNode[1] }
      out.push(straightElement(from, to, zone, { speed: el.speed, cant: el.cant }))
      continue
    }
    const gi = groups.findIndex(g => g.arcIdx === i)
    if (gi < 0) {
      // transition — emitted together with its arc below (or copied when unchanged)
      const owner = groups.find(g => g.t1Idx === i || g.t2Idx === i)
      if (!owner || !solutions[groups.indexOf(owner)]) out.push({ ...el })
      continue
    }
    const g = groups[gi]
    const sol = solutions[gi]
    if (!sol) { out.push({ ...el }); continue }
    const speed = Math.floor(sol.v)
    if (sol.l1 > 0) out.push(transitionElement(sol.fit.clStart, g.b1, sol.l1, null, sol.fit.signedR, g.type1, zone, speed))
    out.push(arcElement(sol.fit, zone, speed, sol.u))
    if (sol.l2 > 0) {
      const arcEl = out[out.length - 1]
      out.push(transitionElement({ e: arcEl.endNode[0], n: arcEl.endNode[1] }, arcEl.endBearing, sol.l2, sol.fit.signedR, null, g.type2, zone, speed))
    }
  }

  groups.forEach((g, gi) => {
    if (targetGi != null && gi !== targetGi) return
    const sol = solutions[gi]
    results.push({
      rAlt: g.rAlt, uAlt: g.uAlt,
      vAlt: permissibleSpeed(g.rAlt, g.uAlt, groupUf(g, params)),
      rNeu: sol ? sol.R : g.rAlt,
      uNeu: sol ? sol.u : g.uAlt,
      vNeu: sol ? sol.v : permissibleSpeed(g.rAlt, g.uAlt, groupUf(g, params)),
      l1: sol ? sol.l1 : null, l2: sol ? sol.l2 : null,
      offset: sol ? sol.offset : 0,
      changed: !!sol,
    })
  })

  return { elements: out, results, zone }
}
