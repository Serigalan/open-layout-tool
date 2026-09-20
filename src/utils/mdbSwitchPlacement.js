import {
  SWITCH_TYPES, SWITCH_TYPES_ALT1, SWITCH_TYPES_ALT2, CROSSING_TYPES,
  switchStraightLength, switchBranchLength, crossingEndDistance,
} from './switchUtils'
import { newSwitchFields, switchElementMark } from './switchModel'
import { splitTrackAtJoint, splitElementAt, carveSwitchRoute } from './trackSplitUtils'
import { placeSwitchOnTrack } from './switchPlacement'
import { resolveEndBearing } from './elementUtils'
import { elementAtStation, pointAtStationUtm } from './heightUtils'
import { SYS_EPSG } from './mdbImport'
import { generateId, remapSwitches } from '../storage'

/**
 * Putting the MDB's switch inventory onto the tracks the same import built.
 *
 * A unit is a point, not a stretch: the database gives its Punktadresse and
 * thereby its coordinates, and the alignment it sits on is already there as
 * imported track. Measured against the delivered file, 99.4 % of the units fall
 * within 0.5 m of a track axis, the median exactly on it — so the switch is
 * located by projecting its point onto the tracks, not by matching topology.
 *
 * The shape that projection finds is what a turnout is: one track running
 * **through** the point (stem and through route, which the placement parts at
 * the toe) and one **beginning** there (the diverging branch). Both geometries
 * come from the survey, so nothing here generates switch geometry — the record
 * only marks which existing elements are its routes, and the symbol is derived
 * from them on load (`rebuildSwitchSymbol`).
 */

/** How far off the axis a switch point may fall and still count as on it [m]. */
const PLACE_TOL = 0.5

/**
 * The same for a crossing point, which is derived rather than stated: the
 * corners give it only as well as the body is symmetric, and measured against
 * the delivered file that is a few decimetres out. The point only has to say
 * *which* tracks meet — the station each leg is cut at comes from projecting
 * onto that track, and is refined below to where the two legs actually cross.
 */
const CROSSING_TOL = 3

/** A projection this close to a track's end counts as beginning there [m]. */
const END_TOL = 1.0

/** All three form tables — the alternates carry forms this database uses. */
const ALL_TYPES = [...SWITCH_TYPES, ...SWITCH_TYPES_ALT1, ...SWITCH_TYPES_ALT2]

const trackLength = (t) => t.elements.reduce((s, e) => s + (e.length ?? 0), 0)

/**
 * Form table entry for a unit, or null. The turnouts are looked up by radius and
 * slope, the crossing kinds by kind and slope — a plain crossing states no
 * radius, and the ones that do (the Kreuzungsweichen) carry it on their
 * connecting curves.
 */
export function switchTypeFor(unit) {
  if (unit.slope == null) return null
  if (unit.kind && unit.kind !== 'turnout') {
    return CROSSING_TYPES.find(t => t.kind === unit.kind
      && Math.abs(t.ratio - unit.slope) < 1e-6
      && (t.R == null || t.R === unit.radius)) ?? null
  }
  if (unit.radius == null) return null
  return ALL_TYPES.find(t => t.R === unit.radius && Math.abs(t.ratio - unit.slope) < 1e-6) ?? null
}

/** Intersection of the lines a→c and b→d, or null where they are parallel. */
function intersect(a, c, b, d) {
  const r = [c[0] - a[0], c[1] - a[1]]
  const s2 = [d[0] - b[0], d[1] - b[1]]
  const den = r[0] * s2[1] - r[1] * s2[0]
  if (Math.abs(den) < 1e-9) return null
  const t = ((b[0] - a[0]) * s2[1] - (b[1] - a[1]) * s2[0]) / den
  return [a[0] + t * r[0], a[1] + t * r[1]]
}

/**
 * The crossing point of a Kreuzung or Kreuzungsweiche in one Lagesystem.
 *
 * The database splits a Kreuzungsweiche into its switch points, one per corner,
 * and the routes run A–C and B–D — so the body's centre is where those two
 * lines meet, not where any of the nodes is. A plain Kreuzung is a single node
 * and states the point itself; an einfache Kreuzungsweiche has two opposite
 * corners, whose midpoint is the same thing.
 */
