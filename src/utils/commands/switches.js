import { generateId, buildTypeFields } from '../identifierUtils'
import { recalcAbsLengths } from '../trackModel'
import { computeCurvedValuesUtm, computeStraightValuesUtm } from '../elementUtils'
import { splitElementAt, splitTrackAtJoint, carveSwitchRoute } from '../trackSplitUtils'
import {
  computeCrossingGeometryUtm, crossingElements, crossingLegFitsTrack, crossingLegRadius, crossingLegSignedRadius, piecesOnRadius,
} from '../switch/crossing'
import { computeSwitchGeometryUtm } from '../switch/symbol'
import { switchBranchLength } from '../switch/catalogue'
import { switchRouteVaries } from '../switch/route'
import { elementBelongsToSwitch, newSwitchFields, switchElementMark } from '../switchModel'
import { cantExceptionFields, worstCantOf } from '../rules/cant'
import { placeSwitchOnTrack } from '../switchPlacement'
import { elementAtStation, trackLength } from '../heightUtils'
import { minElementLength } from '../rules/elementLength'
import { utmToWgs84 } from '../coordinateUtils'
import { arcElement, straightElement } from '../elementFactory'

// What the switch dialogs commit (R4.2), as pure functions of their inputs —
// each the argument for commitSwitchConnection, one undo step. The dialog
// checks names and claims the switch number; what is left here is the
// construction, and the refusals that come out of it.

/** Track the toe must leave behind it, or the split would part off next to nothing [m]. */
const MIN_BEHIND = 0.5

/**
 * Where a turnout laid into `track` at `toeStation` lies — or why it cannot lie
 * there: `{ error: { key, params } }` or `{ place }`. Without the turnout's
 * geometry, which only the station the dialog settles on needs.
 */
function placeOnTrack({ track, toeStation, reversed, sw, side, straightLen }) {
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
  return { error: null, place }
}

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
  const { error, place } = placeOnTrack({ track, toeStation, reversed, sw, side, straightLen })
  if (error) return { error }
  // On nothing but straights the turnout is the ordinary, unbent one.
  const plain  = sw.symmetric || place.pieces.every(p => p.r1 == null && p.r2 == null)
  const toeWgs = utmToWgs84(place.toeUtm.easting, place.toeUtm.northing, track.epsg)
  return {
    error: null, place, plain,
    geom: computeSwitchGeometryUtm(place.toeUtm, place.bearing, sw, side, false, toeWgs,
      plain ? null : place.pieces),
  }
}

// ── Minimum element length before the toe (LP.EL.01) ────────────────────────

/** Shorter than this a piece is none: the toe sits on the node [m] (switchPlacement's JOINT_TOL). */
const NODE_TOL = 1e-3

/**
 * Where element `elIdx` of `track` runs along the track [m], and its node
 * behind a turnout opening with the track (its start) or against it (its end).
 */
function elementSpan(track, elIdx, reversed) {
  const start = track.elements.slice(0, elIdx).reduce((sum, e) => sum + (e.length ?? 0), 0)
  const end   = start + (track.elements[elIdx]?.length ?? 0)
  return { start, end, behind: reversed ? end : start }
}

/**
 * The piece of its element a turnout at `toeStation` leaves before its toe
 * (WA) — between the toe and the element's node on the side away from the
 * turnout. It has to be none at all (the toe on the node) or at least l_min of
 * LP.EL.01 at the element's design speed; behind the switch end nothing is
 * asked (Entscheidung 217). `lMin` is null where the element has no speed the
 * catalogue knows (below 40 km/h): then it is not checked.
 *
 * Returns { elIdx, length, lMin, speed, short } — or null off the track.
 */
export function switchOnTrackRemnant(track, toeStation, reversed) {
  const hit = elementAtStation(track?.elements, toeStation)
  if (!hit) return null
  const len = hit.el.length ?? 0
  const onNode = hit.s <= NODE_TOL || hit.s >= len - NODE_TOL
  const length = onNode ? 0 : (reversed ? len - hit.s : hit.s)
  const speed = hit.el.speed || null
  const lMin = minElementLength(speed)
  return { elIdx: hit.elIdx, length, lMin, speed, short: lMin != null && length > NODE_TOL && length < lMin - NODE_TOL }
}

