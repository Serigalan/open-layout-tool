import { recalcAbsLengths, rebuildCoords, trackLabel } from '../trackModel'
import { resolveEndBearing, nodeUtm, endPointCurvedUtm, endPointStraightUtm } from '../elementUtils'
import { sampleTransitionUtm } from '../clothoidUtils'
import { cantSign, AUTO_CANT_MODEL } from '../rules/cant'
import { minElementLength } from '../rules/elementLength'
import { heightAt } from '../heightUtils'
import { spliceFromAnswer } from './splice'

// Reconnecting existing elements (Paket N): a stretch of one track is taken
// out and its two neighbours joined again by the splice construction, the
// best one within a tolerance of the old axis (olt_optimizer/reconnect.py).
// What is here is the app's half and pure: which elements the stretch is,
// the old axis every centimetre, the request, and the track written back.

/** Spacing of the old axis handed to the service [m] (Entscheidung 187). */
export const AXIS_SPACING = 0.01

const lengthOf = (els) => els.reduce((sum, el) => sum + (el.length ?? 0), 0)
const inSwitch = (el) => el?.switchId != null || el?.switchBranch === true

/**
 * The stretch two clicks on one track choose (Entscheidung 186): every
 * element from the one to the other, in either order — widened over a
 * transition beside it, which only leads into the curve being replaced and
 * whose curvature would leave nothing to choose — and the two neighbours the
 * splice joins: re-shaped where it may (a straight or an arc), kept as they
 * are and built on from their end where they belong to a switch (`fixed`).
 *
 * { from, to, dep: { idx, fixed }, arr: { idx, fixed }, widened } or
 * { error } with a locale key.
 */
export function reconnectRange(track, a, b) {
  const els = track?.elements ?? []
  if (!els[a] || !els[b]) return { error: 'reconnect_error_pick' }
  let from = Math.min(a, b), to = Math.max(a, b)
  const widened = []
  while (from > 0 && els[from - 1].elementType === 2 && !inSwitch(els[from - 1])) widened.push(--from)
  while (to < els.length - 1 && els[to + 1].elementType === 2 && !inSwitch(els[to + 1])) widened.push(++to)
  if (els.slice(from, to + 1).some(inSwitch)) return { error: 'reconnect_error_switch' }
  if (from === 0 || to === els.length - 1) return { error: 'reconnect_error_open_end' }
  const side = (idx) => ({ idx, fixed: inSwitch(els[idx]) || els[idx].elementType === 2 })
  return { from, to, dep: side(from - 1), arr: side(to + 1), widened: widened.sort((x, y) => x - y) }
}

/** The elements the commit replaces: the stretch and the neighbours the splice re-shapes. */
export const replacedSpan = (range) => ({
  first: range.dep.fixed ? range.from : range.dep.idx,
  last: range.arr.fixed ? range.to : range.arr.idx,
})

/**
 * A neighbour as the splice takes it (commands/splice splicePick): the one
 * before the stretch joined at its end, the one after at its start. One that
 * is kept comes as the point it ends in there (AP S.7) — no length, its
 * bearing and curvature at that end.
 */
export function reconnectPick(track, idx, joinAt, fixed) {
  const el = track.elements[idx]
  const coords = el.geometry?.coordinates ?? []
  const epsg = track.epsg
  const startUtm = nodeUtm(el.startNode, coords[0], epsg)
  const endUtm = nodeUtm(el.endNode, coords[coords.length - 1], epsg)
  const base = {
    trackId: track.id, elIdx: idx, epsg, label: trackLabel(track), joinAt,
    cant: el.cant ?? 0, speed: el.speed ?? 0,
    before: lengthOf(track.elements.slice(0, idx)), after: lengthOf(track.elements.slice(idx + 1)),
  }
  if (fixed) {
    const atEnd = joinAt === 'end'
    const curvatureR = el.elementType === 2 ? (atEnd ? el.r2 : el.r1) : el.radius
    const at = atEnd ? endUtm : startUtm
    return {
      ...base, virtual: joinAt, startUtm: at, endUtm: at, length: 0,
      bearing: atEnd ? resolveEndBearing(el, epsg) : el.bearing,
      signedR: curvatureR ?? null,
    }
  }
  return {
    ...base, startUtm, endUtm, length: el.length ?? 0,
    bearing: resolveEndBearing(el, epsg),
    signedR: el.radius != null ? el.radius : null,
  }
}

