import { SWITCH_TYPES, SWITCH_TYPES_ALT1, SWITCH_TYPES_ALT2, switchStraightLength, switchBranchLength } from './switchUtils'
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

/** A projection this close to a track's end counts as beginning there [m]. */
const END_TOL = 1.0

/** All three form tables — the alternates carry forms this database uses. */
const ALL_TYPES = [...SWITCH_TYPES, ...SWITCH_TYPES_ALT1, ...SWITCH_TYPES_ALT2]

const trackLength = (t) => t.elements.reduce((s, e) => s + (e.length ?? 0), 0)

/** Form table entry for a unit's radius and slope, or null. */
export function switchTypeFor(unit) {
  if (unit.radius == null || unit.slope == null) return null
  return ALL_TYPES.find(t => t.R === unit.radius && Math.abs(t.ratio - unit.slope) < 1e-6) ?? null
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

  return (unit) => {
    for (const [sys, epsg] of Object.entries(SYS_EPSG)) {
      const pt = coords.get(`${unit.pad}\u0000${sys}`)
      if (!pt) continue
      const through = []
      const starting = []
      for (const track of byEpsg.get(epsg) ?? []) {
        const hit = projectOnTrack(track, pt)
        if (!hit || hit.dist > PLACE_TOL) continue
        const total = trackLength(track)
        if (hit.station <= END_TOL) starting.push({ track, endpoint: 'BEGIN' })
        else if (hit.station >= total - END_TOL) starting.push({ track, endpoint: 'END' })
        else through.push({ track, station: hit.station })
      }
      if (through.length === 1 && starting.length === 1) {
        return { unit, epsg, point: pt, host: through[0], branch: starting[0] }
      }
      if (through.length || starting.length) {
        return { unit, reason: `${through.length} durchlaufende und ${starting.length} beginnende Gleise` }
      }
    }
    return { unit, reason: 'kein Gleis am Weichenpunkt' }
  }
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

  for (const unit of units) {
    if (unit.kind !== 'turnout') {
      errors.push(`${unit.bst}/${unit.name} (${unit.label}): ${unit.kind} – nur Weichen werden gesetzt.`)
      continue
    }
    const type = switchTypeFor(unit)
    if (!type) {
      errors.push(`${unit.bst}/${unit.name} (${unit.label}): keine Form in der Tabelle – nicht gesetzt.`)
      continue
    }
    const found = locatorFor(coords, current)(unit)
    if (!found.host) {
      errors.push(`${unit.bst}/${unit.name} (${unit.label}): ${found.reason} – nicht gesetzt.`)
      continue
    }
    const placed = placeOne(found, unit, type, current, number, makeId)
    if (placed.error) { errors.push(`${unit.bst}/${unit.name} (${unit.label}): ${placed.error}`); continue }
    current = placed.tracks
    // Parting the host invalidates every port an earlier switch put on it. The
    // store's own rule decides which half each keeps: the one its endpoint is
    // on. Without this the second switch on a track leaves the first dangling.
    switches.splice(0, switches.length, ...remapSwitches(switches, [placed.remap]))
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
    remap: { oldId: track.id, newId: [pieces[0].id, pieces[1].id] },
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