/**
 * May the toe stand at `toeStation`: the turnout lies there and leaves no
 * piece too short before it? `args` are switchOnTrackPlacement's, without the station.
 */
export function switchOnTrackToeValid(args, toeStation) {
  return !placeOnTrack({ ...args, toeStation }).error
    && !switchOnTrackRemnant(args.track, toeStation, args.reversed)?.short
}

/**
 * The stations the dialog's slider can stand on with the toe on element
 * `elIdx`, ascending: both of its nodes and every whole metre from the node
 * behind the toe, from l_min on — each only where the turnout lies and keeps
 * the minimum element length before WA (Entscheidung 217). `behind` is the
 * station of that node: the slider shows the toe's distance from it.
 *
 * `args` are switchOnTrackPlacement's, without the station.
 */
export function switchOnTrackStops(args, elIdx) {
  const { track, reversed } = args
  const el = track?.elements?.[elIdx]
  if (!el) return { stops: [], behind: 0 }
  const { start, end, behind } = elementSpan(track, elIdx, reversed)
  const len = end - start
  const lMin = minElementLength(el.speed || null) ?? 0
  const dir = reversed ? -1 : 1
  const ds = [0, len]
  for (let d = Math.max(1, Math.ceil(lMin - NODE_TOL)); d < len - NODE_TOL; d++) ds.push(d)
  // Stated to a tenth of a millimetre: the station field shows it as it is.
  const at = (d) => Math.round((behind + dir * d) * 1e4) / 1e4
  const stops = [...new Set(ds.map(at))].filter(s => switchOnTrackToeValid(args, s)).sort((a, b) => a - b)
  return { stops, behind }
}

