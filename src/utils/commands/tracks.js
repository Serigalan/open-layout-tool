import { generateId, buildTypeFields } from '../identifierUtils'
import { rebuildCoords, recalcAbsLengths } from '../trackModel'
import { arcElement, arcFrom, straightElement, straightFrom, transitionElement } from '../elementFactory'

// What the create and connect dialogs commit (R4.2), as pure functions: the
// dialog gathers its inputs, calls one of these and writes the result — a
// track for saveTrack, or elements for addElementsToTrack. The tests call the
// same functions, so what they check is what the dialogs write.

/** A track's own fields from the dialog's TrackFields and its name. */
export function trackMeta(fields, name) {
  return { name, owner: fields.owner, ...buildTypeFields(fields) }
}

/** A track of `elements` in plane `epsg`, stations and polyline derived. */
export function trackOf(elements, epsg, meta = {}, id = generateId()) {
  const els = recalcAbsLengths(elements)
  return { id, ...meta, coordinates: rebuildCoords(els), epsg, elements: els }
}

/** LineForm: one straight between two picked points. */
export function buildLineTrack({ start, end, speed, meta, id }) {
  return trackOf([straightElement(start, end, { speed })], start.zone, meta, id)
}

/** CurvedLineForm: one arc between two points with a (fitted) radius. */
export function buildCurvedLineTrack({ start, end, signedR, speed, cant, meta, id }) {
  return trackOf([arcElement(start, end, signedR, { speed, cant })], start.zone, meta, id)
}

/** ParallelLineForm: one element offset from a picked one — an arc where it has a radius. */
export function buildParallelLineTrack({ start, end, signedR = null, speed, meta, id }) {
  const el = signedR != null ? arcElement(start, end, signedR, { speed }) : straightElement(start, end, { speed })
  return trackOf([el], start.zone, meta, id)
}

/** ParallelTrackForm: a whole track's elements offset (parallelUtils.offsetTrackElements). */
export function buildParallelTrack({ elements, epsg, meta, id }) {
  return trackOf(elements, epsg, meta, id)
}

/**
 * The transition a connect dialog puts in front of what it appends, from the
 * track's end at `start`/`bearing`, its curvature running from the last
 * element's radius to `toRadius` (null = into a straight). Null where there is
 * none to put.
 */
function leadingTransition(start, bearing, transition, toRadius, speed) {
  if (!transition || !(transition.length > 0)) return null
  return transitionElement(start, bearing, transition.length, transition.fromRadius ?? null, toRadius, {
    transitionType: transition.type ?? 'clothoid', speed,
  })
}

/**
 * ConnectStraightForm: a straight of `length` appended at a track's end
 * (`start`, `bearing`), optionally after a transition out of the last
 * element's curve — `transition` { length, type, fromRadius }.
 * Returns the elements to append, in order.
 */
export function buildConnectStraight({ start, bearing, length, speed, transition = null }) {
  const lead = transition?.fromRadius != null ? leadingTransition(start, bearing, transition, null, speed) : null
  const from = lead ? lead.endUtm : start
  const b    = lead ? lead.endBearing : bearing
  return [...(lead ? [lead.element] : []), straightFrom(from, b, length, { speed })]
}

/**
 * ConnectCurvedForm: an arc of `arcLength` and radius `signedR` appended at a
 * track's end, optionally after a transition from the last element's radius
 * into the new one. Returns the elements to append, in order.
 */
export function buildConnectCurved({ start, bearing, arcLength, signedR, speed, cant, transition = null }) {
  const lead = leadingTransition(start, bearing, transition, signedR, speed)
  const from = lead ? lead.endUtm : start
  const b    = lead ? lead.endBearing : bearing
  // The arc keeps the bearing and length it was asked for; the factory derives the rest.
  const arc  = arcFrom(from, b, arcLength, signedR, { speed, cant })
  return [...(lead ? [lead.element] : []), { ...arc, bearing: b, length: arcLength }]
}
