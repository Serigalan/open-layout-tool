import { generateId } from '../identifierUtils'
import { rebuildCoords, recalcAbsLengths, trackLabel } from '../trackModel'
import { computeStraightValuesUtm, computeCurvedValuesUtm, resolveEndBearing, reverseElement, nodeUtm } from '../elementUtils'
import {
  computeSpliceWithClothoids, computeArcSpliceWithClothoids, computeArcArcTransition,
  computeArcStraightSplice, validateSpliceTangents,
} from '../spliceUtils'
import { cantSign } from '../rules/cant'
import { truncateHeights } from '../heightUtils'

// Splicing two tracks into one (R5.5): what a picked element offers the
// splice, the construction for the two picks, and the commit that merges
// them — pure, so the dialog only collects the settings and the tests call
// the same functions.

/**
 * What the splice needs of a picked element: its ends in the track's plane,
 * the bearing it leaves in and its signed radius (null = straight). A
 * transition cannot be spliced — its curvature is not one to continue.
 * Returns the pick, or { error } with a locale key.
 */
export function splicePick(track, elIdx) {
  const el = track?.elements?.[elIdx]
  if (!el) return null
  if (el.elementType === 2) return { error: 'splice_hint_straight_only' }
  const coords = el.geometry.coordinates
  const epsg = track.epsg
  return {
    trackId: track.id, elIdx, epsg, label: trackLabel(track),
    endUtm: nodeUtm(el.endNode, coords[coords.length - 1], epsg),
    startUtm: nodeUtm(el.startNode, coords[0], epsg),
    bearing: resolveEndBearing(el, epsg),
    signedR: el.radius != null ? el.radius : null,
  }
}

/**
 * Whether `pick` may be the second of a splice that started with `first` —
 * null when it may, else a locale key (or 'same' for the very same element,
 * which is ignored rather than refused). Splicing merges both tracks into one,
 * and a track has exactly one CRS: carrying the arrival track's nodes over
 * unchanged would put them in the wrong plane, reprojecting them would distort
 * the design scalars (R 800 m → 799.834 m across GK4/UTM32). So a common CRS
 * is required instead.
 */
export function secondPickRefusal(first, pick) {
  if (first.trackId === pick.trackId && first.elIdx === pick.elIdx) return 'same'
  if (first.trackId === pick.trackId) return 'splice_error_same_track'
  if (Number(first.epsg) !== Number(pick.epsg)) return 'splice_error_crs'
  return null
}

/**
 * The construction between the departure pick `dep` and the arrival pick
 * `arr`, solved in their shared plane: an arc of `radius` between two
 * straights, re-shaped arcs joined by a straight, or — with `arcJoin`
 * 'transition' — one transition from arc to arc. Returns { result, arcMode,
 * Ld, La } or { error } with a locale key.
 */
export function solveSplice(dep, arr, { radius, clothoidEnabled, clothoidDep, clothoidArr, transitionType, arcJoin }) {
  const Ld = clothoidEnabled ? clothoidDep : 0
  const La = clothoidEnabled ? clothoidArr : 0
  const bothArcs = dep.signedR != null && arr.signedR != null
  const mixed    = (dep.signedR == null) !== (arr.signedR == null)
  // Two arcs joined directly need no radius and no lengths: the transition's
  // own length is what closes the construction, so it is solved, not typed.
  const arcMode  = bothArcs || mixed

  let result, validationErr = null
  if (bothArcs && arcJoin === 'transition') {
    result = computeArcArcTransition(
      dep.endUtm, dep.bearing, dep.signedR, arr.endUtm, arr.bearing, arr.signedR,
      dep.startUtm, arr.startUtm, transitionType,
    )
  } else if (mixed) {
    result = computeArcStraightSplice(
      { pointUtm: dep.endUtm, bearing: dep.bearing, signedR: dep.signedR, farUtm: dep.startUtm },
      { pointUtm: arr.endUtm, bearing: arr.bearing, signedR: arr.signedR, farUtm: arr.startUtm },
      radius, Ld, La, transitionType,
    )
  } else if (bothArcs) {
    result = computeArcSpliceWithClothoids(
      dep.endUtm, dep.bearing, dep.signedR, arr.endUtm, arr.bearing, arr.signedR,
      dep.startUtm, arr.startUtm, Ld, La, transitionType,
    )
  } else {
    result = computeSpliceWithClothoids(dep.endUtm, dep.bearing, arr.endUtm, arr.bearing, radius, Ld, La, transitionType)
    if (result && !result.error) {
      validationErr = validateSpliceTangents(result, dep.startUtm, result.reverseArr ? arr.startUtm : arr.endUtm, result.reverseArr)
    }
  }
  if (!result || result.error || validationErr) return { error: result?.error ?? validationErr ?? 'splice_error_parallel' }
  return { result, arcMode, Ld, La }
}

