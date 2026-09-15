import {
  nodeUtm, endPointStraightUtm, endPointCurvedUtm, bearingAfterUtm,
} from './elementUtils'
import { sampleTransitionUtm, transitionBearingAtUtm } from './clothoidUtils'
import { elementAtStation, pointAtStationUtm, trackLength } from './heightUtils'
import {
  lcsLineUtm, switchFillRing, switchRoutePointsUtm, switchRoutesFromTracks,
  switchChainPointUtm, switchChainBearingAt, switchChainBauform,
} from './switchUtils'
import { switchNumberOf } from './identifierUtils'

/**
 * Everything a plan needs to draw, in the track's own projected plane — paths,
 * main points, station marks and switch symbols. The display geometry
 * (`geometry`, `renderCoords`) is deliberately not used: it is WGS84 at the
 * map's resolution, and a plan wants the design values at drawing resolution.
 *
 * A path is a list of commands on plane coordinates, mirroring the SVG subset
 * both plan backends can draw:
 *   ['M', e, n]                            move
 *   ['L', e, n]                            line
 *   ['C', c1e, c1n, c2e, c2n, e, n]        cubic Bézier
 *   ['Z']                                  close
 */

/** Largest sweep one cubic Bézier approximates; the error grows with θ⁶. */
const MAX_BEZIER_ANGLE = Math.PI / 6      // 30°
/** Vertex spacing of a transition curve [m]; its curvature has no closed form. */
const TRANSITION_STEP = 1
/** Below this a drawn end point is the stored node, not a different place [m]. */
const JOIN_TOL = 1e-3

export const isTransition = (el) => el.elementType === 2
export const isArc        = (el) => el.radius != null

/** Unit vector of a compass bearing in the plane: [east, north]. */
function dirOf(bearing) {
  const rad = bearing * Math.PI / 180
  return [Math.sin(rad), Math.cos(rad)]
}

/** Tangent bearing of an element at station `s` along it. */
export function tangentAt(el, s) {
  if (isTransition(el) && el.r1 !== undefined) {
    return transitionBearingAtUtm(el.bearing, el.length, el.r1, el.r2 ?? null, el.transitionType, s)
  }
  if (isArc(el)) return bearingAfterUtm(el.bearing, s, el.radius)
  return el.bearing
}

/**
 * Arc as cubic Béziers of at most MAX_BEZIER_ANGLE each. Every segment meets
 * the arc at its ends with the right tangent; the control arm
 * k = 4/3·tan(θ/4)·R makes the middle fit too, to within 4·10⁻⁷·R at 30°.
 * The page transform is affine, so control points may be transformed like
 * ordinary points.
 */
function arcCommands(startUtm, bearing, length, signedR) {
  const absR = Math.abs(signedR)
  const total = length / absR
  const n = Math.max(1, Math.ceil(total / MAX_BEZIER_ANGLE))
  const k = 4 / 3 * Math.tan(total / n / 4) * absR
  const cmds = []
  let from = startUtm
  let fromBearing = bearing
  for (let i = 1; i <= n; i++) {
    const s = length * i / n
    const to = endPointCurvedUtm(startUtm, bearing, s, signedR)
    const toBearing = bearingAfterUtm(bearing, s, signedR)
    const [fe, fn] = dirOf(fromBearing)
    const [te, tn] = dirOf(toBearing)
    cmds.push(['C',
      from.easting + k * fe, from.northing + k * fn,
      to.easting   - k * te, to.northing   - k * tn,
      to.easting,            to.northing])
    from = to
    fromBearing = toBearing
  }
  return cmds
}

/** Transition as a vertex chain — the same integrator the geometry is built on. */
function transitionCommands(startUtm, el) {
  const steps = Math.max(2, Math.ceil(el.length / TRANSITION_STEP))
  const pts = sampleTransitionUtm(startUtm, el.bearing, el.length,
    el.r1 ?? null, el.r2 ?? null, el.transitionType, { steps })
  return pts.slice(1).map(([e, n]) => ['L', e, n])
}

/**
 * One element as a path, without the leading move: `{ start, cmds }`.
 * The last vertex is snapped to the stored end node when the two agree to
 * within JOIN_TOL, so a drawn chain joins exactly where the data says it does.
 */
export function elementPathUtm(el, epsg) {
  const coords = el.geometry?.coordinates ?? []
  const start = nodeUtm(el.startNode, coords[0], epsg)

  let cmds
  if (isTransition(el) && el.r1 !== undefined) cmds = transitionCommands(start, el)
  else if (isArc(el))                          cmds = arcCommands(start, el.bearing, el.length, el.radius)
  else {
    const end = endPointStraightUtm(start, el.bearing, el.length)
    cmds = [['L', end.easting, end.northing]]
  }

  const last = cmds[cmds.length - 1]
  if (el.endNode && last) {
    const [e, n] = [last[last.length - 2], last[last.length - 1]]
    if (Math.hypot(el.endNode[0] - e, el.endNode[1] - n) < JOIN_TOL) {
      last[last.length - 2] = el.endNode[0]
      last[last.length - 1] = el.endNode[1]
    }
  }
  return { start: [start.easting, start.northing], cmds }
}

