import { generateId, buildTypeFields } from '../identifierUtils'
import { recalcAbsLengths } from '../trackModel'
import { computeCurvedValuesUtm, computeStraightValuesUtm } from '../elementUtils'
import { splitElementAt, splitTrackAtJoint, carveSwitchRoute } from '../trackSplitUtils'
import {
  computeCrossingGeometryUtm, crossingElements, crossingLegFitsTrack, crossingLegRadius, crossingLegSignedRadius, piecesOnRadius,
} from '../switch/crossing'
import { computeSwitchGeometryUtm } from '../switch/symbol'
import { switchRouteVaries } from '../switch/route'
import { elementBelongsToSwitch, newSwitchFields, switchElementMark } from '../switchModel'
import { cantExceptionFields, worstCantOf } from '../rules/cant'
import { placeSwitchOnTrack } from '../switchPlacement'
import { trackLength } from '../heightUtils'
import { utmToWgs84 } from '../coordinateUtils'
import { arcElement, straightElement } from '../elementFactory'

// What the switch dialogs commit (R4.2), as pure functions of their inputs —
// each the argument for commitSwitchConnection, one undo step. The dialog
// checks names and claims the switch number; what is left here is the
// construction, and the refusals that come out of it.

/** Track the toe must leave behind it, or the split would part off next to nothing [m]. */
const MIN_BEHIND = 0.5

/**
 * Where a turnout laid into `track` at `toeStation` lies, and the geometry it
 * produces (SwitchOnTrackForm's preview and commit read the same) — read in
 * the track's own plane from the elements' stored nodes; the WGS84 twin of the
 * toe is derived for the display and never converted back.
 *
 * Returns { error: null } before there is a station, { error: { key, params } }
 * where the turnout cannot go there, else { error: null, place, plain, geom }.
 */
export function switchOnTrackPlacement({ track, toeStation, reversed, sw, side, straightLen }) {
  if (!track || !Number.isFinite(toeStation)) return { error: null }
  const noRoom = { key: 'switch_on_track_no_room' }
  const total  = trackLength(track)
  if (toeStation < 0 || toeStation > total) return { error: { key: 'switch_on_track_outside' } }
  if ((reversed ? total - toeStation : toeStation) <= MIN_BEHIND) return { error: noRoom }
  const place = placeSwitchOnTrack(track, toeStation, reversed, straightLen)
  if (place.error) return { error: { key: place.error } }
  // A symmetrical turnout has no straight side: unbent, its through route is
  // the branch's mirror arc, so that is what the track it is carved from has
  // to be — on anything else the turnout would stand beside its own through
  // route. On it, it is the ordinary unbent form.
  if (sw.symmetric && !piecesOnRadius(place.pieces, side === 'left' ? sw.R : -sw.R)) {
    return { error: { key: 'switch_on_track_symmetric', params: { r: String(sw.R) } } }
  }
  // On nothing but straights the turnout is the ordinary, unbent one.
  const plain  = sw.symmetric || place.pieces.every(p => p.r1 == null && p.r2 == null)
  const toeWgs = utmToWgs84(place.toeUtm.easting, place.toeUtm.northing, track.epsg)
  return {
    error: null, place, plain,
    geom: computeSwitchGeometryUtm(place.toeUtm, place.bearing, sw, side, false, toeWgs,
      plain ? null : place.pieces),
  }
}

/** Branch element from a piece of the branch with one radius (or none). */
function constantBranchElement(seg, cant) {
  const r  = seg.r1
  const bv = r
    ? computeCurvedValuesUtm(seg.startUtm, seg.endUtm, r)
    : computeStraightValuesUtm(seg.startUtm, seg.endUtm)
  return {
    elementType: r ? 1 : 0,
    startNode: bv.startNode, endNode: bv.endNode,
    bearing: bv.bearing,
    length: bv.length, absLength: bv.length,
    ...(r ? { endBearing: bv.endBearing, radius: r } : {}),
    cant,
  }
}


