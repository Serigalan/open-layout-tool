import { wgs84ToUTM, utmToWgs84 } from '../coordinateUtils'
import { reverseElement, projectOnArcUtm } from '../elementUtils'
import { projectOnTransitionUtm } from '../clothoidUtils'
import { elementBelongsToSwitch, isLinkSwitch } from '../switchModel'
import { linkSymbol } from '../trackLinkUtils'
import {
  SWITCH_CHAIN_TOL, chainGeometry, clothoidRoutePoints, negR, switchBranchChain,
  switchChainBauform, switchChainBearingAt, switchChainPointUtm, switchChainSegmentsUtm,
  switchChainTo, switchElementRoute, switchRouteBearingAt, switchRouteSegments, switchRouteVaries,
  switchStemRoute, toChain, toRoute, utmEndRoute,
} from './route'
import { switchBranchLength, switchFormChain, switchStraightLength, switchTypeByLabel } from './catalogue'
import { crossingEndDistance, crossingWedgeRing } from './crossing'

// The drawn switch: route coordinates, the body ring, the LCS line, the label, and the symbol rebuilt from its tracks.

/**
 * How far from the turnout its designation stands [m], measured from the centre
 * of area of the body (fillCoords) — the one point that is the middle of the
 * whole turnout however its two routes run, so the same number means the same
 * gap for a 1:7 and a 1:26.5. The two routes' radii are written on the elements
 * themselves, as every other element's values are.
 */
const SWITCH_LABEL_OFFSET = 2

/**
 * Polyline (WGS84) running parallel to a switch route at `offset` metres, left
 * of the running direction for a positive offset.
 */
function routeOffsetCoords(originUtm, bearing, route, offset, epsg) {
  const n = switchRouteSegments(route.length, route.r1, route.r2)
  const pts = switchRouteVaries(route) ? clothoidRoutePoints(originUtm, bearing, route) : null
  const coords = []
  for (let i = 0; i <= n; i++) {
    const s = route.length * i / n
    const p = pts
      ? { easting: pts[i][0], northing: pts[i][1] }
      : utmEndRoute(originUtm, bearing, s, route.r1)
    const b = switchRouteBearingAt(bearing, route, s) * Math.PI / 180
    coords.push(utmToWgs84(p.easting - offset * Math.cos(b), p.northing + offset * Math.sin(b), epsg))
  }
  return coords
}

/** The same along a chain, piece by piece. */
function chainOffsetCoords(originUtm, bearing, chain, offset, epsg) {
  return switchChainSegmentsUtm(originUtm, bearing, chain).flatMap((seg, i) => {
    const c = routeOffsetCoords(seg.startUtm, seg.bearing, seg, offset, epsg)
    return i === 0 ? c : c.slice(1)
  })
}

/** Plane points of one route piece, stepped like everything else here. */
function routePointsPlane(originUtm, bearing, route) {
  if (switchRouteVaries(route)) return clothoidRoutePoints(originUtm, bearing, route)
  const n = switchRouteSegments(route.length, route.r1)
  const pts = []
  for (let i = 0; i <= n; i++) {
    const p = utmEndRoute(originUtm, bearing, route.length * i / n, route.r1)
    pts.push([p.easting, p.northing])
  }
  return pts
}

/**
 * Points ([E, N]) of a switch route — one piece or a chain — in the plane,
 * stepped like everything else here: map symbol and plan export draw a turnout
 * from the same points.
 */
export function switchRoutePointsUtm(originUtm, bearing, route) {
  if (!Array.isArray(route)) return routePointsPlane(originUtm, bearing, route)
  return switchChainSegmentsUtm(originUtm, bearing, route).flatMap((seg, i) => {
    const pts = routePointsPlane(seg.startUtm, seg.bearing, seg)
    return i === 0 ? pts : pts.slice(1)
  })
}

/** Offset of a point from one route piece (see projectOnArcUtm for the frame). */
function projectOnPiece(startUtm, bearing, piece, pointUtm) {
  return switchRouteVaries(piece)
    ? projectOnTransitionUtm(startUtm, pointUtm, bearing, piece.length, piece.r1, piece.r2)
    : projectOnArcUtm(startUtm, pointUtm, bearing, piece.r1)
}

/**
 * Offset (`perp`, positive to the right) of a point beside a chain, read off the
 * piece it lies beside: the one its foot falls within, the nearest where none.
 */
