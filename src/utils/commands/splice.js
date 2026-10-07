import { generateId } from '../identifierUtils'
import { rebuildCoords, recalcAbsLengths, trackLabel } from '../trackModel'
import { resolveEndBearing, reverseElement, nodeUtm } from '../elementUtils'
import { reconstructElements } from '../elementReconstruct'
import { cantSign, AUTO_CANT_MODEL } from '../rules/cant'
import { lengthRuleFormula } from '../rules/transitionLength'
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

const lengthOf = (els) => els.reduce((sum, el) => sum + (el.length ?? 0), 0)

/**
 * What the splice needs of a picked element: its ends in the track's plane,
 * the bearing it leaves in, its signed radius (null = straight), its length
 * and how much of its track lies before and after it — what joining it at the
 * one or the other end gives up. Returns the pick, or { error } with a
 * locale key.
 *
 * A transition is picked only at the end of its track (AP S.7), as the point
 * it ends in there: no length, its bearing and curvature at that end, and
 * `joinAt` that end — the splice builds on from it and leaves it as it is
 * (`virtual`). Inside a track its curvature is not one to continue.
 */
export function splicePick(track, elIdx) {
  const el = track?.elements?.[elIdx]
  if (!el) return null
  const last = elIdx === track.elements.length - 1
  if (el.elementType === 2 && !last && elIdx !== 0) return { error: 'splice_hint_transition_end' }
  const coords = el.geometry.coordinates
  const epsg = track.epsg
  const base = {
    trackId: track.id, elIdx, epsg, label: trackLabel(track),
    // Signed as stored; the spacing to a neighbour reads it on what the arc keeps.
    cant: el.cant ?? 0,
    speed: el.speed ?? 0,
  }
  if (el.elementType === 2) {
    const side = last ? 'end' : 'start'
    const at = side === 'end'
      ? nodeUtm(el.endNode, coords[coords.length - 1], epsg)
      : nodeUtm(el.startNode, coords[0], epsg)
    const total = lengthOf(track.elements)
    return {
      ...base, virtual: side, joinAt: side, startUtm: at, endUtm: at,
      bearing: side === 'end' ? resolveEndBearing(el, epsg) : el.bearing,
      signedR: (side === 'end' ? el.r2 : el.r1) ?? null,
      length: 0, before: side === 'end' ? total : 0, after: side === 'end' ? 0 : total,
    }
  }
  return {
    ...base,
    endUtm: nodeUtm(el.endNode, coords[coords.length - 1], epsg),
    startUtm: nodeUtm(el.startNode, coords[0], epsg),
    bearing: resolveEndBearing(el, epsg),
    signedR: el.radius != null ? el.radius : null,
    length: el.length ?? 0,
    before: lengthOf(track.elements.slice(0, elIdx)),
    after: lengthOf(track.elements.slice(elIdx + 1)),
  }
}

/**
 * What stays of a pick's track toward its start, and toward its end, beside
 * the stretch the splice writes — as stored. A transition picked at the end
 * of its track stays with it (AP S.7); a picked straight or arc is re-shaped
 * by the splice and comes back in its chain.
 */
const towardStart = (track, pick) => track.elements.slice(0, pick.elIdx + (pick.virtual ? 1 : 0))
const towardEnd = (track, pick) => track.elements.slice(pick.elIdx + (pick.virtual ? 0 : 1))

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
 * The request for the service's `POST /splice`: the two picks in the order
 * they were clicked — their ends in the shared plane, the bearing at the end,
 * the signed radius, cant and speed, their length and what of their track
 * lies either side —
 * and the settings. Which ends meet and which pick departs is the service's
 * to find (olt_optimizer/splice.py, AP S.2). The transition beside each pick,
 * in the same order, has a mode (AP S.3): 'regular' or 'minimum' — the
 * service sets the Regellänge or Mindestlänge in the chain it solves, from
 * `transitions` [m] on — or 'fixed', `transitions` as they are. `speed` is
 * the design speed of what the splice inserts, `cant` that of a new arc. The service decides the case from the
 * radii: two straights take `radius` and the transitions, two arcs a straight
 * between them (with the transitions) or with `arcJoin` 'transition' one
 * transition from arc to arc, an arc and a straight a new arc of `radius`.
 */
