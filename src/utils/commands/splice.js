import { generateId } from '../identifierUtils'
import { rebuildCoords, recalcAbsLengths, trackLabel } from '../trackModel'
import { resolveEndBearing, reverseElement, nodeUtm } from '../elementUtils'
import { reconstructElements } from '../elementReconstruct'
import { cantSign } from '../rules/cant'
import { truncateHeights } from '../heightUtils'

// Splicing two tracks into one (R5.5, AP 12.4): what a picked element offers
// the splice, the request the service builds the construction from, and the
// commit that merges the two tracks around the chain it answers with. The
// construction itself lives in the optimizer service (olt_optimizer/splice.py)
// and nowhere else; what is here is pure, so the dialog only collects the
// settings and the tests call the same functions.

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
 * The request for the service's `POST /splice`: the two picks — their ends in
 * the shared plane, the bearing at the picked end, the signed radius — and the
 * settings. The service decides the case from the radii: two straights take
 * `radius` and the transitions, two arcs a straight between them (with the
 * transitions) or with `arcJoin` 'transition' one transition from arc to arc,
 * an arc and a straight a new arc of `radius`.
 */
export function spliceRequest(dep, arr, { radius, clothoidEnabled, clothoidDep, clothoidArr, transitionType, arcJoin }) {
  const ends = (p) => ({
    start: [p.startUtm.easting, p.startUtm.northing],
    end: [p.endUtm.easting, p.endUtm.northing],
    bearing: p.bearing,
    radius: p.signedR,
  })
  return {
    dep: ends(dep), arr: ends(arr),
    radius: Math.abs(Number(radius)) || 0,
    lDep: clothoidEnabled ? Number(clothoidDep) || 0 : 0,
    lArr: clothoidEnabled ? Number(clothoidArr) || 0 : 0,
    transition: transitionType ?? 'clothoid',
    arcJoin: arcJoin ?? 'straight',
  }
}

/**
 * The service's answer as the dialog and the commit read it: { result, arcMode,
 * Ld, La } — `result` holding the chain with its display geometry rebuilt in
 * the track's plane (`epsg`), the preview line and what the service says about
 * it (arcLength, straightLength, transitionLength, …) — or { error, params }
 * for a splice that does not fit.
 */
export function spliceFromAnswer(answer, dep, arr, { clothoidEnabled, clothoidDep, clothoidArr }) {
  if (!answer || answer.error) return { error: answer?.error ?? 'splice_error_parallel', params: answer?.params ?? {} }
  const epsg = dep.epsg
  const elements = reconstructElements(answer.elements.map(el => ({ ...el, epsg })), epsg)
  const previewCoords = elements.reduce((acc, el, i) => {
    const c = el.renderCoords ?? el.geometry?.coordinates ?? []
    return i === 0 ? [...c] : [...acc, ...c.slice(1)]
  }, [])
  return {
    result: { ...answer.info, elements, reverseArr: answer.reverseArr, previewCoords },
    // Two arcs, or an arc and a straight: re-shaped elements and a solved
    // construction rather than an arc rounding a corner.
    arcMode: dep.signedR != null || arr.signedR != null,
    Ld: clothoidEnabled ? Number(clothoidDep) || 0 : 0,
    La: clothoidEnabled ? Number(clothoidArr) || 0 : 0,
  }
}

/**
 * The vertical alignment the merged track starts with: the departure track's,
 * cut where its last element is re-shaped — everything from there on belongs
 * to a track that did not exist before and has no gradient until one is read
 * from the terrain on request (see elevationFill).
 */
const spliceHeights = (depTrack, elIdx) => truncateHeights(depTrack.heights,
  (depTrack.elements ?? []).slice(0, elIdx).reduce((sum, el) => sum + (el.length ?? 0), 0))

/**
 * The merged chain: what stays of the departure track, the service's chain,
 * what stays of the arrival track. The chain's re-shaped ends keep what their
 * elements carried — speed, a re-signed cant — while what the splice inserts
 * takes the dialog's speed, and an inserted arc its cant.
 */
function mergedChain(chain, reverseArr, dep, arr, depTrack, arrTrack, { speed, cant }) {
  const depOrig = depTrack.elements[dep.elIdx]
  const arrOrig = arrTrack.elements[arr.elIdx]
  // The arrival is folded in reversed (a corner, every arc case) or run on in
  // its own direction (a continuation of two straights).
  const arrBase = reverseArr ? reverseElement(arrOrig) : arrOrig
  const plane = ({ role: _role, ...el }) => el
  const keepCant = (el, orig) => (orig?.cant != null && el.radius != null
    ? { cant: cantSign(el.radius) * Math.abs(orig.cant) } : {})
  const mid = chain.map(el => {
    if (el.role === 'dep') return { ...depOrig, ...plane(el), ...keepCant(el, depOrig) }
    if (el.role === 'arr') return { ...arrBase, ...plane(el), ...keepCant(el, arrOrig) }
    const inserted = { ...plane(el), speed }
    return el.elementType === 1 ? { ...inserted, cant: cantSign(el.radius) * Math.abs(cant) } : inserted
  })
  return [
    ...depTrack.elements.slice(0, dep.elIdx).map(el => ({ ...el })),
    ...mid,
    ...(reverseArr
      ? arrTrack.elements.slice(0, arr.elIdx).reverse().map(reverseElement)
      : arrTrack.elements.slice(arr.elIdx + 1).map(el => ({ ...el }))),
  ]
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
export function buildSplice({ tracks, dep, arr, splice, speed, cant, newId = generateId }) {
  const result = splice?.result
  const depTrack = tracks.find(t => t.id === dep.trackId)
  const arrTrack = tracks.find(t => t.id === arr.trackId)
  if (!result?.elements || !depTrack || !arrTrack) return null
  const { reverseArr } = result
  const elements = mergedChain(result.elements, reverseArr, dep, arr, depTrack, arrTrack, { speed, cant })
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