function projectOnChainUtm(originUtm, bearing, chain, pointUtm) {
  let best = null
  for (const seg of switchChainSegmentsUtm(originUtm, bearing, chain)) {
    const { along, perp } = projectOnPiece(seg.startUtm, seg.bearing, seg, pointUtm)
    const miss = along < 0 ? -along : Math.max(0, along - seg.length)
    if (!best || miss < best.miss || (miss === best.miss && Math.abs(perp) < Math.abs(best.perp))) {
      best = { miss, perp }
    }
  }
  return best
}

/**
 * Centre of area of a closed ring of plane points. A ring that encloses nothing
 * — a turnout drawn with a zero-length route — falls back on its vertex mean,
 * which for that shape is the same place.
 *
 * Summed relative to the ring's first point, which is not a nicety: a turnout's
 * body covers some 25 m² and the shoelace terms over absolute eastings and
 * northings run to 1e12, so summing those directly loses the very metres the
 * centre is wanted to. Shifted to the toe the terms stay the size of the body.
 */
function ringCentroid(ring) {
  const [ox, oy] = ring[0]
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] - ox,     y1 = ring[i][1] - oy
    const x2 = ring[i + 1][0] - ox, y2 = ring[i + 1][1] - oy
    const f = x1 * y2 - x2 * y1
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
  }
  if (Math.abs(a) < 1e-9) {
    return [ring.reduce((s, p) => s + p[0], 0) / ring.length,
      ring.reduce((s, p) => s + p[1], 0) / ring.length]
  }
  return [ox + cx / (3 * a), oy + cy / (3 * a)]
}

/**
 * What a turnout's lettering needs from its geometry:
 *
 * `labelCoords` — the path (WGS84) its designation is written along: the through
 * route, shifted until it stands SWITCH_LABEL_OFFSET from the body's centre of
 * area, on the side facing away from that centre.
 *
 * `bodyCentre` — that centre itself (WGS84). The two routes' radii are written
 * along the elements they belong to, and a label hangs to one side of its line;
 * on one of the two routes that side is the one the body fills. Handed this
 * point, the label renderer puts the text under its line instead of over it
 * wherever the body would be behind it, which is the only thing that decides
 * per turnout — the routes' own directions do not, since either element may
 * have been stored running the other way.
 *
 * Both routes are given as they run from the toe, so which way is "away" comes
 * out of the geometry rather than out of the direction an element was stored in.
 * Each is a chain, a route ({ length, r1, r2 }) or, for a constant one,
 * { length, radius }.
 */
export function switchLabelGeometry(toeUtm, bearing, throughRoute, branchRoute, epsg) {
  const through = toChain(throughRoute)
  const branch  = toChain(branchRoute)
  const centre = ringCentroid(switchFillRing(
    switchRoutePointsUtm(toeUtm, bearing, through),
    switchRoutePointsUtm(toeUtm, bearing, branch)))
  const centreUtm = { easting: centre[0], northing: centre[1], zone: epsg }

  // Where the centre sits beside a route (positive to the left of the running
  // direction), and from that the offset a label needs to stand `d` from it on
  // the route's far side.
  const away = (chain, d) => {
    const { perp } = projectOnChainUtm(toeUtm, bearing, chain, centreUtm)
    const c = -perp
    return c - Math.sign(c || 1) * d
  }
  return {
    labelCoords: chainOffsetCoords(toeUtm, bearing, through,
      away(through, SWITCH_LABEL_OFFSET), epsg),
    bodyCentre: utmToWgs84(centre[0], centre[1], epsg),
  }
}

/**
 * The body of a switch as a closed ring: from the toe along the through route
 * to its end, across to the branch end and back along the branch to the toe.
 * Both polylines are passed as they run *from the toe*, so the ring closes on
 * itself — the reversed branch ends where the through route began — and the
 * branch side keeps its curvature instead of being cut off as a chord.
 *
 * Every switch symbol in the app is assembled here: the four dialogs that
 * create one, the OSRD import, the reload that rebuilds it from the tracks and
 * the plan export's plane twin. That is what makes a turnout look the same
 * whichever of them produced it. Points may be WGS84 or plane pairs; the ring
 * only ever reorders what it is given.
 */
export function switchFillRing(throughFromToe, branchFromToe) {
  return [...throughFromToe, ...[...branchFromToe].reverse()]
}