export function spliceRequest(first, second, {
  radius, speed, cant, clothoidEnabled, transitions = [0, 0], modes = ['fixed', 'fixed'], transitionType, arcJoin,
}, clearance = null) {
  const ends = (p) => ({
    start: [p.startUtm.easting, p.startUtm.northing],
    end: [p.endUtm.easting, p.endUtm.northing],
    bearing: p.bearing,
    radius: p.signedR,
    cant: Math.abs(p.cant ?? 0),
    speed: p.speed ?? 0,
    length: p.length ?? 0,
    before: p.before ?? 0,
    after: p.after ?? 0,
    ...(p.joinAt ? { joinAt: p.joinAt } : {}),
  })
  return {
    dep: ends(first), arr: ends(second),
    radius: Math.abs(Number(radius)) || 0,
    speed: Number(speed) || 0,
    cant: Math.abs(Number(cant) || 0),
    lDep: clothoidEnabled ? Number(transitions[0]) || 0 : 0,
    lArr: clothoidEnabled ? Number(transitions[1]) || 0 : 0,
    modeDep: clothoidEnabled ? modes[0] : 'fixed',
    modeArr: clothoidEnabled ? modes[1] : 'fixed',
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

/** A transition's lengths as the service gives them, each rule on them with its formula (rules/transitionLength). */
const withFormulas = (l) => ({
  ...l,
  regularBy: (l.regularBy ?? []).map(b => ({ ...b, formula: lengthRuleFormula(b.id, 'ok') })),
  minimumBy: (l.minimumBy ?? []).map(b => ({ ...b, formula: lengthRuleFormula(b.id, 'warning') })),
})

/**
 * The service's answer as the dialog and the commit read it: { solutions },
 * the best first (Entscheidung 180), each { dep, arr, result } — `dep` and
 * `arr` the two picks in the order the solution runs, `result` the chain with
 * its display geometry rebuilt in the track's plane, the preview line, how it
 * runs (depPick, reverseDep, reverseArr, ends, rebuilt; for two arcs arcJoin and
 * whether that is the `alternative` to the way asked for), the transition beside each
 * pick ({ mode, length } and the rules on it, `lengths`), what the rule
 * catalogue finds on the whole stretch (`findings` as { at, index, id,
 * severity } by element of `elements`, `worst`, `judged`) and what the service
 * says about it (arcLength, straightLength, transitionLength, …) — or { error,
 * params } for a splice that does not fit.
 */
export function spliceFromAnswer(answer, picks) {
  if (!answer || answer.error || !answer.solutions?.length) {
    return { error: answer?.error ?? 'splice_error_parallel', params: answer?.params ?? {} }
  }
  const epsg = picks[0].epsg
  return {
    // Where only the other way of joining two arcs fits: why the way asked for does not.
    requested: answer.requested ?? null,
    solutions: answer.solutions.map(sol => {
      const elements = reconstructElements(sol.elements.map(el => ({ ...el, epsg })), epsg)
      const previewCoords = elements.reduce((acc, el, i) => {
        const c = el.renderCoords ?? el.geometry?.coordinates ?? []
        return i === 0 ? [...c] : [...acc, ...c.slice(1)]
      }, [])
      return {
        dep: picks[sol.depPick], arr: picks[1 - sol.depPick],
        result: {
          ...sol.info, elements, previewCoords,
          depPick: sol.depPick, reverseDep: !!sol.reverseDep, reverseArr: !!sol.reverseArr, ends: sol.ends,
          rebuilt: sol.rebuilt, findings: sol.findings ?? [], worst: sol.worst ?? 'ok', judged: !!sol.judged,
          arcJoin: sol.arcJoin ?? null, alternative: !!sol.alternative,
          lengths: (sol.lengths ?? []).map(withFormulas),
        },
      }
    }),
  }
}

const NODE_TOL = 1e-3   // m — two nodes this close are the same

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
 * A gradient that stops short of its cut — an element's length edited
 * behind its last point — is joined from where it stops: the straight
 * gradient runs from its last point to the other's first. Where only one of
 * the tracks has a gradient at all, the merged track keeps that one alone.
 */
function spliceHeights({ depTrack, arrTrack, dep, arr, chain, reverseDep, reverseArr, mergedLength }) {
  const depOrig = depTrack.elements[dep.elIdx]
  const arrOrig = arrTrack.elements[arr.elIdx]
  const depPiece = chain.find(el => el.role === 'dep')
  const arrPiece = [...chain].reverse().find(el => el.role === 'arr')
  // The departure's gradient up to where the merged track leaves its element:
  // from its far end in travel, which is its end where it departs backwards.
  const depRest = reverseDep ? towardEnd(depTrack, dep) : towardStart(depTrack, dep)
  const depKeep = lengthOf(depRest)
    + (dep.virtual ? 0 : overlapOf(depPiece, depOrig, reverseDep ? depOrig.endNode : depOrig.startNode, 'startNode'))
  // The arrival's from where the merged track runs on it again: its far end in
  // travel, which is its start where it is folded in reversed.
  const arrRest = reverseArr ? towardStart(arrTrack, arr) : towardEnd(arrTrack, arr)
  const arrKeep = lengthOf(arrRest)
    + (arr.virtual ? 0 : overlapOf(arrPiece, arrOrig, reverseArr ? arrOrig.startNode : arrOrig.endNode, 'endNode'))
  const offset = mergedLength - arrKeep

  const depHeights = reverseDep ? reverseHeights(depTrack.heights, trackLength(depTrack)) : depTrack.heights
  const depH = splitHeights(depHeights, depKeep)[0]
  let arrH
  if (reverseArr) {
    const [part] = splitHeights(arrTrack.heights, arrKeep)
    arrH = part && reverseHeights(part, arrKeep)
  } else {
    arrH = splitHeights(arrTrack.heights, trackLength(arrTrack) - arrKeep)[1]
  }
  arrH = arrH?.map(p => ({ ...p, station: p.station + offset }))

  const depOk = depH?.length >= 2
  const arrOk = arrH?.length >= 2
  if (depOk && arrOk) return [...depH.slice(0, -1), plain(depH.at(-1)), plain(arrH[0]), ...arrH.slice(1)]
  if (depOk) return depH
  if (arrOk) return arrH
  return undefined
}

/**
 * The merged chain: what stays of the departure track, the service's chain,
 * what stays of the arrival track. A track run against its own direction —
 * the departure where it departs from its start, the arrival where it is met
 * at its end — comes in reversed. The chain's re-shaped ends keep what their
 * elements carried — speed, a re-signed cant — while what the splice inserts
 * takes the dialog's speed, and an inserted arc its cant.
 */
function mergedChain({ dep, arr, result }, depTrack, arrTrack, { speed, cant }) {
  const { elements: chain, reverseDep, reverseArr } = result
  const depOrig = depTrack.elements[dep.elIdx]
  const arrOrig = arrTrack.elements[arr.elIdx]
  const depBase = reverseDep ? reverseElement(depOrig) : depOrig
  const arrBase = reverseArr ? reverseElement(arrOrig) : arrOrig
  // The plane geometry of the answer; the service's speed and cant on it are
  // what it judged the chain with, and the same as these, but the app's own
  // elements are what they come from.
  const plane = ({ role: _role, speed: _speed, cant: _cant, ...el }) => el
  const keepCant = (el, orig) => (orig?.cant != null && el.radius != null
    ? { cant: cantSign(el.radius) * Math.abs(orig.cant) } : {})
  // What is built on from a transition picked at its track's end is new, with
  // that transition's speed and the cant of its curvature (AP S.7).
  const builtOn = (el, pick) => ({
    ...plane(el), speed: pick.speed,
    ...(el.elementType === 1 ? { cant: cantSign(el.radius) * Math.abs(pick.cant ?? 0) } : {}),
  })
  const mid = chain.map(el => {
    if (el.role === 'dep') return dep.virtual ? builtOn(el, dep) : { ...depBase, ...plane(el), ...keepCant(el, depOrig) }
    if (el.role === 'arr') return arr.virtual ? builtOn(el, arr) : { ...arrBase, ...plane(el), ...keepCant(el, arrOrig) }
    const inserted = { ...plane(el), speed }
    return el.elementType === 1 ? { ...inserted, cant: cantSign(el.radius) * Math.abs(cant) } : inserted
  })
  return [
    ...(reverseDep
      ? towardEnd(depTrack, dep).reverse().map(reverseElement)
      : towardStart(depTrack, dep).map(el => ({ ...el }))),
    ...mid,
    ...(reverseArr
      ? towardStart(arrTrack, arr).reverse().map(reverseElement)
      : towardEnd(arrTrack, arr).map(el => ({ ...el }))),
  ]
}

/**
 * The splice as one commit: both tracks go, the merged one — a new id, the
 * metadata of the track that keeps its direction (of the departure where both
 * do) — comes, and the switches and end marks on them follow it. Each track
 * is cut behind its picked element, on the side away from the splice, so the
 * two ends beyond the cuts are gone — whatever stood on them (a buffer stop)
 * goes with them.
 *
 * Returns the argument for commitSwitchConnection, or null without a solution.
 */
export function buildSplice({ tracks, solution, speed, cant, newId = generateId }) {
  const depTrack = tracks.find(t => t.id === solution?.dep?.trackId)
  const arrTrack = tracks.find(t => t.id === solution?.arr?.trackId)
  if (!solution?.result?.elements || !depTrack || !arrTrack) return null
  const { dep, arr, result: { elements: chain, reverseDep, reverseArr } } = solution
  const elements = mergedChain(solution, depTrack, arrTrack, { speed, cant })
  const id = newId()
  const merged = recalcAbsLengths(elements)
  const heights = spliceHeights({
    depTrack, arrTrack, dep, arr, chain, reverseDep, reverseArr, mergedLength: lengthOf(merged),
  })
  const { heights: _h, ...meta } = reverseDep ? arrTrack : depTrack
  return {
    removeTrackIds: [dep.trackId, arr.trackId],
    addTracks: [{ ...meta, id, elements: merged, coordinates: rebuildCoords(merged), ...(heights ? { heights } : {}) }],
    remap: [{ oldId: dep.trackId, newId: id, flip: reverseDep }, { oldId: arr.trackId, newId: id, flip: reverseArr }],
    consumed: [
      { trackId: dep.trackId, endpoint: reverseDep ? 'BEGIN' : 'END' },
      { trackId: arr.trackId, endpoint: reverseArr ? 'END' : 'BEGIN' },
    ],
  }
}
