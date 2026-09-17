/**
 * The cross section of a track at a station: the running plane, the
 * superstructure carrying it and the clearance contour over it, all in
 * millimetres of the track's own frame — y across the track from its centre,
 * positive to the right seen in the running direction, z up from the running
 * plane, which is the top of the rail head.
 *
 * Nothing about the section is stored. It is derived from what the track and
 * the element already carry — cant, radius and the superstructure stated along
 * the track — so a section can never disagree with the alignment it belongs to.
 */

/** Distance between the two running circles, and between the rail inner faces [mm]. */
export const RUNNING_CIRCLE_DISTANCE = 1500
export const TRACK_GAUGE             = 1435

/**
 * Rail profiles by their current designation, the former name alongside because
 * that is what drawings and the MDB stock data still say. All in mm.
 */
export const RAILS = {
  '49E5': { label: '49 E 5 (S 49)',  head: 67, height: 149, web: 14,   foot: 125 },
  '54E4': { label: '54 E 4 (S 54)',  head: 67, height: 154, web: 16,   foot: 125 },
  '60E2': { label: '60 E 2 (UIC 60)', head: 72, height: 172, web: 16.5, foot: 150 },
}

/** Sleepers by type, with what each is laid for (`use` is a translation key). */
export const SLEEPERS = {
  B70:    { label: 'B70',             length: 2600, width: 300, height: 210, use: 'normal' },
  B90:    { label: 'B90',             length: 2600, width: 320, height: 200, use: 'switch_zone' },
  SWITCH: { label: 'Weichenschwelle', length: 2600, width: 300, height: 220, use: 'switch' },
}

/** What a track is built with where it says nothing else. */
export const DEFAULT_RAIL    = '54E4'
export const DEFAULT_SLEEPER = 'B70'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Station a track's element begins at [m]. */
export const elementStartStation = (track, elIdx) =>
  (track?.elements ?? []).slice(0, elIdx).reduce((s, el) => s + (el.length ?? 0), 0)

/**
 * The type stated for a station by a list of ranges ([{ type, from, to }], m
 * along the track), or null where none states one. A later range wins over an
 * earlier one: the ranges are adjustments laid over the default, and the last
 * adjustment made is the one that holds.
 */
const rangeTypeAt = (ranges, station) => {
  for (let i = (ranges?.length ?? 0) - 1; i >= 0; i--) {
    const r = ranges[i]
    if (station >= (r.from ?? 0) && station <= (r.to ?? Infinity)) return r.type
  }
  return null
}

/**
 * The superstructure at a station: the type the track states for that stretch,
 * otherwise the default one. A track carries rails and sleepers as stretches
 * (`track.rails`, `track.sleepers`), not per element — a rail profile changes
 * at a station, and tying that to where an element happens to end would put a
 * joint wherever the alignment has one.
 *
 * Both lists are optional, and a track that states neither is built of the
 * defaults from begin to end. Only an adjustment is written down.
 */
export function superstructureAt(track, station) {
  return {
    rail:    rangeTypeAt(track?.rails, station)    ?? DEFAULT_RAIL,
    sleeper: rangeTypeAt(track?.sleepers, station) ?? DEFAULT_SLEEPER,
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
 * The states a cross section can be taken in along one element, each with the
 * station it is taken at. An arc or a straight has one; a transition ramps
 * between two, and both ends are read — a section at the middle of a ramp would
 * answer for neither.
 */
export function sectionStates(el, startStation = 0) {
  const end = startStation + (el?.length ?? 0)
  if (el?.elementType === 2) {
    return [
      { id: 'start', cant: el.cantStart ?? 0, radius: el.r1 ?? null, station: startStation },
      { id: 'end',   cant: el.cantEnd   ?? 0, radius: el.r2 ?? null, station: end },
    ]
  }
  return [{ id: 'const', cant: el?.cant ?? 0, radius: el?.radius ?? null, station: startStation }]
}

const HALF_RUNNING = RUNNING_CIRCLE_DISTANCE / 2
const HALF_GAUGE   = TRACK_GAUGE / 2

/**
 * Outline of one rail, its inner face at `faceY` and its head top on the
 * running plane. Head, web and foot are the profile's own widths; how the
 * height divides between them is a drawing convention, not a profile figure —
 * at the scale a whole section is drawn at, a rail is a few pixels tall.
 */
const HEAD_SHARE = 0.28
const FOOT_SHARE = 0.16

function railOutline(rail, faceY, side) {
  const axis = faceY + side * rail.head / 2
  const headZ = -rail.height * HEAD_SHARE
  const footZ = -rail.height * (1 - FOOT_SHARE)
  const at = (halfWidth, z) => [[axis - halfWidth, z], [axis + halfWidth, z]]
  const [headL, headR] = at(rail.head / 2, 0)
  const [hbL, hbR]     = at(rail.head / 2, headZ)
  const [webL, webR]   = at(rail.web / 2, headZ)
  const [wbL, wbR]     = at(rail.web / 2, footZ)
  const [footL, footR] = at(rail.foot / 2, footZ)
  const [botL, botR]   = at(rail.foot / 2, -rail.height)
  return [headL, headR, hbR, webR, wbR, footR, botR, botL, footL, wbL, webL, hbL, headL]
}

/** Outline of the sleeper under the rails, its top at the rail foot. */
function sleeperOutline(sleeper, railHeight) {
  const half = sleeper.length / 2
  const top = -railHeight, bottom = top - sleeper.height
  return [[-half, top], [half, top], [half, bottom], [-half, bottom], [-half, top]]
}

/**
 * The drawable cross section for one state of an element: everything in the
 * track frame [mm], already turned by the cant, so a backend only has to draw
 * the polylines it is handed.
 *
 * The clearance contour turns with the track. That is what makes the drawing
 * worth having: the contour is fixed to the running plane, so the cant leans it
 * against whatever stands beside the track.
 */
export function crossSection({ cant = 0, gaugeRing = [], gaugeGuides = [], rail = null, sleeper = null }) {
  const angle = cantAngle(cant)
  const railProfile    = RAILS[rail] ?? null
  const sleeperProfile = SLEEPERS[sleeper] ?? null
  return {
    angle,
    // The two running circles carry the running plane between them; the rail
    // inner faces sit the gauge apart on the same line.
    runningCircles: rotatePoints([[-HALF_RUNNING, 0], [HALF_RUNNING, 0]], angle),
    railFaces:      rotatePoints([[-HALF_GAUGE, 0], [HALF_GAUGE, 0]], angle),
    gauge:          rotatePoints(gaugeRing, angle),
    guides:         gaugeGuides.map(line => rotatePoints(line, angle)),
    rails: railProfile
      ? [rotatePoints(railOutline(railProfile, -HALF_GAUGE, -1), angle),
        rotatePoints(railOutline(railProfile, HALF_GAUGE, 1), angle)]
      : [],
    sleeper: sleeperProfile && railProfile
      ? rotatePoints(sleeperOutline(sleeperProfile, railProfile.height), angle)
      : [],
  }
}
