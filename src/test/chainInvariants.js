import { expect } from 'vitest'
import { wgs84ToUTM } from '../utils/coordinateUtils'
import {
  JOINT_TOL, BEARING_TOL, absLengthErrors, epsgMismatches, nodeGaps, tangentBreaks, untrueLengths,
} from '../utils/chainChecks'
import { SAGITTA_ELEMENT, cantExceptionOf, cantLimit, worstCantOf } from '../utils/mapConstants'
import { switchParts } from '../utils/switchDelete'

/**
 * The invariants an element chain has to hold however it was built — the
 * checklist the create and connect forms are audited against. Each is its own
 * assertion so a failure names the rule that broke, not just the chain.
 */

export { JOINT_TOL, BEARING_TOL } from '../utils/chainChecks'

/** Every element ends where the next begins. */
export function expectNodesJoin(elements, tol = JOINT_TOL) {
  for (const { index, gap } of nodeGaps(elements, tol)) {
    expect(gap, `element ${index} endNode to element ${index + 1} startNode`).toBeLessThan(tol)
  }
}

/**
 * Every element leaves on the tangent the one before arrived on. A chain the
 * forms build is tangent-continuous throughout; a kink is something the user
 * put there deliberately, so a chain that has one is not checked with this.
 */
export function expectTangentsContinuous(elements, epsg, tol = BEARING_TOL) {
  for (const { index, delta } of tangentBreaks(elements, epsg, tol)) {
    expect(delta, `element ${index} end bearing to element ${index + 1} bearing`).toBeLessThan(tol)
  }
}

/** absLength is the running sum of the lengths before it, inclusive. */
export function expectAbsLengthsRunning(elements, tol = 1e-6) {
  for (const { index, absLength, expected } of absLengthErrors(elements, tol)) {
    expect(absLength, `absLength of element ${index}`).toBeCloseTo(expected, -Math.log10(tol))
  }
}

/**
 * The stated length is the length the element's own geometry has: the arc
 * length for an arc, the distance between the nodes for a straight. A
 * transition's is its design length, which its nodes do not state, so it is
 * checked by the chord it cannot be shorter than.
 */
export function expectLengthsTrue(elements, tol = JOINT_TOL) {
  for (const { index, length, expected } of untrueLengths(elements, tol)) {
    const el = elements[index]
    if (el.radius != null) expect(length, `arc length of element ${index}`).toBeCloseTo(expected, 3)
    else if (el.elementType === 2) expect(length, `transition ${index} is at least its chord`).toBeGreaterThanOrEqual(expected - tol)
    else expect(length, `straight length of element ${index}`).toBeCloseTo(expected, 6)
  }
}

/** One CRS per track, and every element of it states that one. */
export function expectEpsgThroughout(track) {
  expect(track.epsg, 'track epsg').toBeTruthy()
  for (const { index, epsg } of epsgMismatches(track)) {
    expect(epsg, `epsg of element ${index}`).toBe(track.epsg)
  }
}

/**
 * A turnout's own elements stay inside the cant a switch admits: 100 mm, or the
 * 120 a written justification on the element buys. This is not geometry, but it
 * is an invariant of a chain a form produced — a dialog that refuses the value
 * must not leave it on an element anyway, and a dialog that accepts an exception
 * has to write the reason onto the element the cant sits on, not only into its
 * own state.
 */
export function expectSwitchCantAdmissible(elements) {
  elements.forEach((el, i) => {
    if (!el.switchBranch) return
    expect(worstCantOf(el), `cant of switch element ${i}`
      + (cantExceptionOf(el) ? ' (on a written exception)' : ' (no justification)'))
      .toBeLessThanOrEqual(cantLimit(el))
  })
}