function crossingCentre(coords, unit, sys) {
  const at = (suffix) => coords.get(`${unit.padBySuffix?.[suffix]}\u0000${sys}`)
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(at)
  if (a && b && c && d) return intersect(a, c, b, d)
  if (a && b) return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  return coords.get(`${unit.pad}\u0000${sys}`) ?? null
}

/** Perpendicular distance of `pt` from the segment, and how far along it lies. */
function onSegment(pt, s, e) {
  const dx = e[0] - s[0]
  const dy = e[1] - s[1]
  const len2 = dx * dx + dy * dy
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((pt[0] - s[0]) * dx + (pt[1] - s[1]) * dy) / len2)) : 0
  return { dist: Math.hypot(pt[0] - (s[0] + u * dx), pt[1] - (s[1] + u * dy)), u }
}

/**
 * Where a point falls on a track: the station along it and how far off axis.
 * The elements are taken by their chords, which is enough to find the element
 * and a station — `placeSwitchOnTrack` reads the exact position from there.
 */
function projectOnTrack(track, pt) {
  let best = null
  let acc = 0
  for (const el of track.elements) {
    const { dist, u } = onSegment(pt, el.startNode, el.endNode)
    if (!best || dist < best.dist) best = { dist, station: acc + u * (el.length ?? 0) }
    acc += el.length ?? 0
  }
  return best
}

/** The bearing a track leaves `endpoint` with, pointing away from it. */
function outwardBearing(track, endpoint) {
  const els = track.elements
  if (endpoint === 'BEGIN') return els[0].bearing
  const last = els[els.length - 1]
  return (resolveEndBearing(last, track.epsg) + 180) % 360
}

const angleTo = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

/** Angle between two lines, direction disregarded. */
const lineAngle = (a, b) => Math.min(angleTo(a, b), angleTo(a, (b + 180) % 360))

/**
 * Which of the tracks at the point is the branch, and which carries the switch.
 *
 * At the Weichenanfang — and that is what the database's switch point is,
 * measured: the branch leaves on the track's own tangent, median 0.000° over
 * 916 placements — a turnout is tangential, so an angle tells the branch from a
 * plain continuation nothing. Its **curvature** does: the branch bends with the
 * form's radius, a continuation runs on. So the branch is the starting track
 * whose first element comes closest to the form's R.
 *
 * Where several tracks run through the point they cross there, and only one of
 * them carries the turnout: the one the branch leaves tangentially.
 */
function chooseShape(found, type) {
  const { through, starting } = found
  if (!through.length) return { reason: `${through.length} durchlaufende und ${starting.length} beginnende Gleise` }
  if (!starting.length) return { reason: `${through.length} durchlaufende und ${starting.length} beginnende Gleise` }

  const branch = starting.length === 1 ? starting[0] : starting.reduce((best, cand) => {
    const radius = (t, end) => Math.abs((end === 'BEGIN'
      ? t.elements[0]
      : t.elements[t.elements.length - 1])?.radius ?? Infinity)
    const off = (c) => Math.abs(radius(c.track, c.endpoint) - type.R)
    return off(cand) < off(best) ? cand : best
  })

  const bb = outwardBearing(branch.track, branch.endpoint)
  const host = through.length === 1 ? through[0] : through.reduce((best, cand) => {
    const tangent = (c) => elementAtStation(c.track.elements, c.station)?.el.bearing ?? 0
    return lineAngle(bb, tangent(cand)) < lineAngle(bb, tangent(best)) ? cand : best
  })
  return { host, branch }
}

/**
 * Find each unit's place among the tracks: the track it sits on and where, and
 * the track that begins there.
 *
 * Returns one entry per unit — with `host`/`branch` where the shape is the one
 * a turnout has, otherwise `reason` saying what was found instead.
 */
export function locateMdbSwitches(payload, tracks) {
  return locatorFor(pointIndex(payload), tracks)
}

/** Switch points by Punktadresse and Lagesystem — built once, it is large. */
function pointIndex(payload) {
  const coords = new Map()
  for (const p of payload.points) coords.set(`${p.pad}\u0000${p.sys}`, [p.y, p.x])
  return coords
}

