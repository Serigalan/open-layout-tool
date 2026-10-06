import { generateId } from '../identifierUtils'
import { rebuildCoords, recalcAbsLengths, trackLabel } from '../trackModel'
import { resolveEndBearing, reverseElement, nodeUtm } from '../elementUtils'
import { reconstructElements } from '../elementReconstruct'
import { cantSign, AUTO_CANT_MODEL } from '../rules/cant'
import { minElementLength } from '../rules/elementLength'
import { reverseHeights, splitHeights, trackLength } from '../heightUtils'
import { elementStations, pointOnElement } from '../platformUtils'
import { sectionAtStation } from '../crossSectionUtils'
import { transformPlanePoint } from '../coordinateUtils'

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
    // Signed as stored; the spacing to a neighbour reads it on what the arc keeps.
    cant: el.cant ?? 0,
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
export function spliceRequest(dep, arr, { radius, clothoidEnabled, clothoidDep, clothoidArr, transitionType, arcJoin }, clearance = null) {
  const ends = (p) => ({
    start: [p.startUtm.easting, p.startUtm.northing],
    end: [p.endUtm.easting, p.endUtm.northing],
    bearing: p.bearing,
    radius: p.signedR,
    cant: Math.abs(p.cant ?? 0),
  })
  return {
    dep: ends(dep), arr: ends(arr),
    radius: Math.abs(Number(radius)) || 0,
    lDep: clothoidEnabled ? Number(clothoidDep) || 0 : 0,
    lArr: clothoidEnabled ? Number(clothoidArr) || 0 : 0,
    transition: transitionType ?? 'clothoid',
    arcJoin: arcJoin ?? 'straight',
    ...(clearance ? { clearance } : {}),
  }
}

/** Step of the neighbour's axis handed to the service [m]. */
const AXIS_STEP = 1
/** How far around the two picked elements the neighbour's axis is handed over [m]. */
const AXIS_MARGIN = 150

/**
 * The axis of the track a splice keeps its distance to, as the service reads
 * it: [easting, northing, cant] every metre, in the plane of the splice
 * (`epsg`), the cant signed as stored and as it holds at that station
 * (ramping over a transition) — only where it lies near the two picked
 * elements, so the request stays small however long the track is.
 */
export function neighbourAxis(track, epsg, dep, arr) {
  const corners = [dep.startUtm, dep.endUtm, arr.startUtm, arr.endUtm]
  const e0 = Math.min(...corners.map(p => p.easting)) - AXIS_MARGIN
  const e1 = Math.max(...corners.map(p => p.easting)) + AXIS_MARGIN
  const n0 = Math.min(...corners.map(p => p.northing)) - AXIS_MARGIN
  const n1 = Math.max(...corners.map(p => p.northing)) + AXIS_MARGIN
  const out = []
  // Each element from its first step on — its start is the end of the one before.
  elementStations(track).forEach((row, k) => {
    const len = row.el.length ?? 0
    const n = Math.max(1, Math.ceil(len / AXIS_STEP))
    for (let i = k === 0 ? 0 : 1; i <= n; i++) {
      const s = len * i / n
      const { utm } = pointOnElement(row.el, track.epsg, s)
      const [e, no] = Number(track.epsg) === Number(epsg)
        ? [utm.easting, utm.northing]
        : transformPlanePoint(utm.easting, utm.northing, track.epsg, epsg)
      if (e < e0 || e > e1 || no < n0 || no > n1) continue
      const cant = sectionAtStation(track, row.start + s)?.cant ?? 0
      out.push([Math.round(e * 1000) / 1000, Math.round(no * 1000) / 1000, Math.round(cant * 10) / 10])
    }
  })
  return out
}

/**
 * The spacing a splice is held to (the `clearance` of its request): the
 * neighbour's axis, the minimum spacing `dMin` [m], the half clearance outline
 * of the project's profile, and either the cant of the new arc (checked at
 * the dialog's radius) or, with `maximize`, the speed the service proposes the
 * cant from for every radius it tries — and the shortest arc it may insert
 * there (LP.EL.01).
 */