/**
 * Every end of a switch is an element boundary: each of its routes is made of
 * whole elements of its own, beginning at the port's node and ending where the
 * switch ends. A route with no elements is the failure this guards against —
 * the record would carry a port and nothing else, the symbol would fall back on
 * the stem radii, and the delete rules would find a route that is not there.
 *
 * A turnout owns elements at both of its B ports and none at its toe, which is
 * a node; the crossing kinds own them at all four. Which those are is the
 * kind's own business (switchModel.portsOf), so this reads the ports that carry
 * elements rather than naming B1 and B2.
 *
 * The far boundary needs no assertion of its own: the elements are whole, so
 * where the last of them ends, the next element begins.
 */
export function expectSwitchRoutesCarved(sw, tracks) {
  const { ports } = switchParts(sw, tracks)
  // The toe carries no elements of its own — the route parts there.
  const carrying = ports.filter(p => p.port !== 'A')
  expect(carrying.length, `ports carrying elements of ${sw.name ?? sw.switchId}`).toBeGreaterThan(0)
  for (const port of carrying) {
    expect(port.mine.length,
      `${port.route} elements at port ${port.port} of ${sw.name ?? sw.switchId}`).toBeGreaterThan(0)
  }
}

/** Shortest distance from a plane point to a plane polyline. */
function distanceToPolyline(point, polyline) {
  let best = Infinity
  for (let i = 0; i < polyline.length - 1; i++) {
    const [ax, ay] = polyline[i]
    const [bx, by] = polyline[i + 1]
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    const u  = l2 > 0 ? Math.min(1, Math.max(0, ((point[0] - ax) * dx + (point[1] - ay) * dy) / l2)) : 0
    best = Math.min(best, Math.hypot(ax + u * dx - point[0], ay + u * dy - point[1]))
  }
  return best
}

/**
 * The two polylines an element carries describe one curve at two densities:
 * `geometry.coordinates` at SAGITTA_ELEMENT and `renderCoords` at SAGITTA_TRACK.
 * They have to share their ends, and every vertex of the coarse one has to sit
 * on the fine one — both are sampled from the same exact curve, so the coarse
 * vertices lie within the fine one's own sagitta of it.
 */
export function expectRenderCoordsConsistent(elements, epsg) {
  elements.forEach((el, i) => {
    if (!el.renderCoords) return
    const fine = el.geometry?.coordinates ?? []
    expect(fine.length, `element ${i} has a fine polyline`).toBeGreaterThanOrEqual(2)

    const toPlane = (c) => {
      const { easting, northing } = wgs84ToUTM(c, epsg)
      return [easting, northing]
    }
    const finePlane = fine.map(toPlane)
    const coarsePlane = el.renderCoords.map(toPlane)
    const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

    // Shared ends, not identical ones: a transition's two polylines come out of
    // two runs of the same integrator at two step counts, which puts their far
    // ends a micron apart. The reload snaps both onto the stored end node
    // (reconstructElements), so that micron never reaches the stored geometry.
    expect(apart(coarsePlane[0], finePlane[0]),
      `element ${i} polylines start together`).toBeLessThan(JOINT_TOL)
    expect(apart(coarsePlane[coarsePlane.length - 1], finePlane[finePlane.length - 1]),
      `element ${i} polylines end together`).toBeLessThan(JOINT_TOL)

    // Every vertex of the coarse polyline sits on the fine one. Both are sampled
    // from the same exact curve, so the gap is the fine polyline's own sagitta —
    // allowed double here because the step counts are sized from a heuristic that
    // does not bound it exactly, not because the curves may differ. A polyline
    // off the curve is out by metres, not by centimetres.
    for (const vertex of coarsePlane) {
      expect(distanceToPolyline(vertex, finePlane),
        `element ${i} render vertex lies on the fine polyline`).toBeLessThan(2 * SAGITTA_ELEMENT)
    }
  })
}

/** The whole checklist for a track the forms produced. */
export function expectValidTrack(track) {
  const elements = track.elements ?? []
  expectEpsgThroughout(track)
  expectNodesJoin(elements)
  expectTangentsContinuous(elements, track.epsg)
  expectAbsLengthsRunning(elements)
  expectLengthsTrue(elements)
  expectRenderCoordsConsistent(elements, track.epsg)
  expectSwitchCantAdmissible(elements)
}