function locatorFor(coords, tracks) {
  const byEpsg = new Map()
  for (const t of tracks) {
    if (!byEpsg.has(t.epsg)) byEpsg.set(t.epsg, [])
    byEpsg.get(t.epsg).push(t)
  }

  return (unit, pointOf, tol = PLACE_TOL) => {
    for (const [sys, epsg] of Object.entries(SYS_EPSG)) {
      const pt = pointOf ? pointOf(sys) : coords.get(`${unit.pad}\u0000${sys}`)
      if (!pt) continue
      const through = []
      const starting = []
      for (const track of byEpsg.get(epsg) ?? []) {
        const hit = projectOnTrack(track, pt)
        if (!hit || hit.dist > tol) continue
        const total = trackLength(track)
        if (hit.station <= END_TOL) starting.push({ track, endpoint: 'BEGIN' })
        else if (hit.station >= total - END_TOL) starting.push({ track, endpoint: 'END' })
        else through.push({ track, station: hit.station })
      }
      if (through.length || starting.length) return { unit, epsg, point: pt, through, starting }
    }
    return { unit, reason: 'kein Gleis am Weichenpunkt' }
  }
}

/**
 * Place a Kreuzung or Kreuzungsweiche: two routes crossing at one point.
 *
 * Both routes are imported track, so — as with the turnout — nothing is drawn
 * here. The body is the four legs reaching `crossingEndDistance` out of the
 * crossing point, and those legs are the halves the two tracks part into. What
 * else runs through the point are the connecting curves (a Kreuzungsweiche has
 * one, a doppelte has two); they are told apart by their curvature and left
 * alone, since the symbol is read from the main and cross legs only.
 */
function placeCrossingUnit(found, unit, type, tracks, number, makeId) {
  const half = crossingEndDistance(type)
  // The two crossing routes run through the point; the connecting curves bend
  // on the form's radius. Straightest first, so the two legs come out on top.
  const curvature = (c) => {
    const el = elementAtStation(c.track.elements, c.station)?.el
    return el ? Math.abs(1 / (el.radius ?? el.r1 ?? Infinity)) : Infinity
  }
  const legs = [...found.through].sort((a, b) => curvature(a) - curvature(b)).slice(0, 2)
  if (legs.length < 2) {
    return { error: `${found.through.length} Gleise durch den Kreuzungspunkt – nicht gesetzt.` }
  }

  // The corners give the centre only approximately. Where the two legs' tangents
  // actually cross is the crossing point, so each leg is re-projected onto it.
  const tangentLine = (leg) => {
    const at = elementAtStation(leg.track.elements, leg.station)
    if (!at) return null
    const p0 = pointAtStationUtm(at.el, at.s, leg.track.epsg)
    const rad = at.el.bearing * Math.PI / 180
    return { p: [p0.easting, p0.northing], d: [Math.sin(rad), Math.cos(rad)] }
  }
  const l0 = tangentLine(legs[0])
  const l1 = tangentLine(legs[1])
  const centre = l0 && l1
    ? intersect(l0.p, [l0.p[0] + l0.d[0], l0.p[1] + l0.d[1]],
      l1.p, [l1.p[0] + l1.d[0], l1.p[1] + l1.d[1]])
    : null
  const placedLegs = centre
    ? legs.map(leg => ({ ...leg, station: projectOnTrack(leg.track, centre)?.station ?? leg.station }))
    : legs

  const identity = { ...newSwitchFields(unit.kind), name: unit.name, label: type.label }
  const marks = ['main', 'cross']
  const ports = {}
  const remaps = []
  let current = tracks
  const portNames = [['A', 'C'], ['B', 'D']]

  for (let i = 0; i < 2; i++) {
    const leg = placedLegs[i]
    const track = current.find(t => t.id === leg.track.id) ?? leg.track
    const ahead = placeSwitchOnTrack(track, leg.station, false, half)
    const back = placeSwitchOnTrack(track, leg.station, true, half)
    if (ahead.error || back.error) return { error: `${ahead.error || back.error} – nicht gesetzt.` }

    const names = new Set(current.map(t => t.name).filter(Boolean))
    const split = ahead.joint != null
      ? splitTrackAtJoint(track, ahead.joint, ahead.bearing, names)
      : splitElementAt(track, ahead.elIdx,
        ahead.cutsClothoid ? { ...ahead.toeUtm, station: ahead.s } : ahead.toeUtm, ahead.bearing, names)

    const mark = switchElementMark(identity, marks[i])
    const carvedAhead = carveSwitchRoute(split.ahead, split.aheadEndpoint, ahead.endUtm, mark, half)
    const carvedBehind = carveSwitchRoute(split.behind, split.behindEndpoint, back.endUtm, mark, half)
    if (!carvedAhead || !carvedBehind) {
      return { error: `kein Platz für das Endmaß ${half.toFixed(1)} m – nicht gesetzt.` }
    }

    const pieces = split.tracks
      .map(t => (t.id === carvedAhead.id ? carvedAhead : t.id === carvedBehind.id ? carvedBehind : t))
      .map(t => ({ ...t, id: t.id ?? makeId() }))
    current = current.filter(t => t.id !== track.id).concat(pieces)
    remaps.push({ oldId: track.id, newId: [pieces[0].id, pieces[1].id] })

    const [behindPort, aheadPort] = portNames[i]
    ports[`port${behindPort}_trackId`] = carvedBehind.id
    ports[`port${behindPort}_endpoint`] = split.behindEndpoint
    ports[`port${aheadPort}_trackId`] = carvedAhead.id
    ports[`port${aheadPort}_endpoint`] = split.aheadEndpoint
  }

  return {
    tracks: current,
    remaps,
    record: { ...identity, number, kind: unit.kind, pad: unit.pad, ...ports },
  }
}