export function clearanceRequest({ axis, dMin, profile, maximize, speed, cant }) {
  return {
    ref: axis, dMin: Number(dMin), profile,
    cant: Math.abs(Number(cant) || 0),
    maximize: !!maximize, speed: Number(speed) || 0,
    cantModel: AUTO_CANT_MODEL,
    lMin: minElementLength(Number(speed)) ?? 0,
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

const lengthOf = (els) => els.reduce((sum, el) => sum + (el.length ?? 0), 0)
const NODE_TOL = 1e-3      // m — two nodes this close are the same
const STATION_TOL = 1e-6   // m — heightUtils' own

const sameNode = (a, b) => Array.isArray(a) && Array.isArray(b)
  && Math.abs(a[0] - b[0]) < NODE_TOL && Math.abs(a[1] - b[1]) < NODE_TOL

/**
 * How much of a picked element its re-shaped piece still runs over [m]: the
 * piece starts on the element's own node `node` and has its curvature, so it
 * lies on the element over the shorter of the two. 0 where it does not.
 */
function overlapOf(piece, orig, node, pieceNode) {
  if (!piece || !sameNode(piece[pieceNode], node)) return 0
  if (Math.abs(Math.abs(piece.radius ?? 0) - Math.abs(orig.radius ?? 0)) > 1e-6) return 0
  return Math.min(piece.length ?? 0, orig.length ?? 0)
}

/** A point the merged gradient meets the splice at: a plain point, no curve. */
const plain = ({ rv: _rv, ...p }) => p

/**
 * The vertical alignment of the merged track: the departure track's gradient
 * as far as the merged track still runs over it, the arrival track's from
 * where it does again, and between the two a single straight gradient from
 * the one to the other — no point in between and no vertical curve at either
 * end (decision 171). The stretch the splice inserts has no gradient of its
 * own, so it takes the one that joins the two.
 *
 * Where only one of the tracks has a gradient up to its cut, the merged track
 * keeps that one alone: nothing is made up for the other's side (decision 64).
 */
function spliceHeights({ depTrack, arrTrack, dep, arr, chain, reverseArr, mergedLength }) {
  const depOrig = depTrack.elements[dep.elIdx]
  const arrOrig = arrTrack.elements[arr.elIdx]
  const depPiece = chain.find(el => el.role === 'dep')
  const arrPiece = [...chain].reverse().find(el => el.role === 'arr')
  // The departure's gradient up to where the merged track leaves its element.
  const depKeep = lengthOf(depTrack.elements.slice(0, dep.elIdx))
    + overlapOf(depPiece, depOrig, depOrig.startNode, 'startNode')
  // The arrival's from where the merged track runs on it again: its far end in
  // travel, which is its start where it is folded in reversed.
  const arrRest = reverseArr ? arrTrack.elements.slice(0, arr.elIdx) : arrTrack.elements.slice(arr.elIdx + 1)
  const arrKeep = lengthOf(arrRest)
    + overlapOf(arrPiece, arrOrig, reverseArr ? arrOrig.startNode : arrOrig.endNode, 'endNode')
  const offset = mergedLength - arrKeep

  const reaches = (h, station) => h?.length && Math.abs(h[h.length - 1].station - station) < STATION_TOL
  const starts  = (h, station) => h?.length && Math.abs(h[0].station - station) < STATION_TOL
  const depH = splitHeights(depTrack.heights, depKeep)[0]
  let arrH
  if (reverseArr) {
    const [part] = splitHeights(arrTrack.heights, arrKeep)
    arrH = part && reverseHeights(part, arrKeep)
  } else {
    arrH = splitHeights(arrTrack.heights, trackLength(arrTrack) - arrKeep)[1]
  }
  arrH = arrH?.map(p => ({ ...p, station: p.station + offset }))

  const depOk = reaches(depH, depKeep) && depH.length >= 2
  const arrOk = starts(arrH, offset) && arrH.length >= 2
  if (depOk && arrOk) return [...depH.slice(0, -1), plain(depH.at(-1)), plain(arrH[0]), ...arrH.slice(1)]
  if (depH?.length >= 2) return depH
  if (arrH?.length >= 2) return arrH
  return undefined
}

/**
 * The merged chain: what stays of the departure track, the service's chain,
 * what stays of the arrival track. The chain's re-shaped ends keep what their
 * elements carried — speed, a re-signed cant — while what the splice inserts
 * takes the dialog's speed, and an inserted arc its cant.
 */
function mergedChain(chain, reverseArr, dep, arr, depTrack, arrTrack, { speed, cant }) {
  const depOrig = depTrack.elements[dep.elIdx]
  const arrOrig = arrTrack.elements[arr.elIdx]
  // The arrival is folded in reversed (a corner) or run on in its own
  // direction (a continuation) — the service says which.
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
  const heights = spliceHeights({
    depTrack, arrTrack, dep, arr, chain: result.elements, reverseArr, mergedLength: lengthOf(merged),
  })
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