/**
 * The commit of "switch on track" (SwitchOnTrackForm, R4.2): the host track
 * parted at the toe, its through route carved and marked, the branch as a new
 * track, and the record — the argument for commitSwitchConnection, or
 * { noRoom } (the through length) where the route finds no room on the track.
 *
 * `place` and `g` are the dialog's placement (placeSwitchOnTrack) and the
 * turnout geometry it settled on; `plain` whether the turnout is the unbent
 * form; `tracks` the project's, for the names a split may take.
 */
export function buildSwitchOnTrack({
  track, tracks, place, g, plain, sw, straightLen, cant, cantReason, speed,
  switchName, switchNumber, name, fields,
}) {
  const existingNames = new Set(tracks.map(tr => tr.name).filter(Boolean))
  // Part the track at the toe (in the plane): on the joint it falls on, or
  // inside its element — an arc keeps its radius, a clothoid is cut at the
  // toe's station into two clothoids of its own parameter.
  const split = place.joint != null
    ? splitTrackAtJoint(track, place.joint, place.bearing, existingNames)
    : splitElementAt(track, place.elIdx,
      place.cutsClothoid ? { ...place.toeUtm, station: place.s } : place.toeUtm, place.bearing, existingNames)

  // The turnout's through route is the host track's own geometry, so it stays
  // in that track — as the elements it covers, the last one cut at the switch
  // end, all marked like the branch. A switch is its two routes everywhere it
  // is built.
  // The identity the record and the elements of both routes share: the id ties
  // them together, and it has to exist before the first element is marked.
  const identity = { ...newSwitchFields(), name: switchName, label: sw.label }
  const mainMark = switchElementMark(identity, 'main')
  const carved = carveSwitchRoute(split.ahead, split.aheadEndpoint, place.endUtm, mainMark, straightLen)
  if (!carved) return { noRoom: straightLen }
  // A cant over the plain switch limit stands on the reason typed for it, and
  // the reason belongs on the element that carries the cant — otherwise the
  // element table flags as an error what this dialog just accepted. Only the
  // elements over the limit get one: a stale reason on the rest would say a
  // turnout runs on an exception it does not need.
  const justify = (el) => ({ ...el, ...cantExceptionFields(worstCantOf(el), cantReason) })
  // The through route is the host track's own elements, carved and marked here.
  const carvedRoute = {
    ...carved,
    elements: carved.elements.map(el => (elementBelongsToSwitch(el, identity) ? justify(el) : el)),
  }
  const splitTracks = split.tracks.map(tr => (tr.id === carved.id ? carvedRoute : tr))

  // Diverging branch: the turnout's own branch as a new track, one element per
  // piece — where the elements under the turnout part, the branch parts too.
  // Each is built from its ends in the plane, so the first starts on the
  // junction node exactly and every joint is shared. Bent to the far side of
  // a curve a piece can come out straight — then it is one; over a clothoid
  // it is a clothoid, whose cant ramps with the track's.
  const branchId = generateId()
  const branchEls = recalcAbsLengths(g.branchSegments.map((seg, i) => {
    const base = switchRouteVaries(seg)
      ? {
          elementType: 2, transitionType: 'clothoid', r1: seg.r1, r2: seg.r2,
          startNode: [seg.startUtm.easting, seg.startUtm.northing],
          endNode:   [seg.endUtm.easting, seg.endUtm.northing],
          bearing: seg.bearing, endBearing: seg.endBearing,
          length: seg.length,
          cantStart: place.cantAt(seg.s0, i), cantEnd: place.cantAt(seg.s0 + seg.length, i),
        }
      : constantBranchElement(seg, plain ? cant : place.cantAt(seg.s0, i))
    return justify({
      ...base,
      ...switchElementMark(identity, 'branch'),
      geometry: { type: 'LineString', coordinates: seg.coords },
    })
  }))
  const branchTrack = {
    id: branchId,
    name,
    owner: fields.owner,
    ...buildTypeFields(fields),
    epsg: track.epsg,
    coordinates: g.arcCoords,
    elements: branchEls,
  }

  // The record keeps only the ports: both routes are read back from the
  // tracks' marked elements (switchRoutesFromTracks).
  const switchRecord = {
    ...identity,
    number: switchNumber, trailing: false, speed,
    portA_trackId:  split.behind.id, portA_endpoint:  split.behindEndpoint,
    portB1_trackId: branchId,        portB1_endpoint: 'BEGIN',
    portB2_trackId: split.ahead.id,  portB2_endpoint: split.aheadEndpoint,
    fillCoords: g.fillCoords, lcsCoords: g.lcsCoords,
    labelCoords: g.labelCoords, bauform: g.bauform,
  }

  return {
    removeTrackIds: [track.id],
    addTracks:      [...splitTracks, branchTrack],
    addSwitches:    [switchRecord],
    remap: [{ oldId: track.id, newId: splitTracks.map(tr => tr.id) }],
  }
}