/**
 * LCS marker line of a switch in the plane: a 4.6 m line parallel to B1–B2,
 * offset `dLcs` to the side facing away from A. Ports are [easting, northing];
 * the result is a pair of such points.
 */
export function lcsLineUtm(portA, portB1, portB2, dLcs) {
  const [b1e, b1n] = portB1
  const [b2e, b2n] = portB2
  const [ae,  an ] = portA
  const dxB = b2e - b1e, dyB = b2n - b1n
  const lenB = Math.hypot(dxB, dyB)
  if (!(lenB > 0) || !(dLcs >= 0)) return null
  const dirE = dxB / lenB, dirN = dyB / lenB
  const perpE = -dirN, perpN = dirE          // 90° CCW rotation
  const mE = (b1e + b2e) / 2, mN = (b1n + b2n) / 2
  const awayDot = perpE * (mE - ae) + perpN * (mN - an)
  const sE = awayDot >= 0 ? perpE : -perpE   // signed perp away from A
  const sN = awayDot >= 0 ? perpN : -perpN
  const ctrE = mE + dLcs * sE, ctrN = mN + dLcs * sN
  const half = 4.6 / 2
  return [
    [ctrE - half * dirE, ctrN - half * dirN],
    [ctrE + half * dirE, ctrN + half * dirN],
  ]
}

/** The same marker as WGS84, for the map display. */
export function lcsLine(portA, portB1, portB2, dLcs, zone) {
  const line = lcsLineUtm(portA, portB1, portB2, dLcs)
  return line && line.map(([e, n]) => utmToWgs84(e, n, zone))
}

/**
 * The elements a route of a switch lies on, oriented away from its node: from
 * the end of the port's track that meets the switch, as long as they are marked
 * as that route of that switch and until they make up `length` (without one,
 * just the first). `first` takes the element at the port whatever its marks —
 * a branch track begins with its branch however old the record is.
 */
function routeElements(sw, trackById, port, route, length, { first = false } = {}) {
  const track    = trackById[sw[`port${port}_trackId`]]
  const endpoint = sw[`port${port}_endpoint`]
  const els      = track?.elements ?? []
  if (!els.length || (endpoint !== 'BEGIN' && endpoint !== 'END')) return []
  const ordered = endpoint === 'END' ? [...els].reverse() : els
  const out = []
  let total = 0
  for (const el of ordered) {
    if (length == null ? out.length > 0 : total >= length - SWITCH_CHAIN_TOL) break
    const mine = el.switchBranch
      && (!el.switchRoute || el.switchRoute === route)
      && elementBelongsToSwitch(el, sw)
    if (!mine && !(first && out.length === 0)) break
    if (!(el.length > 0)) break
    out.push(endpoint === 'END' ? reverseElement(el) : el)
    total += el.length
  }
  return out
}

/**
 * The routes of a crossing kind as its tracks state them: each leg read from
 * the port it ends at — `main` from the elements at C, `cross` from the ones at
 * D, and the two legs behind the crossing point from A and B — each as a chain
 * running away from the crossing point, over as many elements as the form's
 * half-length reaches. The crossing point is the middle of both routes: the
 * first elements' start nodes coincide there.
 *
 * A record whose tracks carry no leg behind the point gets it mirrored: the
 * leg ahead run on backwards through the point, which on a straight is the
 * same straight and on an arc the same arc — the leg a crossing built by the
 * app has there anyway. An imported one has the surveyed leg, and that is
 * what its body is drawn along.
 *
 * Returns { type, epsg, centre, mainBearing, crossBearing, main, cross,
 * mainBackBearing, crossBackBearing, mainBack, crossBack } — the four chains,
 * each running from the crossing point out to its port, with the bearing each
 * leaves the point on — or null where either route or the form cannot be
 * resolved.
 */
