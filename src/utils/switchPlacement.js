import { nodeUtm, reverseElement, resolveEndBearing } from './elementUtils'
import { transitionCantEnds } from './clothoidUtils'
import { elementAtStation, pointAtStationUtm } from './heightUtils'
import { switchElementRoute, switchRouteSlice, switchRouteBearingAt } from './switchUtils'

/**
 * A toe this close to an element's end sits on the joint, and a route that ends
 * this close to one ends with the element [m] — the tolerance the carve works
 * with (see carveSwitchRoute), so both come to the same element boundaries.
 */
const JOINT_TOL = 1e-3

/** Largest change of direction at a joint under a turnout that is still none [rad]. */
const KINK_TOL = 1e-6

const DEG2RAD = Math.PI / 180
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180) * DEG2RAD

/** Why a turnout cannot lie on an element — or null where it can. */
function refusal(el) {
  if (el.switchBranch) return 'switch_on_track_over_switch'
  if (el.elementType === 2 && (el.transitionType === 'bloss' || el.r1 === undefined)) return 'switch_on_track_bloss'
  // A straight stored with a kink at its end (Verm.ESN) turns where no curve is:
  // the routes of a turnout on it would not follow the track.
  if (el.elementType !== 2 && el.radius == null && el.endBearing != null
      && angleBetween(el.endBearing, el.bearing) > KINK_TOL) return 'switch_on_track_kink'
  return null
}

/**
 * Where a turnout with the through length `length` lies on `track` when its toe
 * is at `station` along it and it opens with the track direction — or against
 * it with `reversed`. The turnout may reach over as many elements as it needs:
 * its through route is the track itself, one piece per element it covers, the
 * first and the last cut where the turnout begins and ends. Straights, arcs and
 * clothoids can carry it — a Bloss curve's pieces are no Bloss curves — and the
 * track must run through tangentially under it.
 *
 * Everything is read in the track's own plane from the elements' stored nodes:
 * the toe from the element it falls in (or the node of the joint it falls on),
 * the switch end from the element that ends it, so both lie on the track as
 * exactly as its own elements do.
 *
 * Returns { error } — a locale key — or:
 *   toeUtm, bearing   the toe and the direction the turnout opens in
 *   joint             index of the element the toe's joint is before, or null
 *   elIdx, s          otherwise the element the toe falls in and the station along it
 *   cutsClothoid      that element is a clothoid, cut at `s`
 *   pieces            the through route as a chain from the toe, `length` long
 *   spans             per piece: elIdx, s0 (station from the toe), length, from/to
 *                     (stations along the element as it runs from the toe) and the
 *                     cant at both ends, signed in the opening direction
 *   endUtm            the switch end
 *   cantAt(s, i?)     cant `s` from the toe, on span `i` where a joint is ambiguous
 */