/** The stop of `stops` nearest to `station` — or null where there is none. */
export function nearestStop(stops, station) {
  let best = null
  for (const s of stops) if (best == null || Math.abs(s - station) < Math.abs(best - station)) best = s
  return best
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
  // Bent so that its branch comes out straight, the turnout is the plain form
  // with its routes swapped (computeSwitchGeometryUtm): the host track runs on
  // over its branch and the new track is its through route. Everything below
  // is the same with the two routes' roles exchanged.
  const swapped = g.swapped
  const shown   = swapped ?? g
  const lineRoute  = swapped ? 'branch' : 'main'
  const lineLength = swapped ? switchBranchLength(sw) : straightLen
  const carved = carveSwitchRoute(split.ahead, split.aheadEndpoint,
    swapped ? swapped.curvedUtm : place.endUtm, switchElementMark(identity, lineRoute), lineLength)
  if (!carved) return { noRoom: lineLength }
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
  const newRoute = swapped ? 'main' : 'branch'
  const newSegments = swapped ? swapped.stemSegments : g.branchSegments
  const branchEls = recalcAbsLengths(newSegments.map((seg, i) => {
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
      ...switchElementMark(identity, newRoute),
      geometry: { type: 'LineString', coordinates: seg.coords },
    })
  }))
  const branchTrack = {
    id: branchId,
    name,
    owner: fields.owner,
    ...buildTypeFields(fields),
    epsg: track.epsg,
    coordinates: swapped ? swapped.straightCoords : g.arcCoords,
    elements: branchEls,
  }

  // The record keeps only the ports: both routes are read back from the
  // tracks' marked elements (switchRoutesFromTracks).
  const newPort  = { trackId: branchId, endpoint: 'BEGIN' }
  const linePort = { trackId: split.ahead.id, endpoint: split.aheadEndpoint }
  const [b1, b2] = swapped ? [linePort, newPort] : [newPort, linePort]
  const switchRecord = {
    ...identity,
    number: switchNumber, trailing: false, speed,
    ...(swapped ? { swapped: true } : {}),
    portA_trackId:  split.behind.id, portA_endpoint:  split.behindEndpoint,
    portB1_trackId: b1.trackId,      portB1_endpoint: b1.endpoint,
    portB2_trackId: b2.trackId,      portB2_endpoint: b2.endpoint,
    fillCoords: shown.fillCoords, lcsCoords: shown.lcsCoords,
    labelCoords: shown.labelCoords, bauform: shown.bauform,
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
  if (geom.swapped) {
    return buildSwappedAtTrackEnd({
      start, startWgs, stemSigned, geom: geom.swapped, sourceTrackId, sw, trailing,
      cant, cantReason, speed, switchName, switchNumber, name, fields, mainName, mainFields,
    })
  }
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
 * A turnout at a track's end that bending leaves with a straight branch — the
 * plain form with its routes swapped (computeSwitchGeometryUtm), built as one.
 * `geom` is that plain turnout, facing from its toe.
 *
 * Its branch is the arc the picked track runs on in, its through route the
 * straight. Facing, both are new tracks from the toe, and each keeps the name
 * and fields the dialog gave the route it is in the terrain: the arc continues
 * the picked line (`mainName`), the straight leaves it (`name`). Trailing, the
 * toe lies the branch's length along the arc and faces back: the arc is
 * appended to the picked track, which so ends at the toe on the branch (port
 * B1), and the straight leaves from there as the new track. One turnout, one
 * cant — stored by the raised rail, so the appended arc, which runs towards
 * the toe, carries it turned.
 */
function buildSwappedAtTrackEnd({
  start, startWgs, stemSigned, geom, sourceTrackId, sw, trailing,
  cant, cantReason, speed, switchName, switchNumber, name, fields, mainName, mainFields,
}) {
  const identity = { ...newSwitchFields(), name: switchName, label: sw.label }
  const canted = (u) => ({ cant: u, ...cantExceptionFields(u, cantReason) })
  const throughEl = routeElement(geom.startUtm, geom.straightUtm, null, geom.straightCoords, {
    ...switchElementMark(identity, 'main'), ...canted(cant),
  })
  const throughTrack = { id: generateId(), name, owner: fields.owner, ...buildTypeFields(fields),
    epsg: start.zone, coordinates: geom.straightCoords, elements: [throughEl] }

  // Trailing, the arc runs from the picked track's end to the toe: the
  // branch backwards, ending on the picked node exactly.
  const branchEl = trailing
    ? routeElement(start, geom.startUtm, stemSigned,
      [startWgs ?? geom.curvedEnd, ...[...geom.arcCoords].reverse().slice(1)], {
        ...switchElementMark(identity, 'branch'), ...canted(-cant),
      })
    : routeElement(geom.arcOriginUtm, geom.curvedUtm, geom.signedR, geom.arcCoords, {
      ...switchElementMark(identity, 'branch'), ...canted(cant),
    })
  const branchTrack = trailing ? null : { id: generateId(), name: mainName, owner: mainFields.owner,
    ...buildTypeFields(mainFields), epsg: start.zone, coordinates: geom.arcCoords, elements: [branchEl] }

  return {
    removeTrackIds: [],
    append: trailing ? [{ trackId: sourceTrackId, elements: [branchEl] }] : [],
    addTracks: [...(branchTrack ? [branchTrack] : []), throughTrack],
    addSwitches: [{
      ...identity,
      number: switchNumber,
      trailing,
      speed,
      swapped: true,
      portA_trackId: trailing ? null : sourceTrackId,
      portA_endpoint: trailing ? null : 'END',
      portB1_trackId: trailing ? sourceTrackId : branchTrack.id,
      portB1_endpoint: trailing ? 'END' : 'BEGIN',
      portB2_trackId: throughTrack.id,
      portB2_endpoint: 'BEGIN',
      fillCoords: geom.fillCoords,
      labelCoords: geom.labelCoords,
      bauform: geom.bauform,
      lcsCoords: geom.lcsCoords,
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
