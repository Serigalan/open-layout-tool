import { transformPlanePoint } from './coordinateUtils'
import { reconstructElements } from './elementReconstruct'
import { recalcAbsLengths } from '../storage'

/**
 * Carrying an alignment from one projected plane into another.
 *
 * The app holds one plane per track and every element in it as plane data:
 * two nodes, a bearing, a length, signed radii. Moving a track to another
 * plane is therefore not a matter of relabelling `epsg` — none of those
 * numbers survives the move unchanged:
 *
 * - a **bearing** is grid-relative. Between GK zone 3 and zone 4 grid north
 *   turns by about 2.59 gon, so an element that keeps its stated bearing ends
 *   up rotated by that much — some 40 m over a kilometre.
 * - a **length** is a plane length. Gauss-Krüger is conformal but not
 *   equidistant: its scale factor is 1 on the central meridian and grows
 *   outwards, so the same physical track is a slightly different number of
 *   metres in each plane.
 * - a **radius** is a plane radius and scales with the length.
 *
 * What does survive is the **node**. A point has one position on the ground,
 * and each plane states it its own way; transforming it is exact (up to the
 * datum transformation itself). So the nodes are what this carries over, and
 * every other number is refitted to them.
 *
 * **The refit.** Each element is taken as a shape — a turn angle, a ratio of
 * curvatures — laid between its two nodes. In the new plane the chord between
 * the transformed nodes has a new length and a new direction, so the shape is
 * scaled by the ratio of the two chords and rotated by the difference of the
 * two chord directions:
 *
 *     k = |E' − S'| / |E − S|
 *     bearing'  = bearing + (γ' − γ)          length' = length · k
 *     radius'   = radius · k                  r1', r2' = r1 · k, r2 · k
 *
 * That lands on both nodes **exactly**, for all three element kinds, which is
 * worth spelling out because it is not obvious:
 *
 * - a straight's bearing *is* its chord direction, so bearing' = γ';
 * - an arc of radius R turning through θ has chord 2R·sin(θ/2) — scaling R by
 *   k with θ untouched scales the chord by k, and its direction follows the
 *   rotation;
 * - a clothoid is defined by lengths alone (A² = R·L), so scaling every length
 *   by k scales the whole shape by k and leaves every angle in it alone.
 *
 * **What it does not preserve** is the tangent between two elements, to the
 * extent that their two chords rotate differently — the part of the move that
 * is not a similarity over the length of an element. Two neighbours of very
 * different lengths average the rotation over different distances, so the
 * tangent they used to share opens by that difference.
 *
 * `transformTrackToPlane` reports it, and as the *increase* over the gap the
 * chain already had: a third of the joints in the test database are bent in the
 * source data — the widest by 4.3° — and an absolute figure would be reporting
 * those rather than anything this did. Over 4 954 joints carried from DHDN GK4
 * into DB_REF GK3, zone change included, the increase is 7.9e-6° in the median
 * and 3.7e-4° at worst, and the worst is a 4 km straight meeting a 173 m
 * transition. Nodes stay exact; the tangents drift by a hair.
 */

const RAD2DEG = 180 / Math.PI
const norm360 = (deg) => ((deg % 360) + 360) % 360
const bearingDelta = (a, b) => ((a - b + 540) % 360) - 180

/** Azimuth of a plane vector, in the same degrees-from-north the model uses. */
const azimuth = (de, dn) => norm360(Math.atan2(de, dn) * RAD2DEG)

/**
 * Below this a chord states no direction [m]. Measured between DHDN GK4 and
 * DB_REF GK3: the angle a transformed chord gives, against the exact rotation
 * at the same point, is off by 8.6e-2° over a chord of 1 µm, 1.0e-5° over a
 * centimetre and 1.7e-6° over a decimetre, where it reaches the floor of the
 * transformation's own precision. The source data holds elements a micrometre
 * long, and read off their chord they come out of the move turned by a
 * sixteenth of a degree against both their neighbours.
 */
const MIN_CHORD = 0.1

/** How far a 10 m probe is turned and stretched — enough to carry a short element. */
const PROBE = 10

/**
 * The scale and rotation the transformation has at one point, read off a probe
 * along `bearing`. This is what an element too short to state a chord of its
 * own is carried over by: exact where the chord is noise, and wrong by the
 * averaging a long element needs — which is why anything long enough uses its
 * own chord instead.
 */
function localFit(easting, northing, bearing, fromCrs, toCrs) {
  const rad = bearing * Math.PI / 180
  const [e1, n1] = transformPlanePoint(easting, northing, fromCrs, toCrs)
  const [e2, n2] = transformPlanePoint(
    easting + PROBE * Math.sin(rad), northing + PROBE * Math.cos(rad), fromCrs, toCrs)
  const de = e2 - e1, dn = n2 - n1
  const len = Math.hypot(de, dn)
  if (!(len > 0)) return { k: 1, turn: 0 }
  return { k: len / PROBE, turn: bearingDelta(azimuth(de, dn), bearing) }
}