/**
 * Points along one element in equal steps of at most `step` from its start
 * — n = ⌈length / step⌉ of them, the k-th at k·length/n — its end included:
 * [[e, n], …] in the plane. Also what a reference axis is sampled from
 * (utils/referenceAxis).
 */
export function elementPoints(el, epsg, step) {
  const len = el.length ?? 0
  const coords = el.geometry?.coordinates ?? []
  const start = nodeUtm(el.startNode, coords[0], epsg)
  const n = Math.max(1, Math.ceil(len / step - 1e-9))
  if (el.elementType === 2) {
    return sampleTransitionUtm(start, el.bearing, len, el.r1 ?? null, el.r2 ?? null, el.transitionType, { steps: n })
  }
  const out = []
  for (let i = 0; i <= n; i++) {
    const s = len * i / n
    const p = el.radius != null ? endPointCurvedUtm(start, el.bearing, s, el.radius) : endPointStraightUtm(start, el.bearing, s)
    out.push([p.easting, p.northing])
  }
  return out
}

/**
 * The old axis of the elements `first`…`last` every AXIS_SPACING (each
 * element in equal steps of at most that, elementPoints), in travel order: { e0, n0, de, dn } — whole
 * millimetres from the first point, the way the service reads it — and
 * `coords` [[e, n], …] in the plane, for the map.
 */
export function axisPoints(track, first, last, step = AXIS_SPACING) {
  const coords = []
  for (let i = first; i <= last; i++) {
    const pts = elementPoints(track.elements[i], track.epsg, step)
    for (let k = coords.length ? 1 : 0; k < pts.length; k++) coords.push(pts[k])
  }
  const [e0, n0] = coords[0]
  return {
    e0, n0,
    de: coords.map(p => Math.round((p[0] - e0) * 1000)),
    dn: coords.map(p => Math.round((p[1] - n0) * 1000)),
    coords,
  }
}

/**
 * What the panel starts with (Entscheidung 192): the fastest of the elements
 * chosen as the speed, and the form of the transitions they had.
 */
export function stretchDefaults(track, range) {
  const els = track.elements.slice(range.from, range.to + 1)
  const tr = els.find(el => el.elementType === 2)
  return {
    speed: Math.max(0, ...els.map(el => el.speed ?? 0)),
    transitionType: tr?.transitionType === 'bloss' ? 'bloss' : 'clothoid',
  }
}

/**
 * The request for `POST /reconnect`: the two neighbours as picks, the old
 * axis, the tolerance [m], the design speed, the kind of transition, the
 * radius where it is kept fixed (0: searched), the app's proposal of the
 * cant and the shortest new arc (LP.EL.01 at that speed) — and where a
 * spacing to a neighbouring track is to be kept (Entscheidung 201),
 * `clearance` { ref, dMin, profile }: its axis near the stretch
 * (commands/splice neighbourAxisNear), the minimum spacing [m], the half
 * clearance outline of the project's profile.
 */
export function reconnectRequest(picks, points, { tolerance, speed, transitionType, radius }, clearance = null) {
  const pick = (p) => ({
    start: [p.startUtm.easting, p.startUtm.northing],
    end: [p.endUtm.easting, p.endUtm.northing],
    bearing: p.bearing, radius: p.signedR,
    cant: Math.abs(p.cant ?? 0), speed: p.speed ?? 0,
    length: p.length ?? 0, before: p.before ?? 0, after: p.after ?? 0,
    joinAt: p.joinAt,
  })
  return {
    dep: pick(picks[0]), arr: pick(picks[1]),
    points: { e0: points.e0, n0: points.n0, de: points.de, dn: points.dn },
    tolerance: Number(tolerance) || 0,
    speed: Number(speed) || 0,
    transition: transitionType ?? 'clothoid',
    radius: Math.abs(Number(radius) || 0),
    cantModel: AUTO_CANT_MODEL,
    lMin: minElementLength(Number(speed)) ?? 0,
    ...(clearance ? { clearance } : {}),
  }
}

/**
 * The service's answer as the panel reads it: the splice solutions
 * (commands/splice spliceFromAnswer), each with what the search says of it
 * (`reconnect`: variant, radius, cant, within, max, rms, worstAt,
 * worstStation, band) — or { error }.
 */