export function crossingRoutesFromTracks(sw, trackById) {
  const type = switchTypeByLabel(sw.label)
  // A crossing form is one that says how far its ends lie from the crossing
  // point: a plain one through its tangent, a Bogenkreuzungsweiche through the
  // length of its legs, any other crossing switch through the radius of its
  // connecting curves.
  const half = type ? crossingEndDistance(type) : NaN
  if (!(half > 0)) return null

  const mainEls  = routeElements(sw, trackById, 'C', 'main', half)
  const crossEls = routeElements(sw, trackById, 'D', 'cross', half)
  const mainFirst = mainEls[0], crossFirst = crossEls[0]
  if (!mainFirst || !crossFirst || !mainFirst.startNode || !crossFirst.startNode) return null
  // Both legs begin at the crossing point; a record whose tracks disagree
  // there by more than a joint is not one the geometry can be read back from.
  const epsg = trackById[sw.portC_trackId]?.epsg
  if (epsg == null) return null
  if (Math.hypot(mainFirst.startNode[0] - crossFirst.startNode[0],
    mainFirst.startNode[1] - crossFirst.startNode[1]) > SWITCH_CHAIN_TOL) return null

  const centre = { easting: mainFirst.startNode[0], northing: mainFirst.startNode[1], zone: epsg }
  const main  = switchChainTo(mainEls.map(switchElementRoute), half)
  const cross = switchChainTo(crossEls.map(switchElementRoute), half)
  const behind = (port, route, ahead, aheadBearing) => {
    const els = routeElements(sw, trackById, port, route, half)
    const first = els[0]
    if (first?.startNode && Math.hypot(first.startNode[0] - centre.easting,
      first.startNode[1] - centre.northing) <= SWITCH_CHAIN_TOL) {
      return { bearing: first.bearing, chain: switchChainTo(els.map(switchElementRoute), half) }
    }
    return {
      bearing: (aheadBearing + 180) % 360,
      chain: ahead.map(piece => ({ length: piece.length, r1: negR(piece.r1), r2: negR(piece.r2) })),
    }
  }
  const mainBack  = behind('A', 'main', main, mainFirst.bearing)
  const crossBack = behind('B', 'cross', cross, crossFirst.bearing)

  return {
    type, epsg, centre,
    mainBearing: mainFirst.bearing,
    crossBearing: crossFirst.bearing,
    main, cross,
    mainBackBearing: mainBack.bearing,
    crossBackBearing: crossBack.bearing,
    mainBack: mainBack.chain,
    crossBack: crossBack.chain,
  }
}

/**
 * The body of a crossing kind in the plane, from its legs as the tracks state
 * them (crossingRoutesFromTracks): the two wedges between the legs at the acute
 * crossing angle, each out along both legs to the two ends on a side and
 * closed across them — the same pair of rings the commit stores, with sides
 * that follow a curved leg. The map and the plan sheet both draw it from here.
 */
export function crossingBodyUtm(routes) {
  const { centre } = routes
  const along = (bearing, chain) => switchRoutePointsUtm(centre, bearing, chain)
  return [
    crossingWedgeRing(along(routes.mainBackBearing, routes.mainBack),
      along(routes.crossBackBearing, routes.crossBack)),
    crossingWedgeRing(along(routes.mainBearing, routes.main),
      along(routes.crossBearing, routes.cross)),
  ]
}

/**
 * The two routes of a switch as its tracks state them, both as chains running
 * from the toe: the branch from the elements at port B1, the through route from
 * the marked elements at port B2 — the stem the turnout lies on, over as many
 * elements as it reaches across. A record whose tracks carry no such marks (an
 * import, or one from before the through route was marked) falls back on its
 * stem radii (switchStemRoute). The switch form named by `label` gives the
 * through length, so the symbol keeps the turnout's own dimensions whatever the
 * tracks do later; a record whose label no longer resolves falls back on the
 * branch's own tangent length.
 *
 * Returns { type, epsg, node, bearing, mainLen, stem, branch, branchEnd,
 * branchStartWgs, branchEndWgs } — node and bearing of the toe, branchEnd the
 * branch's far node [E, N] — or null where the branch or the form cannot be
 * resolved.
 */
