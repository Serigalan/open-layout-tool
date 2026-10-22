import {
  computeCurvedValuesUtm, computeStraightValuesUtm, resolveEndBearing, curvatureOf,
  reconstructElements,
} from '../geometry'

// Runs of elements that are one element: what a turnout carved into a track
// and its deletion joins again (switchDelete), and what the element table
// merges on request — consecutive elements alike in type, radius and cant
// (Entscheidung 378).

/** Two nodes are the same node below this [m] — chainInvariants' JOINT_TOL. */
const JOINT_TOL = 1e-3

/** Two tangents are the same tangent below this [°]. */
const BEARING_TOL = 1e-6

/** Two radii are the same radius below this [m]. */
const RADIUS_TOL = 1e-6

/** …and for the table's merge, which compares radii as the table shows them [m]. */
const EQUAL_RADIUS_TOL = 1e-3

/** Two cants are the same cant below this [mm]. */
const CANT_TOL = 1e-6

const bearingDelta = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

/**
 * Where an element sits and how it is drawn — derived from everything else, so
 * it says nothing about whether two elements are the same kind of element.
 * `radius`, the transition's `r1`/`r2` and the ramp's `cantStart`/`cantEnd` are
 * out because they are compared by their own rule below.
 */
const PLACEMENT_KEYS = new Set([
  'startNode', 'endNode', 'bearing', 'endBearing', 'length',
  'geometry', 'renderCoords', 'epsg', 'radius', 'r1', 'r2', 'cantStart', 'cantEnd',
])

/** Do these two agree in everything that is not placement — cant, speed, type? */
function sameFields(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter(k => !PLACEMENT_KEYS.has(k)))
  for (const key of keys) if (a[key] !== b[key]) return false
  return true
}

/** The cant at either end of a straight or arc: one value, or its own two. */
const cantPair = (el) => [el.cantStart ?? el.cant ?? 0, el.cantEnd ?? el.cant ?? 0]

/**
 * Are these two alike as the element table means it (Entscheidung 378): the
 * same type and the same cant all along — speed, role and reasons are the
 * first's in the merged element. The radius is compared by mergeableRun.
 */
function sameKind(a, b) {
  if ((a.elementType ?? 0) !== (b.elementType ?? 0)) return false
  if (a.elementType === 2) return (a.transitionType ?? 'clothoid') === (b.transitionType ?? 'clothoid')
  const [a0, a1] = cantPair(a), [b0, b1] = cantPair(b)
  return Math.abs(a0 - a1) < CANT_TOL && Math.abs(b0 - b1) < CANT_TOL && Math.abs(a0 - b0) < CANT_TOL
}

/** The curvature a clothoid gains per metre — equal for pieces of one curve. */
const curvatureRate = (el) => (el.length > 0
  ? (curvatureOf(el.r2 ?? null) - curvatureOf(el.r1 ?? null)) / el.length : 0)

/**
 * May this run of elements be a single element — is it one element that was cut
 * into these, or a chain that is indistinguishable from one?
 *
 * The run has to agree in everything that is not placement (`sameFields`:
 * element type, cant, speed, transition type, …), meet node to node and run on
 * tangentially. On top of that, per kind:
 *
 * - straights: none of them curved;
 * - arcs: the same signed radius, and a combined sweep under half a turn —
 *   past that a chord and a radius no longer name one arc, and the merge would
 *   silently give back its complement;
 * - transitions: clothoids only, chained (`r2` of each is `r1` of the next) and
 *   at one curvature rate, which is what makes them pieces of *one* clothoid
 *   rather than two that meet. A Bloss curve is never cut in the first place
 *   (splitClothoid refuses it), so two of them are two curves, never one.
 *
 * An element that carries a switch mark is never merged: it is some turnout's
 * own geometry, and that turnout's dimension is what its element boundaries
 * say.
 *
 * `equal` loosens the first condition to the element table's (sameKind): type
 * and cant alike, radii to the millimetre; everything else the merged element
 * takes from the first.
 */
