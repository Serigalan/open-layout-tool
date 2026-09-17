/**
 * The cross section of one element: the running plane, the superstructure
 * carrying it and the clearance contour over it, all in millimetres of the
 * track's own frame — y across the track from its centre, positive to the
 * right seen in the running direction, z up from the running plane.
 *
 * Nothing here is stored. The section is derived from what the element already
 * carries — its cant and its radius — plus the superstructure stated on the
 * track, so a cross section can never disagree with the alignment it belongs to.
 */

/** Distance between the two running circles, and between the rail inner faces [mm]. */
export const RUNNING_CIRCLE_DISTANCE = 1500
export const TRACK_GAUGE             = 1435

/** The superstructure a track or an element can be built with. */
export const RAIL_TYPES    = ['S49', 'S54', 'UIC60']
export const SLEEPER_TYPES = ['B70']

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * The superstructure of an element: stated on the track and overridable per
 * element, the same resolution rule as the cant at a transition — the element
 * wins where it says something, otherwise the track does. Which is what lets a
 * track change its rail profile part way along without every element having to
 * carry one.
 */
export function resolveSuperstructure(track, el) {
  return {
    rail:    el?.rail    ?? track?.rail    ?? null,
    sleeper: el?.sleeper ?? track?.sleeper ?? null,
  }
}

/**
 * The angle the cant turns the section through [rad], about the centre of the
 * two running circles.
 *
 * Cant is the height difference between the running circles, so the angle
 * follows from that distance alone: sin θ = u / 1500. Its sign follows the
 * store's convention (see mapConstants) — a positive cant raises the left rail,
 * which in a section seen in the running direction is the one at negative y, so
 * the section turns clockwise and the angle is negative.
 */
export const cantAngle = (cant) =>
  -Math.asin(clamp((cant ?? 0) / RUNNING_CIRCLE_DISTANCE, -1, 1))

/** A point [y, z] turned about the origin by `angle`, the rotation the cant makes. */
export const rotatePoint = ([y, z], angle) => {
  const c = Math.cos(angle), s = Math.sin(angle)
  return [y * c - z * s, y * s + z * c]
}

/** A polyline turned by the cant — the whole section rotates rigidly. */
export const rotatePoints = (points, angle) => points.map(p => rotatePoint(p, angle))

/**
 * The mapping that fits a section into a drawing area: scale [px/mm] and the
 * pixel the track frame's origin lands on, so `x = cx + y·k` and `y = cy − z·k`.
 * One scale for both axes — a cross section that is not to scale says nothing
 * about clearance, which is the only reason to draw it.
 */
export function fitSection(points, { w, h }, margin = 0) {
  const ys = points.map(p => p[0]), zs = points.map(p => p[1])
  const yMin = Math.min(...ys), yMax = Math.max(...ys)
  const zMin = Math.min(...zs), zMax = Math.max(...zs)
  const k = Math.min(
    (w - 2 * margin) / Math.max(yMax - yMin, 1),
    (h - 2 * margin) / Math.max(zMax - zMin, 1),
  )
  return {
    k,
    cx: w / 2 - ((yMin + yMax) / 2) * k,
    cy: h / 2 + ((zMin + zMax) / 2) * k,
    bounds: { yMin, yMax, zMin, zMax },
  }
}

/**
 * The states a cross section can be taken in along one element. An arc or a
 * straight has one; a transition ramps between two, and both ends are read —
 * a section at the middle of a ramp would answer for neither.
 */
export function sectionStates(el) {
  if (el?.elementType === 2) {
    return [
      { id: 'start', cant: el.cantStart ?? 0, radius: el.r1 ?? null },
      { id: 'end',   cant: el.cantEnd   ?? 0, radius: el.r2 ?? null },
    ]
  }
  return [{ id: 'const', cant: el?.cant ?? 0, radius: el?.radius ?? null }]
}

const HALF_RUNNING = RUNNING_CIRCLE_DISTANCE / 2
const HALF_GAUGE   = TRACK_GAUGE / 2

/**
 * The drawable cross section for one state of an element: everything in the
 * track frame [mm], already turned by the cant, so a backend only has to draw
 * polylines it is handed.
 *
 * The clearance contour turns with the track. That is what makes the drawing
 * worth having: the contour is fixed to the running plane, so the cant leans it
 * against whatever stands beside the track.
 */
export function crossSection({ cant = 0, gaugeRing = [] }) {
  const angle = cantAngle(cant)
  return {
    angle,
    // The two running circles carry the running plane between them; the rail
    // inner faces sit the gauge apart on the same line.
    runningCircles: rotatePoints([[-HALF_RUNNING, 0], [HALF_RUNNING, 0]], angle),
    railFaces:      rotatePoints([[-HALF_GAUGE, 0], [HALF_GAUGE, 0]], angle),
    gauge:          rotatePoints(gaugeRing, angle),
  }
}