/** A route element of a turnout at a track end: the geometry's own polyline, no coarse one. */
function routeElement(from, to, signedR, coords, extra) {
  const base = { ...extra, geometry: { type: 'LineString', coordinates: coords } }
  const el = signedR ? arcElement(from, to, signedR, base) : straightElement(from, to, base)
  const { renderCoords: _r, ...rest } = el
  return { ...rest, absLength: el.length }
}

/**
 * The commit of a turnout at a track's end (ConnectStraightSwitchForm,
 * ConnectSwitchConnectionForm, R4.2): the through route and the branch as
 * elements, the record — the argument for commitSwitchConnection.
 *
 * Facing, the through route is a new track and the source track ends at the
 * toe (port A). Trailing, the through route is appended to the source track,
 * whose new end is the switch's far end (port B2).
 *
 * `start`, `bearing`, `startWgs` are the anchor (the track end); `stemSigned`
 * the radius of the track the turnout continues, where it is bent into it
 * (null for an unbent turnout).
 */
export function buildSwitchAtTrackEnd({
  start, bearing, startWgs, sourceTrackId, sw, side, trailing, stemSigned = null,
  cant, cantReason, speed, switchName, switchNumber, name, fields, mainName, mainFields,
}) {
  const geom = computeSwitchGeometryUtm(start, bearing, sw, side, trailing, startWgs, stemSigned)
  const { straightCoords, arcCoords, fillCoords, labelCoords, lcsCoords, signedR, mainSignedR,
    startUtm, straightUtm, arcOriginUtm, curvedUtm } = geom
  // One turnout, one cant. The through route of a trailing switch is built
  // against the direction the branch leaves the toe in, and cant is stored by
  // the raised rail, so it turns with the direction.
  const mainCant = trailing ? -cant : cant

  // The identity the record and the elements of both routes share: the id ties
  // them together, and it has to exist before the first element is marked.
  const identity = { ...newSwitchFields(), name: switchName, label: sw.label }

  // Each route is built as whatever it came out as: bent, the through route is
  // an arc on the stem radius, and the branch is the one that can be straight.
  const straightEl = routeElement(startUtm, straightUtm, mainSignedR, straightCoords, {
    ...switchElementMark(identity, 'main'),
    ...(mainSignedR ? { cant: mainCant, ...cantExceptionFields(mainCant, cantReason) } : {}),
  })
  const curvedEl = routeElement(arcOriginUtm, curvedUtm, signedR, arcCoords, {
    ...switchElementMark(identity, 'branch'),
    cant,
    ...cantExceptionFields(cant, cantReason),
  })

  const curvedTrack = { id: generateId(), name, owner: fields.owner, ...buildTypeFields(fields),
    epsg: start.zone, coordinates: arcCoords, elements: [curvedEl] }
  const straightTrack = trailing ? null : { id: generateId(), name: mainName, owner: mainFields.owner,
    ...buildTypeFields(mainFields), epsg: start.zone, coordinates: straightCoords, elements: [straightEl] }

  return {
    removeTrackIds: [],
    append: trailing ? [{ trackId: sourceTrackId, elements: [straightEl] }] : [],
    addTracks: [...(straightTrack ? [straightTrack] : []), curvedTrack],
    addSwitches: [{
      ...identity,
      number: switchNumber,
      trailing,
      speed,
      // Stem radius of a bent switch, signed away from the node — the frame the
      // symbol is rebuilt in. Absent means the through route is straight.
      ...(geom.stemAtToe ? { mainRadius: geom.stemAtToe } : {}),
      // Node position: the toe (facing) resp. the far end of the appended
      // straight (trailing). The source track ends there; both new branch
      // tracks start there.
      portA_trackId: trailing ? null : sourceTrackId,
      portA_endpoint: trailing ? null : 'END',
      portB1_trackId: curvedTrack.id,
      portB1_endpoint: 'BEGIN',
      portB2_trackId: trailing ? sourceTrackId : straightTrack.id,
      portB2_endpoint: trailing ? 'END' : 'BEGIN',
      fillCoords,
      labelCoords,
      bauform: geom.bauform,
      lcsCoords,
    }],
  }
}