/**
 * Leave a note on the elements at a switch point the import could not build.
 *
 * The switch is in the database, the alignment carries it, and something about
 * it does not fit the model — an unknown Bauform, a kind this path does not
 * build, a topology that is not a turnout's. Dropping it silently would make
 * the track look like plain running line, which it is not. So the elements at
 * that point say what stands there and why it is not a record, and the element
 * table shows it.
 *
 * This is deliberately **not** `switchElementMark`: that marks a route of an
 * existing switch record, and an element carrying it without a `switchId` is
 * refused by `parseProjectsPayload`. A note is a note.
 */
function noteUnplaced(tracks, coords, unit, reason) {
  const text = `${unit.label || '?'} (${unit.bst}/${unit.name}): ${reason}`
  let touched = false
  const next = tracks.map((track) => {
    for (const [sys, epsg] of Object.entries(SYS_EPSG)) {
      if (epsg !== track.epsg) continue
      const pt = coords.get(`${unit.pad}\u0000${sys}`)
      if (!pt) continue
      let bestIdx = -1
      let best = PLACE_TOL
      track.elements.forEach((el, i) => {
        const { dist } = onSegment(pt, el.startNode, el.endNode)
        if (dist <= best) { best = dist; bestIdx = i }
      })
      if (bestIdx < 0) continue
      touched = true
      return {
        ...track,
        elements: track.elements.map((el, i) => (i === bestIdx
          ? { ...el, switchHint: el.switchHint ? `${el.switchHint} | ${text}` : text }
          : el)),
      }
    }
    return track
  })
  return touched ? next : tracks
}

/**
 * Build the switch records for the located units and mark their routes.
 *
 * Every switch parts the track it sits on, so the tracks change as this runs:
 * the host is replaced by the two pieces the toe divides it into. A unit whose
 * host has already been parted by an earlier switch is therefore looked up
 * again each round rather than from a list made once.
 *
 * Returns { tracks, switches, errors } — the tracks as they are after every
 * placement, ready to be saved as they are.
 */
export function placeMdbSwitches(payload, tracks, units, { startNumber = 1, newId } = {}) {
  const errors = []
  const switches = []
  const makeId = newId ?? generateId
  // The import hands over tracks without ids — the store gives them one at save
  // time. A port names a track by id, so they get one here, before the first
  // switch parts anything.
  let current = tracks.map(t => ({ ...t, id: t.id ?? makeId() }))
  let number = startNumber
  const coords = pointIndex(payload)

  const give = (unit, reason) => {
    errors.push(`${unit.bst}/${unit.name} (${unit.label}): ${reason}`)
    current = noteUnplaced(current, coords, unit, reason)
  }

  for (const unit of units) {
    const type = switchTypeFor(unit)
    if (!type) {
      give(unit, 'keine Form im Weichenkatalog – nicht gesetzt.')
      continue
    }
    // A Kreuzung is located by the point its two routes cross at, a turnout by
    // its Weichenanfang — the database states the latter, the former follows
    // from the corners.
    const crossing = unit.kind !== 'turnout'
    const found = locatorFor(coords, current)(unit,
      crossing ? (sys) => crossingCentre(coords, unit, sys) : null,
      crossing ? CROSSING_TOL : PLACE_TOL)
    if (found.reason) { give(unit, `${found.reason} – nicht gesetzt.`); continue }

    let placed
    if (crossing) {
      placed = placeCrossingUnit(found, unit, type, current, number, makeId)
    } else {
      const shape = chooseShape(found, type)
      if (shape.reason) { give(unit, `${shape.reason} – nicht gesetzt.`); continue }
      placed = placeOne({ ...found, ...shape }, unit, type, current, number, makeId)
    }
    if (placed.error) { give(unit, placed.error); continue }
    current = placed.tracks
    // Parting the host invalidates every port an earlier switch put on it. The
    // store's own rule decides which half each keeps: the one its endpoint is
    // on. Without this the second switch on a track leaves the first dangling.
    for (const remap of placed.remaps ?? []) {
      switches.splice(0, switches.length, ...remapSwitches(switches, [remap]))
    }
    switches.push(placed.record)
    number = placed.record.number + 1
  }
  return { tracks: current, switches, errors }
}