export function reconnectFromAnswer(answer, picks) {
  if (!answer?.solutions?.length) return { error: answer?.error ?? 'reconnect_error_no_fit' }
  const read = spliceFromAnswer(answer, picks)
  return {
    tolerance: answer.tolerance,
    solutions: read.solutions.map((sol, i) => ({ ...sol, reconnect: answer.solutions[i].reconnect })),
  }
}

/**
 * Where a station of the old track lies on the new one: the stretch from `s0`
 * that was `oldLength` long is `newLength` now, what lies in it moves in
 * proportion, what lies behind it by the difference.
 */
export const stationMap = (s0, oldLength, newLength) => (s) => {
  if (s <= s0) return s
  if (s >= s0 + oldLength) return s + newLength - oldLength
  return s0 + (s - s0) * newLength / oldLength
}

/**
 * The vertical alignment along the reconnected track (Entscheidung 191):
 * every point re-stationed by `map`, its height kept — the gradient over the
 * stretch stretched or squeezed by the few centimetres it changed. A point
 * the new length pushes past the end of the track is dropped, the end gets
 * the height the gradient had there.
 */
function restationedHeights(heights, map, length) {
  if (!heights?.length) return undefined
  const out = heights.map(p => ({ ...p, station: map(p.station) }))
  const inside = out.filter(p => p.station <= length + 1e-6)
  if (inside.length < out.length && inside.length && inside[inside.length - 1].station < length - 1e-6) {
    inside.push({ station: length, z: heightAt(out, length) })
  }
  return inside.length >= 2 ? inside : undefined
}

/**
 * The track as it is after reconnecting (Entscheidung 191): what lies before
 * the stretch, the service's chain, what lies behind it — the same id, name
 * and data. The re-shaped neighbours keep what they carried (speed, a
 * re-signed cant); what the chain inserts takes the panel's speed and an
 * inserted arc the cant the search chose for its radius. A neighbour kept
 * fixed stays itself and what is built on from it is new.
 *
 * { track, map } — `map` re-stations what lies along the old track (heights
 * are done here, platforms by the commit) — or null without a solution.
 */
export function buildReconnect({ track, range, solution, speed }) {
  const chain = solution?.result?.elements
  if (!chain?.length || solution.result.reverseDep || solution.result.reverseArr) return null
  const els = track.elements
  const { first, last } = replacedSpan(range)
  const depOrig = els[range.dep.idx], arrOrig = els[range.arr.idx]
  const cant = Math.abs(solution.reconnect?.cant ?? 0)
  const plane = ({ role: _role, speed: _speed, cant: _cant, ...el }) => el
  const keepCant = (el, orig) => (orig?.cant != null && el.radius != null
    ? { cant: cantSign(el.radius) * Math.abs(orig.cant) } : {})
  const builtOn = (el, orig) => ({
    ...plane(el), speed: orig.speed,
    ...(el.elementType === 1 ? { cant: cantSign(el.radius) * Math.abs(orig.cant ?? 0) } : {}),
  })
  // The neighbours' own marks and data stay on what is left of them; a
  // switch's mark never travels to what is built on from it.
  const own = ({ switchId: _a, switchBranch: _b, switchRoute: _c, switchName: _d, switchLabel: _e, ...el }) => el
  const mid = chain.map(el => {
    if (el.role === 'dep') return range.dep.fixed ? builtOn(el, depOrig) : { ...own(depOrig), ...plane(el), ...keepCant(el, depOrig) }
    if (el.role === 'arr') return range.arr.fixed ? builtOn(el, arrOrig) : { ...own(arrOrig), ...plane(el), ...keepCant(el, arrOrig) }
    const inserted = { ...plane(el), speed: Number(speed) || 0 }
    return el.elementType === 1 ? { ...inserted, cant: cantSign(el.radius) * cant } : inserted
  })
  const elements = recalcAbsLengths([...els.slice(0, first).map(el => ({ ...el })), ...mid, ...els.slice(last + 1).map(el => ({ ...el }))])
  const s0 = lengthOf(els.slice(0, first))
  const map = stationMap(s0, lengthOf(els.slice(first, last + 1)), lengthOf(mid))
  const length = lengthOf(elements)
  const { heights: oldHeights, ...meta } = track
  const heights = restationedHeights(oldHeights, map, length)
  return {
    track: { ...meta, elements, coordinates: rebuildCoords(elements), ...(heights ? { heights } : {}) },
    map,
  }
}