export function mergeableRun(els, epsg = null, { equal = false } = {}) {
  if (!Array.isArray(els) || els.length < 2) return false
  if (els.some(el => !el || el.switchBranch || !el.startNode || !el.endNode)) return false

  const [first] = els
  const alike = equal ? sameKind : sameFields
  for (const el of els) if (!alike(first, el)) return false
  const radiusTol = equal ? EQUAL_RADIUS_TOL : RADIUS_TOL

  if (first.elementType === 2) {
    if (first.transitionType === 'bloss' || first.r1 === undefined) return false
    const rate = curvatureRate(first)
    for (const el of els) {
      if (Math.abs(curvatureRate(el) - rate) > 1e-9 * Math.max(Math.abs(rate), 1e-9)) return false
    }
    for (let i = 0; i < els.length - 1; i++) {
      const k1 = curvatureOf(els[i].r2 ?? null), k2 = curvatureOf(els[i + 1].r1 ?? null)
      if (equal ? Math.abs(k1 - k2) > 1e-12 : k1 !== k2) return false
      const c1 = els[i].cantEnd ?? null, c2 = els[i + 1].cantStart ?? null
      if (equal && c1 != null && c2 != null ? Math.abs(c1 - c2) >= CANT_TOL : c1 !== c2) return false
    }
  } else if (first.radius != null) {
    for (const el of els) {
      if (el.radius == null || Math.abs(el.radius - first.radius) > radiusTol) return false
    }
    const sweep = els.reduce((sum, el) => sum + (el.length ?? 0), 0) / Math.abs(first.radius)
    if (!(sweep < Math.PI)) return false
  } else {
    for (const el of els) if (el.radius != null) return false
  }

  for (let i = 0; i < els.length - 1; i++) {
    const a = els[i], b = els[i + 1]
    if (Math.hypot(a.endNode[0] - b.startNode[0], a.endNode[1] - b.startNode[1]) > JOINT_TOL) return false
    if (bearingDelta(resolveEndBearing(a, epsg), b.bearing) > BEARING_TOL) return false
  }
  return true
}

/**
 * The run as the one element it may be (mergeableRun has said so). It runs from
 * the first's start node to the last's end node — both are stored plane nodes,
 * so the joins with the neighbours are exactly the ones that were there. Length
 * and bearings come from the same calls that built the pieces; the display
 * geometry from reconstructElements, the one path a reload takes anyway.
 */
function mergeRun(els, epsg) {
  const first = els[0]
  const last  = els[els.length - 1]
  const startUtm = { easting: first.startNode[0], northing: first.startNode[1], zone: epsg }
  const endUtm   = { easting: last.endNode[0],    northing: last.endNode[1],    zone: epsg }
  const { endBearing: _eb, geometry: _g, renderCoords: _rc, ...base } = first

  let merged
  if (first.elementType === 2) {
    merged = {
      ...base,
      r1: first.r1 ?? null, r2: last.r2 ?? null,
      endNode: last.endNode,
      length: els.reduce((sum, el) => sum + (el.length ?? 0), 0),
      ...(last.endBearing != null ? { endBearing: last.endBearing } : {}),
      ...(first.cantStart !== undefined || last.cantEnd !== undefined
        ? { cantStart: first.cantStart ?? null, cantEnd: last.cantEnd ?? null } : {}),
    }
  } else if (first.radius != null) {
    const v = computeCurvedValuesUtm(startUtm, endUtm, first.radius)
    merged = {
      ...base,
      endNode: v.endNode, bearing: v.bearing, endBearing: v.endBearing,
      length: v.length, radius: first.radius,
    }
  } else {
    const v = computeStraightValuesUtm(startUtm, endUtm)
    merged = {
      ...base,
      endNode: v.endNode, bearing: v.bearing, length: v.length,
      ...(last.endBearing != null ? { endBearing: last.endBearing } : {}),
    }
  }
  return reconstructElements([merged], epsg)[0]
}

/**
 * The chain with every run that may be one element merged into one. Returns
 * `{ elements, mergedFrom, mergedInto }` — how many elements went into merges
 * and how many came out, which is what the dialog's preview counts. `equal`
 * as mergeableRun's: the element table's merge of alike elements.
 */
export function mergeChain(elements, epsg, { equal = false } = {}) {
  const out = []
  let mergedFrom = 0, mergedInto = 0
  let i = 0
  while (i < elements.length) {
    let j = i + 1
    while (j < elements.length && mergeableRun(elements.slice(i, j + 1), epsg, { equal })) j++
    if (j - i > 1) {
      out.push(mergeRun(elements.slice(i, j), epsg))
      mergedFrom += j - i
      mergedInto += 1
    } else {
      out.push(elements[i])
    }
    i = j
  }
  return { elements: out, mergedFrom, mergedInto }
}