export function switchRoutesFromTracks(sw, trackById) {
  const branchTrack = trackById[sw.portB1_trackId]
  const type = switchTypeByLabel(sw.label)
  const branchEls = routeElements(sw, trackById, 'B1', 'branch',
    type ? switchBranchLength(type) : null, { first: true })
  const first = branchEls[0]
  if (!first || !(first.length > 0) || !first.startNode || !first.endNode) return null
  const last = branchEls[branchEls.length - 1]
  if (!last.endNode) return null

  const epsg = branchTrack.epsg
  // Through route length: the form's, so a bent switch (whose branch element
  // carries the *combined* radius) still gets its own dimension.
  const absR    = Math.abs(first.radius ?? 0)
  const mainLen = type ? switchStraightLength(type)
    : absR > 0 ? 2 * absR * Math.tan(first.length / (2 * absR))
      : null
  if (mainLen == null) return null

  const node    = { easting: first.startNode[0], northing: first.startNode[1], zone: epsg }
  const stemEls = routeElements(sw, trackById, 'B2', 'main', mainLen)
  const onNode  = stemEls.length > 0 && Array.isArray(stemEls[0].startNode)
    && Math.hypot(stemEls[0].startNode[0] - node.easting, stemEls[0].startNode[1] - node.northing)
      <= SWITCH_CHAIN_TOL
  const firstCoords = first.geometry?.coordinates ?? []
  const lastCoords  = last.geometry?.coordinates ?? []
  return {
    type, epsg, node, bearing: first.bearing, mainLen,
    stem: onNode
      ? switchChainTo(stemEls.map(switchElementRoute), mainLen)
      : [switchStemRoute(sw, mainLen)],
    branch: branchEls.map(switchElementRoute),
    branchEnd: last.endNode,
    branchStartWgs: firstCoords.length >= 2 ? firstCoords[0] : null,
    branchEndWgs:   lastCoords.length >= 2 ? lastCoords[lastCoords.length - 1] : null,
  }
}

/**
 * Display symbol of a switch — the body between the branch and the through
 * route (fillCoords) and the LCS mark (lcsCoords), both WGS84 — rebuilt from
 * the tracks it joins (see switchRoutesFromTracks). The record itself keeps
 * only name, label, trailing, speed and the ports, so the symbol can never
 * disagree with the tracks. Returns the record with the symbol set — or without
 * one when the branch is missing.
 *
 * A crossing kind is rebuilt from its own two routes (crossingRoutesFromTracks):
 * the body is the pair of wedges between their four legs (crossingBodyUtm),
 * and the label runs along the main leg, offset past the body's centre of area
 * the way a turnout's is.
 */
export function rebuildSwitchSymbol(sw, trackById) {
  const {
    fillCoords: _f, lcsCoords: _l, labelCoords: _lc, bodyCentre: _bc, bauform: _b, ...rest
  } = sw
  // A link has no routes to read a body off — it is a node. Its symbol stands
  // on the node itself (trackLinkUtils.linkSymbol).
  if (isLinkSwitch(sw)) return linkSymbol(rest, trackById)
  if (sw.kind && sw.kind !== 'turnout') {
    const routes = crossingRoutesFromTracks(sw, trackById)
    if (!routes) return rest
    const { epsg, centre, mainBearing, main } = routes
    // The body is the two wedges between the legs at the acute crossing angle,
    // out along all four legs as the tracks carry them — the same pair of rings
    // the commit stores. The obtuse wedges carry no body.
    const fillCoords = crossingBodyUtm(routes)
      .map(ring => ring.map(([e, n]) => utmToWgs84(e, n, epsg)))
    // Between straight legs the wedges lie point-symmetric about the crossing
    // point, so their combined centre of area is the point itself; a
    // Bogenkreuzungsweiche's are mirror images through it, which keeps that
    // centre near enough to the point for a label two metres off.
    const centreUtm = { easting: centre.easting, northing: centre.northing, zone: epsg }
    // The label stands beside the main leg, on the side facing away from the
    // body — the same rule a turnout's designation follows.
    const { perp } = projectOnChainUtm(centre, mainBearing, main, centreUtm)
    const c = -perp
    const offset = c - Math.sign(c || 1) * SWITCH_LABEL_OFFSET
    return {
      ...rest,
      fillCoords,
      labelCoords: chainOffsetCoords(centre, mainBearing, main, offset, epsg),
      bodyCentre: utmToWgs84(centre.easting, centre.northing, epsg),
    }
  }
  const routes = switchRoutesFromTracks(sw, trackById)
  if (!routes || !routes.branchStartWgs || !routes.branchEndWgs) return rest

  const { type, epsg, node, bearing, stem, branch } = routes
  const mainEndUtm = switchChainPointUtm(node, bearing, stem)
  const mainEndWgs = utmToWgs84(mainEndUtm.easting, mainEndUtm.northing, epsg)
  const mainCoords = chainGeometry(node, routes.branchStartWgs, bearing, stem, mainEndWgs).coords
  // The branch is drawn from the elements' own node, bearing, length and radii
  // rather than from their stored polylines: same curve, same source of truth,
  // but stepped like every other switch route — a branch saved at some other
  // density would otherwise give the symbol a different outline after a reload.
  const branchCoords = chainGeometry(node, routes.branchStartWgs, bearing, branch, routes.branchEndWgs).coords
  const lcsCoords = type
    ? lcsLine([node.easting, node.northing], routes.branchEnd,
      [mainEndUtm.easting, mainEndUtm.northing], type.dLcs, epsg)
    : null
  return {
    ...rest,
    fillCoords: switchFillRing(mainCoords, branchCoords),
    ...switchLabelGeometry(node, bearing, stem, branch, epsg),
    bauform: switchChainBauform(stem, branch, type?.symmetric === true),
    ...(lcsCoords ? { lcsCoords } : {}),
  }
}