/** A whole track as one path; a gap between elements starts a new subpath. */
export function trackPathUtm(track) {
  const out = []
  let cursor = null
  for (const el of track.elements ?? []) {
    if (!(el.length > 0)) continue
    const { start, cmds } = elementPathUtm(el, track.epsg)
    if (!cursor || Math.hypot(cursor[0] - start[0], cursor[1] - start[1]) > JOIN_TOL) {
      out.push(['M', start[0], start[1]])
    }
    out.push(...cmds)
    const last = cmds[cmds.length - 1]
    cursor = [last[last.length - 2], last[last.length - 1]]
  }
  return out
}

/**
 * Curvature at the two ends of an element, signed. An arc keeps its radius
 * throughout; a transition has one at each end, and where that end runs into a
 * straight the other end stands in — it names the side the curve bends towards,
 * which is the side the centre of curvature lies on. A straight has none.
 */
function startCurvature(el) {
  if (isArc(el)) return el.radius
  if (isTransition(el)) return el.r1 ?? el.r2 ?? null
  return null
}

function endCurvature(el) {
  if (isArc(el)) return el.radius
  if (isTransition(el)) return el.r2 ?? el.r1 ?? null
  return null
}

/**
 * Main points of a track: the element boundaries, named by the element that
 * governs the point. An arc dominates — where it begins the point is BA, where
 * it ends BE — and a transition names the rest: UA where one begins, UE where
 * one ends. Two straights meeting carry no main point; the track's own ends are
 * TA and TE unless an element names them.
 *
 * Each point carries the signed curvature of the alignment there, taken from
 * whichever neighbour is curved — an arc running out into a straight has its
 * centre at its end just as much as at its start — so a drawing can show which
 * side that centre lies on. Null only where both sides are straight.
 */
export function mainPoints(track) {
  const els = (track.elements ?? []).filter(el => el.length > 0)
  if (!els.length) return []

  const codeAt = (prev, next) => {
    if (next && isArc(next))        return 'BA'
    if (prev && isArc(prev))        return 'BE'
    if (next && isTransition(next)) return 'UA'
    if (prev && isTransition(prev)) return 'UE'
    return null
  }

  const pts = []
  let station = 0
  els.forEach((el, i) => {
    const code = i === 0 ? (codeAt(null, el) ?? 'TA') : codeAt(els[i - 1], el)
    if (code) {
      const p = nodeUtm(el.startNode, el.geometry?.coordinates?.[0], track.epsg)
      pts.push({
        code, station, point: [p.easting, p.northing], bearing: el.bearing,
        signedR: startCurvature(el) ?? (i > 0 ? endCurvature(els[i - 1]) : null),
      })
    }
    station += el.length
  })

  const last = els[els.length - 1]
  const end = pointAtStationUtm(last, last.length, track.epsg)
  pts.push({
    code: codeAt(last, null) ?? 'TE',
    station,
    point: [end.easting, end.northing],
    bearing: last.endBearing ?? last.bearing,
    signedR: endCurvature(last),
  })
  return pts
}

/** Plane point and tangent bearing at a station measured along a whole track. */
export function trackPointAt(track, station) {
  const hit = elementAtStation(track.elements, station)
  if (!hit) return null
  const p = pointAtStationUtm(hit.el, hit.s, track.epsg)
  return { point: [p.easting, p.northing], bearing: tangentAt(hit.el, hit.s) }
}

/**
 * Symbol of a switch in the plane — the body between the through route and the
 * branch, plus the LCS mark. The plane twin of `rebuildSwitchSymbol`, from the
 * same routes (switchRoutesFromTracks): the branch's elements carry the node and
 * the tangent, the marked elements at port B2 the through route over as many
 * elements as the turnout covers, and the switch form named by `label` gives
 * the through length, so the symbol keeps the turnout's own dimensions whatever
 * the tracks do later. The bauform comes with it (switchChainBauform).
 * Returns null for a switch whose branch or form cannot be resolved.
 */
export function switchSymbolUtm(sw, trackById) {
  const routes = switchRoutesFromTracks(sw, trackById)
  if (!routes) return null
  const { type, node, bearing, mainLen, stem, branch } = routes

  const mainPts   = switchRoutePointsUtm(node, bearing, stem)
  const branchPts = switchRoutePointsUtm(node, bearing, branch)
  const mainEnd = mainPts[mainPts.length - 1]

  // Half way along the through route, with its tangent — the body reaches from
  // the toe to the frog, so its name belongs over the middle of that.
  const midS = mainLen / 2
  const mid = switchChainPointUtm(node, bearing, stem, midS)
  // The branch's radius at the toe — or, where it leaves straight, the one it
  // bends into.
  const branchR = branch[0].r1 ?? branch[0].r2

  return {
    node: [node.easting, node.northing],
    bearing,
    number: switchNumberOf(sw),
    // Where the toe sits along the branch track — the start of it, unless the
    // switch hangs on that track's far end.
    station: sw.portB1_endpoint === 'END' ? trackLength(trackById[sw.portB1_trackId]) : 0,
    mid: [mid.easting, mid.northing],
    midBearing: switchChainBearingAt(bearing, stem, midS),
    // Which way the branch leaves: its body lies on that side, so a label has
    // to go to the other one, and the branch arc's centre is on it as well.
    branchTurn: branchR ? Math.sign(branchR) : 0,
    fill: switchFillRing(mainPts, branchPts),
    lcs: type ? lcsLineUtm([node.easting, node.northing], routes.branchEnd, mainEnd, type.dLcs) : null,
    label: sw.label ?? null,
    bauform: switchChainBauform(stem, branch),
  }
}