/**
 * The commit of a crossing at a track's end (CrossingForm, R4.2): the main
 * route's first leg appended to the picked track — from port A to the
 * crossing point, so the join at the port is the joint the track already
 * had — the three other legs and the slip routes as new tracks, the record.
 * `g` is the crossing geometry, `anchor` { trackId, epsg } the picked end.
 */
export function buildCrossingAtTrackEnd({ g, anchor, form, switchName, switchNumber, name, fields }) {
  const identity = { ...newSwitchFields(form.kind), name: switchName, label: form.label }
  // One element per leg and per connecting route, marked with its route —
  // straight or arc as the form's geometry has it.
  const els = crossingElements(g, identity)
  // The legs run from the crossing point out to their ports, so the three new
  // ones join the appended first leg end to end there.
  const legTrack = (el, trackName = null) => ({
    id: generateId(), name: trackName, owner: fields.owner, ...buildTypeFields(fields),
    epsg: anchor.epsg, coordinates: el.geometry.coordinates, elements: recalcAbsLengths([el]),
  })
  const legC = legTrack(els.C, name)
  const legB = legTrack(els.B)
  const legD = legTrack(els.D)
  const slipTracks = [els.slip1, els.slip2].filter(Boolean).map(el => legTrack(el))
  return {
    removeTrackIds: [],
    append: [{ trackId: anchor.trackId, elements: [els.A] }],
    addTracks: [legC, legB, legD, ...slipTracks],
    addSwitches: [{
      ...identity,
      number: switchNumber,
      // Port A names the track the crossing is connected to: its end node is
      // the port, and the appended leg is the switch's own element there.
      portA_trackId: anchor.trackId, portA_endpoint: 'END',
      portB_trackId: legB.id, portB_endpoint: 'END',
      portC_trackId: legC.id, portC_endpoint: 'BEGIN',
      portD_trackId: legD.id, portD_endpoint: 'BEGIN',
      fillCoords: g.fillCoords,
    }],
  }
}

/**
 * The commit of a crossing laid into a track (CrossingOnTrackForm, R4.2): the
 * host track parted at the crossing point with the main legs carved out of
 * its halves, the cross legs and slip routes as new tracks, the record — or
 * { noRoom } (the end distance) where a main leg finds no room.
 * `ahead` is the dialog's placement of the crossing point on the host track.
 */