/**
 * Compute all geometry for a switch from an element's end point (WGS84).
 * All intermediate calculations in UTM.
 *
 * Facing:   startWgs = portA;  through → portB2;  branch → portB1
 * Trailing: startWgs = portB2; through → portA;   branch departs portA with (bearing+180°) → portB1
 *
 * crs: plane in which bearing/lengths are defined (the element's epsg);
 * without it the zone is auto-detected — wrong for GK-native tracks.
 */
export function computeSwitchGeometry(startWgs, bearing, sw, side, trailing, crs = null, mainR = null) {
  return computeSwitchGeometryUtm(wgs84ToUTM(startWgs, crs), bearing, sw, side, trailing, startWgs, mainR)
}

/**
 * The same from a start point already in the track's plane ({ easting,
 * northing, zone }). A caller holding the point in the plane uses this so it is
 * not sent through WGS84 and back — for the GK/DB_REF datum shift that round
 * trip is not exact (~0.6 mm). `startWgs` is the WGS84 twin of the start for
 * the drawn coordinates; it is derived from the plane point when not given.
 * The ports and the element ends come back in the plane too (portA/B1/B2 as
 * [E, N]; startUtm, straightUtm, arcOriginUtm, curvedUtm), so the caller's own
 * elements can be built there. `fillCoords` is the finished symbol (see
 * switchFillRing) — callers store and preview that rather than assembling one,
 * so a turnout looks the same whichever dialog made it.
 *
 * `mainR` bends the switch: the stem radius, signed in the `bearing` direction
 * (positive = right-hand curve), null for the ordinary switch on a straight.
 * The through route then runs the form's through length as an arc on that
 * radius, and the branch takes the sum of both curvatures (see branchRadius) —
 * so `signedR` comes back null for the outer-bent switch whose branch is
 * straight. `mainSignedR` and `stemAtToe` are that stem radius in the two
 * frames a caller builds elements in: along `bearing`, and away from the toe.
 *
 * Given as { r1, r2 } instead, `mainR` lays the switch into a clothoid: r1 is
 * the stem radius at the start, r2 the one at the far end of the through route,
 * both along `bearing`. Given as a list of such pieces with their lengths, it
 * lays the switch across the elements of a track — one piece each, in the order
 * they run along `bearing`, taken to the form's through length.
 *
 * `stemChain` and `branchChain` are both routes as chains running from the toe,
 * the branch parting where the stem does; `stemSegments` and `branchSegments`
 * are their pieces placed in the plane (switchChainSegmentsUtm), the branch's
 * with their own polylines, one per element a caller builds.
 * `branchEndBearing` is the branch's tangent at its end.
 */
