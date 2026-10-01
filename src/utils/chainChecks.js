import { resolveEndBearing } from './elementUtils'

/**
 * The invariants an element chain has to hold, as plain checks: each returns
 * the places a chain breaks one, empty when it holds. The test helper
 * (src/test/chainInvariants.js) asserts on them, and validateProject reports
 * them for a whole project.
 */

/** Two nodes are the same node below this [m]. */
export const JOINT_TOL = 0.001

/** Two tangents are the same tangent below this [°]. */
export const BEARING_TOL = 1e-6

const bearingDelta = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

/** Where an element does not end where the next begins: [{ index, gap }]. */
export function nodeGaps(elements, tol = JOINT_TOL) {
  const out = []
  for (let i = 0; i < (elements?.length ?? 0) - 1; i++) {
    const e = elements[i].endNode, s = elements[i + 1].startNode
    if (!Array.isArray(e) || !Array.isArray(s)) continue
    const gap = Math.hypot(e[0] - s[0], e[1] - s[1])
    if (!(gap < tol)) out.push({ index: i, gap })
  }
  return out
}

/** Where an element leaves on another tangent than the one before arrived on: [{ index, delta }]. */
export function tangentBreaks(elements, epsg, tol = BEARING_TOL) {
  const out = []
  for (let i = 0; i < (elements?.length ?? 0) - 1; i++) {
    const delta = bearingDelta(resolveEndBearing(elements[i], epsg), elements[i + 1].bearing)
    if (!(delta < tol)) out.push({ index: i, delta })
  }
  return out
}

/** Where absLength is not the running sum of the lengths: [{ index, absLength, expected }]. */
export function absLengthErrors(elements, tol = 1e-6) {
  const out = []
  let running = 0
  ;(elements ?? []).forEach((el, i) => {
    running += el.length
    if (!(Math.abs(el.absLength - running) < tol)) out.push({ index: i, absLength: el.absLength, expected: running })
  })
  return out
}

/**
 * Where the stated length is not the length the element's own geometry has:
 * the arc length for an arc, the distance between the nodes for a straight. A
 * transition's is its design length, which its nodes do not state, so it is
 * only checked against the chord it cannot be shorter than.
 * [{ index, length, expected }] — `expected` the chord for a transition.
 */
export function untrueLengths(elements, tol = JOINT_TOL) {
  const out = []
  ;(elements ?? []).forEach((el, i) => {
    if (!Array.isArray(el.startNode) || !Array.isArray(el.endNode)) return
    const chord = Math.hypot(el.endNode[0] - el.startNode[0], el.endNode[1] - el.startNode[1])
    if (el.radius != null) {
      const absR = Math.abs(el.radius)
      const expected = 2 * absR * Math.asin(Math.min(1, chord / (2 * absR)))
      if (!(Math.abs(el.length - expected) < 0.5e-3)) out.push({ index: i, length: el.length, expected })
    } else if (el.elementType === 2) {
      if (!(el.length >= chord - tol)) out.push({ index: i, length: el.length, expected: chord })
    } else if (!(Math.abs(el.length - chord) < 0.5e-6)) {
      out.push({ index: i, length: el.length, expected: chord })
    }
  })
  return out
}

/** Elements stating another CRS than their track's: [{ index, epsg }]. */
export function epsgMismatches(track) {
  const out = []
  ;(track?.elements ?? []).forEach((el, i) => {
    if (el.epsg !== undefined && el.epsg !== track.epsg) out.push({ index: i, epsg: el.epsg })
  })
  return out
}