export function buildCrossingOnTrack({ g, ahead, track, tracks, form, endDist, switchName, switchNumber, name, fields }) {
  const existingNames = new Set(tracks.map(tr => tr.name).filter(Boolean))
  const identity = { ...newSwitchFields(form.kind), name: switchName, label: form.label }
  const mainMark = switchElementMark(identity, 'main')

  // Part the host track at the crossing point — the main route runs through
  // it, on the joint it falls on or inside its element, as a turnout's toe
  // parts it.
  const split = ahead.joint != null
    ? splitTrackAtJoint(track, ahead.joint, ahead.bearing, existingNames)
    : splitElementAt(track, ahead.elIdx, ahead.toeUtm, ahead.bearing, existingNames)

  // The legs are the crossing's own body on the host line: the elements the
  // end distance reaches out to ports A and C, carved into the halves and
  // marked 'main' — the same carve that marks a turnout's through route.
  const carvedAhead  = carveSwitchRoute(split.ahead, split.aheadEndpoint, g.portC_utm, mainMark, endDist)
  const carvedBehind = carveSwitchRoute(split.behind, split.behindEndpoint, g.portA_utm, mainMark, endDist)
  if (!carvedAhead || !carvedBehind) return { noRoom: endDist }

  // One element per cross leg and per connecting route, marked with its route
  // — the same elements the end-anchored crossing commits. The main legs are
  // the host's own, carved above.
  const els = crossingElements(g, identity)
  const tracksOf = (el, trackName = null) => ({
    id: generateId(), name: trackName, owner: fields.owner, ...buildTypeFields(fields),
    epsg: track.epsg, coordinates: el.geometry.coordinates, elements: recalcAbsLengths([el]),
  })
  const legB = tracksOf(els.B)
  const legD = tracksOf(els.D, name)
  const slipTracks = [els.slip1, els.slip2].filter(Boolean).map(el => tracksOf(el))

  // The record keeps only the ports: the main route's name the parted halves
  // of the host track — port A the one behind the point, port C the one
  // ahead, each at the end that meets it — and the cross route's name its own
  // two halves. Both routes are read back from the marked elements.
  const switchRecord = {
    ...identity,
    number: switchNumber,
    portA_trackId: carvedBehind.id, portA_endpoint: split.behindEndpoint,
    portB_trackId: legB.id, portB_endpoint: 'END',
    portC_trackId: carvedAhead.id, portC_endpoint: split.aheadEndpoint,
    portD_trackId: legD.id, portD_endpoint: 'BEGIN',
    fillCoords: g.fillCoords,
  }

  // One undo step for the whole crossing: the parted host track with its
  // carved legs, the cross legs, the slips and the record.
  return {
    removeTrackIds: [track.id],
    addTracks: [...split.tracks.map(tr => (
      tr.id === carvedAhead.id ? carvedAhead : tr.id === carvedBehind.id ? carvedBehind : tr)),
      legB, legD, ...slipTracks],
    addSwitches: [switchRecord],
    remap: [{ oldId: track.id, newId: split.tracks.map(tr => tr.id) }],
  }
}

/**
 * Where a crossing laid into `track` at `pointStation` lies — the main leg on
 * both sides of the point, read in the track's own plane — and its geometry
 * (CrossingOnTrackForm's preview and commit read the same).
 *
 * Returns { error: null } before there is a station, { error: { key, params } }
 * where it cannot go there, else { error: null, ahead, back, geom }.
 */
export function crossingOnTrackPlacement({ track, pointStation, endDist, form, crossAngle }) {
  if (!track || !Number.isFinite(pointStation)) return { error: null }
  if (pointStation < 0 || pointStation > trackLength(track)) return { error: { key: 'switch_on_track_outside' } }
  const why = (e) => ({ error: { key: e === 'switch_on_track_no_room' ? 'crossing_on_track_no_room' : e } })
  const ahead = placeSwitchOnTrack(track, pointStation, false, endDist)
  if (ahead.error) return why(ahead.error)
  const back = placeSwitchOnTrack(track, pointStation, true, endDist)
  if (back.error) return why(back.error)
  // The track under the body is its main leg, so it has to be one: straight,
  // or a Bogenkreuzungsweiche's arc — walked backwards, the same arc bends the
  // other way. Anything else would leave the geometry beside the line it
  // should be part of.
  const legR = crossingLegSignedRadius(form, crossAngle)
  if (!crossingLegFitsTrack(ahead.pieces, legR)
    || !crossingLegFitsTrack(back.pieces, legR == null ? null : -legR)) {
    return {
      error: legR == null
        ? { key: 'crossing_on_track_straight_only' }
        : { key: 'crossing_on_track_leg_arc', params: { r: String(crossingLegRadius(form)) } },
    }
  }
  return { error: null, ahead, back, geom: computeCrossingGeometryUtm(ahead.toeUtm, ahead.bearing, form, crossAngle) }
}