export function computeSwitchGeometryUtm(startUtm, bearing, sw, side, trailing, startWgs = null, mainR = null) {
  const arcLen      = switchBranchLength(sw)
  const straightLen = switchStraightLength(sw)
  // A symmetrical turnout has no side that runs on: unbent, its through route is
  // the branch's mirror image, the form's arc to the other side. The branch is
  // laid onto that through route like any branch onto its stem, so what it
  // adds to it is twice the form's curvature — the curvature it has to turn
  // back through and the one it turns on — and the two routes still part at
  // the full angle, each through half of it.
  const symmetric = sw.symmetric === true
  const formChain = symmetric
    ? switchFormChain(sw, side).map(section => ({ ...section, signedR: section.signedR / 2 }))
    : switchFormChain(sw, side)
  // Stated along `bearing`: a trailing turnout's through route runs towards the
  // toe, and run that way the mirror arc bends to the branch's own side.
  const formSignedR = switchFormChain(sw, side)[0].signedR
  const unbent = symmetric ? (trailing ? formSignedR : -formSignedR) : null
  // The through route along `bearing`: straight — or for the symmetrical
  // turnout the mirror arc — an arc, a piece of clothoid or a chain of such
  // pieces.
  const stem = Array.isArray(mainR)
    ? switchChainTo(mainR, straightLen)
    : [mainR !== null && typeof mainR === 'object'
      ? toRoute({ length: straightLen, r1: mainR.r1, r2: mainR.r2 })
      : toRoute({ length: straightLen, radius: mainR ?? unbent })]
  const mainSignedR = stem[0].r1

  const sWgs = startWgs ?? utmToWgs84(startUtm.easting, startUtm.northing, startUtm.zone)

  // Through route: the form's through length, laid on the stem's curvature.
  const straightUtm    = switchChainPointUtm(startUtm, bearing, stem)
  const mainEndBearing = switchChainBearingAt(bearing, stem)

  // The branch leaves the toe — the start point of a facing switch, the far end
  // of a trailing one taken against the through route. Reversing that direction
  // turns the chain round: its pieces run the other way, their radii change sign
  // and swap ends. The branch's curvature is added to the stem's from there.
  const arcOriginUtm = trailing ? straightUtm : startUtm
  const curveBearing = trailing ? (mainEndBearing + 180) % 360 : bearing
  const stemChain    = trailing
    ? [...stem].reverse().map(p => ({ length: p.length, r1: negR(p.r2), r2: negR(p.r1) }))
    : stem
  const stemAtToe    = stemChain[0].r1
  const branchChain  = switchBranchChain(formChain, stemChain)
  const signedR      = branchChain[0].r1
  const curvedUtm    = switchChainPointUtm(arcOriginUtm, curveBearing, branchChain)

  // Ports as UTM [easting, northing]
  const portA  = trailing ? [straightUtm.easting, straightUtm.northing] : [startUtm.easting, startUtm.northing]
  const portB1 = [curvedUtm.easting, curvedUtm.northing]
  const portB2 = trailing ? [startUtm.easting, startUtm.northing] : [straightUtm.easting, straightUtm.northing]

  // WGS84 coords for map rendering
  const straightEnd  = utmToWgs84(straightUtm.easting, straightUtm.northing, startUtm.zone)
  const arcOriginWgs = trailing ? straightEnd : sWgs
  const curvedEnd    = utmToWgs84(curvedUtm.easting, curvedUtm.northing, startUtm.zone)
  const main   = chainGeometry(startUtm, sWgs, bearing, stem, straightEnd)
  const branch = chainGeometry(arcOriginUtm, arcOriginWgs, curveBearing, branchChain, curvedEnd)
  const straightCoords = main.coords
  const arcCoords      = branch.coords

  const portA_wgs  = trailing ? straightEnd : sWgs
  const portB1_wgs = curvedEnd
  const portB2_wgs = trailing ? sWgs : straightEnd

  const lcsCoords = lcsLine(portA, portB1, portB2, sw.dLcs, startUtm.zone)

  // The symbol, built once here so every caller draws the same turnout. Both
  // routes have to run from the toe: a trailing switch's through route is built
  // towards it, so it turns round for the ring.
  const throughFromToe = trailing ? [...straightCoords].reverse() : straightCoords
  const fillCoords = switchFillRing(throughFromToe, arcCoords)
  const labelGeom = switchLabelGeometry(arcOriginUtm, curveBearing, stemChain, branchChain, startUtm.zone)

  return {
    straightCoords, arcCoords, fillCoords, ...labelGeom,
    bauform: switchChainBauform(stemChain, branchChain, symmetric),
    portA, portB1, portB2,
    portA_wgs, portB1_wgs, portB2_wgs,
    lcsCoords,
    straightEnd, arcOrigin: arcOriginWgs, curvedEnd,
    startUtm, straightUtm, arcOriginUtm, curvedUtm,
    signedR, mainSignedR, stemAtToe, stemChain, branchChain,
    stemSegments: trailing ? switchChainSegmentsUtm(arcOriginUtm, curveBearing, stemChain) : main.segments,
    branchSegments: branch.segments,
    curveBearing, mainEndBearing, branchEndBearing: switchChainBearingAt(curveBearing, branchChain),
    arcLen, straightLen,
  }
}