/**
 * The vertical alignment the merged track starts with: the departure track's,
 * cut where its last element is re-shaped — everything from there on belongs
 * to a track that did not exist before and has no gradient until one is read
 * from the terrain on request (see elevationFill).
 */
const spliceHeights = (depTrack, elIdx) => truncateHeights(depTrack.heights,
  (depTrack.elements ?? []).slice(0, elIdx).reduce((sum, el) => sum + (el.length ?? 0), 0))

/** The chain an arc↔arc or arc↔straight solver hands over ready, between what stays of both tracks. */
function readyChain(arc, dep, arr, depTrack, arrTrack, speed) {
  // Reshaped arcs keep their original speed; the new straight and transitions
  // take the dialog's. A re-shaped arc keeps its cant as well; the arrival arc
  // is folded in backwards, so the magnitude is re-signed from the new radius.
  const depOrig = depTrack.elements[dep.elIdx]
  const arrOrig = arrTrack.elements[arr.elIdx]
  const keepCant = (el, orig) => (orig?.cant != null && el.radius != null
    ? { ...el, cant: cantSign(el.radius) * Math.abs(orig.cant) } : el)
  const mid = arc.elements.map((el, i, a) =>
    i === 0            ? keepCant({ ...el, speed: depOrig?.speed ?? speed }, depOrig)
    : i === a.length - 1 ? keepCant({ ...el, speed: arrOrig?.speed ?? speed }, arrOrig)
    :                    { ...el, speed })
  return {
    elements: [
      ...depTrack.elements.slice(0, dep.elIdx).map(el => ({ ...el })),
      ...mid,
      ...arrTrack.elements.slice(0, arr.elIdx).reverse().map(reverseElement),
    ],
    // The arrival track is folded in reversed, so its BEGIN becomes the
    // merged track's END.
    reverseArr: true,
  }
}