export function placeSwitchOnTrack(track, station, reversed, length) {
  const els  = track?.elements ?? []
  const epsg = track?.epsg
  const hit  = elementAtStation(els, station)
  if (!hit) return { error: 'switch_on_track_outside' }
  const dir = reversed ? -1 : 1

  let joint = null
  if (hit.s <= JOINT_TOL) joint = hit.elIdx
  else if (hit.s >= hit.el.length - JOINT_TOL) joint = hit.elIdx + 1

  // The toe, and where the walk along the track begins: element `idx` at
  // `local`, a station along the element in its own direction.
  let idx, local, toeUtm, tangent
  if (joint != null) {
    idx = reversed ? joint - 1 : joint
    const el = els[idx]
    if (!el) return { error: 'switch_on_track_no_room' }
    const coords = el.geometry?.coordinates ?? []
    if (reversed) {
      toeUtm  = nodeUtm(el.endNode, coords[coords.length - 1], epsg)
      tangent = resolveEndBearing(el, epsg)
      local   = el.length
    } else {
      toeUtm  = nodeUtm(el.startNode, coords[0], epsg)
      tangent = el.bearing
      local   = 0
    }
  } else {
    const why = refusal(hit.el)
    if (why) return { error: why }
    idx     = hit.elIdx
    local   = hit.s
    toeUtm  = pointAtStationUtm(hit.el, local, epsg)
    tangent = switchRouteBearingAt(hit.el.bearing, switchElementRoute(hit.el), local)
  }
  const bearing = reversed ? (tangent + 180) % 360 : tangent

  const pieces = []
  const spans  = []
  let covered = 0
  let lastEndBearing = null
  while (covered < length - JOINT_TOL) {
    const el = els[idx]
    if (!el) return { error: 'switch_on_track_no_room' }
    if (el.length > 0) {
      const why = refusal(el)
      if (why) return { error: why }
      const oriented = reversed ? reverseElement(el) : el
      // Under the turnout a joint has to carry the tangent on.
      if (lastEndBearing != null && angleBetween(oriented.bearing, lastEndBearing) > KINK_TOL) {
        return { error: 'switch_on_track_kink' }
      }
      const route = switchElementRoute(oriented)
      const from  = reversed ? el.length - local : local
      const take  = Math.min(route.length - from, length - covered)
      const to    = from + take
      pieces.push(switchRouteSlice(route, from, to))

      // Cant along the element as the turnout runs over it: its own on a
      // straight or an arc, the ramp it lies in on a transition. Stored signed
      // by the raised rail, so it changes sign with the direction.
      const ramp    = el.elementType === 2 ? transitionCantEnds(els, idx) : null
      const cantOwn = (s) => (ramp ? ramp.start + (ramp.end - ramp.start) * s / el.length : (el.cant ?? 0))
      const cantRun = (s) => dir * cantOwn(reversed ? el.length - s : s)
      spans.push({ elIdx: idx, s0: covered, length: take, from, to, cantStart: cantRun(from), cantEnd: cantRun(to) })

      covered += take
      lastEndBearing = resolveEndBearing(oriented, epsg)
    }
    idx  += dir
    local = reversed ? (els[idx]?.length ?? 0) : 0
  }

  const last = spans[spans.length - 1]
  if (!last) return { error: 'switch_on_track_no_room' }
  const endEl  = els[last.elIdx]
  const endUtm = pointAtStationUtm(endEl, reversed ? endEl.length - last.to : last.to, epsg)

  const cantAt = (s, i = null) => {
    const k  = i ?? spans.findIndex(sp => s <= sp.s0 + sp.length)
    const sp = spans[k < 0 ? spans.length - 1 : k]
    return sp.length > 0
      ? sp.cantStart + (sp.cantEnd - sp.cantStart) * (s - sp.s0) / sp.length
      : sp.cantStart
  }

  return {
    toeUtm, bearing, joint,
    elIdx: joint == null ? hit.elIdx : null,
    s:     joint == null ? hit.s : null,
    cutsClothoid: joint == null && hit.el.elementType === 2,
    pieces, spans, endUtm, cantAt,
  }
}

/**
 * May a turnout be attached at the far end of element `elIdx` of `track`?
 *
 * The two "turnout at a track end" dialogs build both of their routes as new
 * geometry running forward from the node they are handed, and they hang the
 * through route on the track that node belongs to: appended to it (trailing) or
 * as the track the toe parts it from (facing). Both only hold where the node
 * *is* the track's end. Anchored inside a track, the appended element lands
 * behind elements it does not join — the chain breaks — and the port that
 * records the track's END names a node somewhere else entirely.
 *
 * A turnout inside a track is the other dialog's job (placeSwitchOnTrack): it
 * carves the through route out of the elements that are already there, instead
 * of building a second set on top of them. So the refusal here is not a
 * limitation, it is the line between the two.
 *
 * Returns the locale key of what is in the way, or null where a turnout may go.
 */
export function switchEndAnchorRefusal(track, elIdx) {
  const els = track?.elements ?? []
  const el  = els[elIdx]
  if (!el) return 'switch_anchor_no_element'
  if (elIdx !== els.length - 1) return 'switch_anchor_not_track_end'
  return null
}
