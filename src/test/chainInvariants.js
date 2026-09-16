import { expect } from 'vitest'
import { wgs84ToUTM } from '../utils/coordinateUtils'
import { resolveEndBearing } from '../utils/elementUtils'
import { SAGITTA_ELEMENT, cantExceptionOf, cantLimit, worstCantOf } from '../utils/mapConstants'
import { switchParts } from '../utils/switchDelete'

/**
 * The invariants an element chain has to hold however it was built — the
 * checklist the create and connect forms are audited against. Each is its own
 * assertion so a failure names the rule that broke, not just the chain.
 */

/** Two nodes are the same node below this [m]. */
export const JOINT_TOL = 0.001

/** Two tangents are the same tangent below this [°]. */
export const BEARING_TOL = 1e-6

const signedBearingDelta = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

/** Every element ends where the next begins. */
export function expectNodesJoin(elements, tol = JOINT_TOL) {
  for (let i = 0; i < elements.length - 1; i++) {
    const [eE, eN] = elements[i].endNode
    const [sE, sN] = elements[i + 1].startNode
    expect(Math.hypot(eE - sE, eN - sN),
      `element ${i} endNode to element ${i + 1} startNode`).toBeLessThan(tol)
  }
}

/**
 * Every element leaves on the tangent the one before arrived on. A chain the
 * forms build is tangent-continuous throughout; a kink is something the user
 * put there deliberately, so a chain that has one is not checked with this.
 */
export function expectTangentsContinuous(elements, epsg, tol = BEARING_TOL) {
  for (let i = 0; i < elements.length - 1; i++) {
    expect(signedBearingDelta(resolveEndBearing(elements[i], epsg), elements[i + 1].bearing),
      `element ${i} end bearing to element ${i + 1} bearing`).toBeLessThan(tol)
  }
}

/** absLength is the running sum of the lengths before it, inclusive. */
export function expectAbsLengthsRunning(elements, tol = 1e-6) {
  let running = 0
  elements.forEach((el, i) => {
    running += el.length
    expect(el.absLength, `absLength of element ${i}`).toBeCloseTo(running, -Math.log10(tol))
  })
}

/**
 * The stated length is the length the element's own geometry has: the arc
 * length for an arc, the distance between the nodes for a straight. A
 * transition's is its design length, which its nodes do not state, so it is
 * checked by the chord it cannot be shorter than.
 */
export function expectLengthsTrue(elements, tol = JOINT_TOL) {
  elements.forEach((el, i) => {
    const chord = Math.hypot(el.endNode[0] - el.startNode[0], el.endNode[1] - el.startNode[1])
    if (el.radius != null) {
      const absR = Math.abs(el.radius)
      const expected = 2 * absR * Math.asin(Math.min(1, chord / (2 * absR)))
      expect(el.length, `arc length of element ${i}`).toBeCloseTo(expected, 3)
    } else if (el.elementType === 2) {
      expect(el.length, `transition ${i} is at least its chord`).toBeGreaterThanOrEqual(chord - tol)
    } else {
      expect(el.length, `straight length of element ${i}`).toBeCloseTo(chord, 6)
    }
  })
}

/** One CRS per track, and every element of it states that one. */
export function expectEpsgThroughout(track) {
  expect(track.epsg, 'track epsg').toBeTruthy()
  for (const [i, el] of (track.elements ?? []).entries()) {
    if (el.epsg === undefined) continue
    expect(el.epsg, `epsg of element ${i}`).toBe(track.epsg)
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
 * Both ends of a turnout are element boundaries: each of its two routes is made
 * of whole elements of its own, beginning at the port's node and ending where
 * the turnout ends. A route with no elements is the failure this guards against
 * — the record would carry a port and nothing else, the symbol would fall back
 * on the stem radii, and the delete rules would find a route that is not there.
 *
 * The far boundary needs no assertion of its own: the elements are whole, so
 * where the last of them ends, the next element begins.
 */
export function expectSwitchRoutesCarved(sw, tracks) {
  const { byPort } = switchParts(sw, tracks)
  expect(byPort.B1.mine.length, `branch elements of ${sw.name ?? sw.switchId}`).toBeGreaterThan(0)
  expect(byPort.B2.mine.length, `through route elements of ${sw.name ?? sw.switchId}`).toBeGreaterThan(0)
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