/** The chain of an arc between two straights: departure cut back, transitions, the arc, arrival cut back. */
function arcChain(arc, dep, arr, depTrack, arrTrack, { speed, cant, clothoidEnabled }) {
  const zone = depTrack.epsg
  const Ld = clothoidEnabled ? arc.clothoidDepLength : 0
  const La = clothoidEnabled ? arc.clothoidArrLength : 0

  // Departure side: the last element shortened to where the transition (or the arc) starts.
  const elements = depTrack.elements.slice(0, dep.elIdx).map(el => ({ ...el }))
  const depOrig = depTrack.elements[dep.elIdx]
  const depStartWgs = depOrig.geometry.coordinates[0]   // WGS84, for the drawn geometry
  const svDep = computeStraightValuesUtm(nodeUtm(depOrig.startNode, depStartWgs, zone), arc.depClStartUtm)
  elements.push({
    ...depOrig, length: svDep.length, bearing: svDep.bearing, startNode: svDep.startNode, endNode: svDep.endNode,
    geometry: { type: 'LineString', coordinates: [depStartWgs, arc.depTangentWgs] },
  })
  const transition = (s, e, r1, r2, bearing, endBearing, length, coordinates, renderCoords) => ({
    elementType: 2, transitionType: arc.transitionType, r1, r2, bearing, endBearing, length, absLength: length,
    speed, startNode: [s.easting, s.northing], endNode: [e.easting, e.northing],
    geometry: { type: 'LineString', coordinates }, renderCoords,
  })
  if (Ld > 0) {
    elements.push(transition(arc.depClStartUtm, arc.arcStartUtm, null, arc.signedR, arc.depBearing,
      arc.arcStartBearing, Ld, arc.depClothoidCoords, arc.depClothoidCoordsRender))
  }
  const cv = computeCurvedValuesUtm(Ld > 0 ? arc.arcStartUtm : arc.depClStartUtm, La > 0 ? arc.arcEndUtm : arc.arrClEndUtm, arc.signedR)
  elements.push({
    elementType: 1, startNode: cv.startNode, endNode: cv.endNode, bearing: cv.bearing, length: cv.length,
    absLength: cv.length, speed, cant: cantSign(arc.signedR) * Math.abs(cant), endBearing: cv.endBearing,
    radius: arc.signedR, geometry: { type: 'LineString', coordinates: arc.arcCoords }, renderCoords: arc.arcCoordsRender,
  })
  if (La > 0) {
    elements.push(transition(arc.arcEndUtm, arc.arrClEndUtm, arc.signedR, null, arc.arcEndBearing,
      arc.exitBearing, La, arc.arrClothoidCoords, arc.arrClothoidCoordsRender))
  }

  // Arrival side. Reversed (a corner): joined at the arrival END, re-shaped
  // back to its start, the elements before it kept reversed. Forward (a
  // continuation): joined at its START, re-shaped forward, the elements after
  // it kept.
  const arrOrig = arrTrack.elements[arr.elIdx]
  const arrCoords = arrOrig.geometry.coordinates
  const joinWgs = arc.reverseArr ? arrCoords[0] : arrCoords[arrCoords.length - 1]
  const joinUtm = nodeUtm(arc.reverseArr ? arrOrig.startNode : arrOrig.endNode, joinWgs, zone)
  const svArr = computeStraightValuesUtm(arc.arrClEndUtm, joinUtm)
  elements.push({
    ...arrOrig, length: svArr.length, bearing: svArr.bearing, startNode: svArr.startNode, endNode: svArr.endNode,
    geometry: { type: 'LineString', coordinates: [arc.arrTangentWgs, joinWgs] },
  })
  elements.push(...(arc.reverseArr
    ? arrTrack.elements.slice(0, arr.elIdx).reverse().map(reverseElement)
    : arrTrack.elements.slice(arr.elIdx + 1).map(el => ({ ...el }))))
  return { elements, reverseArr: arc.reverseArr }
}

/**
 * The splice as one commit: both tracks go, the merged one — the departure
 * track's metadata, a new id — comes, and the switches and end marks on them
 * follow it. The departure track is cut behind its picked element and the
 * arrival track likewise, so the two ends beyond the cuts are gone — whatever
 * stood on them (a buffer stop) goes with them.
 *
 * Returns the argument for commitSwitchConnection, or null without a solution.
 */
export function buildSplice({ tracks, dep, arr, splice, speed, cant, clothoidEnabled, newId = generateId }) {
  const arc = splice?.result
  const depTrack = tracks.find(t => t.id === dep.trackId)
  const arrTrack = tracks.find(t => t.id === arr.trackId)
  if (!arc || !depTrack || !arrTrack) return null
  const { elements, reverseArr } = arc.elements
    ? readyChain(arc, dep, arr, depTrack, arrTrack, speed)
    : arcChain(arc, dep, arr, depTrack, arrTrack, { speed, cant, clothoidEnabled })
  const id = newId()
  const merged = recalcAbsLengths(elements)
  const heights = spliceHeights(depTrack, dep.elIdx)
  const { heights: _h, ...meta } = depTrack
  return {
    removeTrackIds: [dep.trackId, arr.trackId],
    addTracks: [{ ...meta, id, elements: merged, coordinates: rebuildCoords(merged), ...(heights ? { heights } : {}) }],
    remap: [{ oldId: dep.trackId, newId: id }, { oldId: arr.trackId, newId: id, flip: reverseArr }],
    consumed: [
      { trackId: dep.trackId, endpoint: 'END' },
      { trackId: arr.trackId, endpoint: reverseArr ? 'END' : 'BEGIN' },
    ],
  }
}