/**
 * One element in the other plane, fitted to its own two transformed nodes.
 * Returns null where the element carries no nodes to fit to — nothing can be
 * said about where it would land.
 */
export function transformElement(el, fromCrs, toCrs) {
  if (!el?.startNode || !el?.endNode) return null
  const [se, sn] = transformPlanePoint(el.startNode[0], el.startNode[1], fromCrs, toCrs)
  const [ee, en] = transformPlanePoint(el.endNode[0], el.endNode[1], fromCrs, toCrs)
  if (![se, sn, ee, en].every(Number.isFinite)) return null

  const d  = Math.hypot(el.endNode[0] - el.startNode[0], el.endNode[1] - el.startNode[1])
  const d2 = Math.hypot(ee - se, en - sn)
  const { k, turn } = d >= MIN_CHORD && d2 > 0
    ? {
      k: d2 / d,
      turn: bearingDelta(
        azimuth(ee - se, en - sn),
        azimuth(el.endNode[0] - el.startNode[0], el.endNode[1] - el.startNode[1])),
    }
    : localFit(el.startNode[0], el.startNode[1], el.bearing ?? 0, fromCrs, toCrs)

  const out = {
    ...el,
    startNode: [se, sn],
    endNode:   [ee, en],
    bearing:   norm360((el.bearing ?? 0) + turn),
    length:    (el.length ?? 0) * k,
  }
  if (el.endBearing != null) out.endBearing = norm360(el.endBearing + turn)
  if (el.radius != null) out.radius = el.radius * k
  if (el.r1 != null) out.r1 = el.r1 * k
  if (el.r2 != null) out.r2 = el.r2 * k
  return out
}

/**
 * A whole track in the other plane: every element refitted to its transformed
 * nodes, the stations recounted, the display geometry rebuilt, and `epsg` set
 * to the plane it is now in. The vertical alignment travels unchanged in `z`
 * but its stations are scaled with the elements, since they are measured along
 * the same track.
 *
 * Returns { track, scale, tangentGap, refused } —
 *   scale       the largest and smallest chord ratio met, as { min, max }
 *   tangentGap  the widest a joint's tangent opened by, over what it already
 *               was in the source chain [°]
 *   refused     elements that carried no nodes and were dropped
 */
export function transformTrackToPlane(track, toCrs) {
  const fromCrs = Number(track?.epsg)
  const target  = Number(toCrs)
  const source  = track?.elements ?? []
  if (!Number.isFinite(fromCrs) || !Number.isFinite(target)) return null
  if (fromCrs === target) return { track, scale: { min: 1, max: 1 }, tangentGap: 0, refused: 0 }

  const moved = []
  let refused = 0
  let min = Infinity, max = -Infinity
  for (const el of source) {
    const next = transformElement(el, fromCrs, target)
    if (!next) { refused += 1; continue }
    const k = (el.length ?? 0) > 0 ? next.length / el.length : 1
    min = Math.min(min, k); max = Math.max(max, k)
    moved.push(next)
  }

  // What the refit costs, measured as the increase over what the chain already
  // had: the source data is full of joints that are bent on purpose, and the
  // gap itself would report those rather than anything this did.
  let tangentGap = 0
  if (moved.length === source.length) {
    for (let i = 0; i + 1 < moved.length; i++) {
      tangentGap = Math.max(tangentGap, Math.abs(jointGap(moved, i) - jointGap(source, i)))
    }
  }

  const elements = reconstructElements(recalcAbsLengths(moved), target)
  const scale = { min: Number.isFinite(min) ? min : 1, max: Number.isFinite(max) ? max : 1 }
  const heights = scaleHeights(track.heights, moved, source)
  return {
    track: {
      ...track,
      epsg: target,
      elements,
      ...(heights ? { heights } : {}),
    },
    scale, tangentGap, refused,
  }
}

/** How far the tangent opens at the joint after element `i` [°]. */
const jointGap = (els, i) =>
  Math.abs(bearingDelta(els[i + 1].bearing, els[i].endBearing ?? els[i].bearing))

/**
 * The vertical alignment along the track after the refit. A height point is
 * stationed along the alignment, and the alignment is now a different number
 * of metres long, so every station moves with it — by the one ratio the whole
 * track changed by, which is what the elements' own lengths say. The heights
 * themselves are untouched: they are metres above a datum, not plane metres.
 */
function scaleHeights(heights, moved, source) {
  if (!(heights?.length >= 2)) return null
  const before = source.reduce((sum, el) => sum + (el.length ?? 0), 0)
  const after  = moved.reduce((sum, el) => sum + (el.length ?? 0), 0)
  if (!(before > 0) || !(after > 0)) return heights
  const k = after / before
  return heights.map(h => ({ ...h, station: h.station * k, ...(h.rv != null ? { rv: h.rv * k } : {}) }))
}