function placeOne(found, unit, type, tracks, number, makeId) {
  const { host, branch } = found
  const track = tracks.find(t => t.id === host.track.id) ?? host.track
  const straightLen = switchStraightLength(type)
  const branchLen = switchBranchLength(type)

  // Which way the turnout opens: toward the side the branch leaves on. The
  // branch runs away from the toe, so the smaller angle against the track's own
  // direction at the toe is the one the turnout faces.
  const branchBearing = outwardBearing(branch.track, branch.endpoint)
  const hit = projectOnTrack(track, found.point)
  const at = elementAtStation(track.elements, hit.station)
  if (!at) return { error: 'Weichenpunkt liegt nicht auf dem Gleis – nicht gesetzt.' }
  const reversed = angleTo(branchBearing, at.el.bearing) > 90

  const place = placeSwitchOnTrack(track, hit.station, reversed, straightLen)
  if (place.error) return { error: `${place.error} – nicht gesetzt.` }

  const names = new Set(tracks.map(t => t.name).filter(Boolean))
  const split = place.joint != null
    ? splitTrackAtJoint(track, place.joint, place.bearing, names)
    : splitElementAt(track, place.elIdx,
      place.cutsClothoid ? { ...place.toeUtm, station: place.s } : place.toeUtm, place.bearing, names)

  const identity = { ...newSwitchFields(), name: unit.name, label: type.label }
  const carved = carveSwitchRoute(split.ahead, split.aheadEndpoint, place.endUtm,
    switchElementMark(identity, 'main'), straightLen)
  if (!carved) return { error: 'kein Platz für die Weichenlänge – nicht gesetzt.' }

  // The branch is an imported track of its own: its first elements up to the
  // form's branch length are the switch's diverging route. The carve needs the
  // point that length reaches, read off the branch itself.
  const branchTrack = tracks.find(t => t.id === branch.track.id) ?? branch.track
  const branchTotal = trackLength(branchTrack)
  if (branchTotal < branchLen) return { error: 'Zweiggleis kürzer als die Weichenform – nicht gesetzt.' }
  const branchEndStation = branch.endpoint === 'BEGIN' ? branchLen : branchTotal - branchLen
  const branchAt = elementAtStation(branchTrack.elements, branchEndStation)
  if (!branchAt) return { error: 'Zweigende liegt nicht auf dem Zweiggleis – nicht gesetzt.' }
  const branchCut = pointAtStationUtm(branchAt.el, branchAt.s, branchTrack.epsg)
  const branchCarved = carveSwitchRoute(branchTrack, branch.endpoint, branchCut,
    switchElementMark(identity, 'branch'), branchLen)
  if (!branchCarved) return { error: 'Zweigroute nicht schneidbar – nicht gesetzt.' }

  const pieces = split.tracks
    .map(t => (t.id === carved.id ? carved : t))
    .map(t => ({ ...t, id: t.id ?? makeId() }))
  const next = tracks
    .filter(t => t.id !== track.id && t.id !== branchTrack.id)
    .concat(pieces, branchCarved)

  return {
    tracks: next,
    remaps: [{ oldId: track.id, newId: [pieces[0].id, pieces[1].id] }],
    record: {
      ...identity,
      number, trailing: reversed, speed: type.speed,
      kind: unit.kind,
      pad: unit.pad,
      portA_trackId: split.behind.id, portA_endpoint: split.behindEndpoint,
      portB1_trackId: branchCarved.id, portB1_endpoint: branch.endpoint,
      portB2_trackId: split.ahead.id, portB2_endpoint: split.aheadEndpoint,
    },
  }
}
