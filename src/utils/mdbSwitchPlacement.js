import {
  ALL_SWITCH_TYPES, CROSSING_TYPES,
  switchStraightLength, switchBranchLength, crossingEndDistance, crossingAngle, crossingLegRadius,
  rebuildSwitchSymbol, switchRouteBearingAt, switchElementRoute,
} from './switchUtils'
import { newSwitchFields, switchElementMark } from './switchModel'
import { splitTrackAtJoint, splitElementAt, carveSwitchRoute } from './trackSplitUtils'
import { placeSwitchOnTrack } from './switchPlacement'
import { resolveEndBearing } from './elementUtils'
import { elementAtStation, pointAtStationUtm } from './heightUtils'
import { epsgForLagesystem } from './mdbImport'
import { deriveMdbTurnouts, offsetOnTrack, AXIS_TOL } from './mdbSwitchDerive'
import { generateId, remapSwitches } from '../storage'
import { nextSwitchNumber, switchDesignation } from './identifierUtils'

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

// Every turnout form the catalogue holds, Regelformen and Sonderbauformen
// alike: this database states forms no connection would ever propose.
const ALL_TYPES = ALL_SWITCH_TYPES

const trackLength = (t) => t.elements.reduce((s, e) => s + (e.length ?? 0), 0)

/**
 * Form table entry for a unit, or null. The turnouts are looked up by radius and
 * slope, the crossing kinds by kind and slope — a plain crossing states no
 * radius, and the ones that do (the Kreuzungsweichen) carry it on their
 * connecting curves.
 *
 * The Bogenkreuzungsweiche is the exception: the radius its Bauform names is
 * its crossing roads', and the source writes it rounded — `EBKW 54-500-1:9`
 * for the form's 500.860. Kind, slope and that 500 are also exactly an EKW
 * 500's, so what tells the two apart is the prefix (`unit.bogen`).
 */
export function switchTypeFor(unit) {
  if (unit.slope == null) return null
  if (unit.kind && unit.kind !== 'turnout') {
    const radiusFits = (t) => {
      const legR = crossingLegRadius(t)
      if (legR == null) return t.R == null || t.R === unit.radius
      return unit.radius == null || Math.abs(legR - unit.radius) < 1
    }
    return CROSSING_TYPES.find(t => t.kind === unit.kind
      && Math.abs(t.ratio - unit.slope) < 1e-6
      && (crossingLegRadius(t) != null) === Boolean(unit.bogen)
      && radiusFits(t)) ?? null
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
  return locatorFor(pointIndex(payload), systemsOf(payload), tracks)
}

/**
 * The Lagesysteme this file states points in, each with the plane it names —
 * read from the points themselves rather than from a fixed list, because the
 * interface has twenty of them and a file uses two or three.
 */
function systemsOf(payload) {
  const out = new Map()
  for (const p of payload.points) {
    if (out.has(p.sys)) continue
    const epsg = epsgForLagesystem(p.sys)
    if (epsg) out.set(p.sys, epsg)
  }
  return [...out]
}

/** Switch points by Punktadresse and Lagesystem — built once, it is large. */
function pointIndex(payload) {
  const coords = new Map()
  for (const p of payload.points) coords.set(`${p.pad}\u0000${p.sys}`, [p.y, p.x])
  return coords
}

function locatorFor(coords, systems, tracks) {
  const byEpsg = new Map()
  for (const t of tracks) {
    if (!byEpsg.has(t.epsg)) byEpsg.set(t.epsg, [])
    byEpsg.get(t.epsg).push(t)
  }

  return (unit, pointOf, tol = PLACE_TOL) => {
    // A derived unit has no Punktadresse: it was read off the alignment and
    // states the plane it was read in.
    for (const [sys, epsg] of unit.point ? [[null, unit.epsg]] : systems) {
      const pt = unit.point ?? (pointOf ? pointOf(sys) : coords.get(`${unit.pad}\u0000${sys}`))
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

/** Tangent bearing of a track at a station along it, or null off its end. */
function tangentAt(track, station) {
  const at = elementAtStation(track.elements, station)
  return at ? switchRouteBearingAt(at.el.bearing, switchElementRoute(at.el), at.s) : null
}

/** Curvature of a track at a station, unsigned — 0 on a straight. */
function curvatureAt(track, station) {
  const el = elementAtStation(track.elements, station)?.el
  return el ? Math.abs(1 / (el.radius ?? el.r1 ?? Infinity)) : Infinity
}

/**
 * Which two of the tracks through a crossing point are its crossing roads.
 *
 * In a Kreuzungsweiche the connecting routes pass the point within a metre as
 * well, so more than two tracks run through it, and their curvature does not
 * tell them apart: a DKW's curves are its sharpest tracks, but a
 * Bogenkreuzungsweiche's straight connection is its flattest — and laid into a
 * curve, as the test database's two EBKW are on R 1700, every one of them
 * bends. The angle does. The crossing roads meet at the form's crossing angle, a
 * crossing road and a connecting route at about half of it, two connecting
 * routes not at all. So the pair is the one whose tangents at the point come
 * closest to the form's angle, and within it the straighter track is the main
 * route — the order the placement has always put them in.
 */
function crossingRoads(through, type) {
  const alpha = crossingAngle(type) * 180 / Math.PI
  let best = null
  for (let i = 0; i < through.length; i++) {
    for (let j = i + 1; j < through.length; j++) {
      const a = tangentAt(through[i].track, through[i].station)
      const b = tangentAt(through[j].track, through[j].station)
      if (a == null || b == null) continue
      const miss = Math.abs(lineAngle(a, b) - alpha)
      if (!best || miss < best.miss) best = { miss, pair: [through[i], through[j]] }
    }
  }
  if (!best) return null
  const curvature = (c) => curvatureAt(c.track, c.station)
  return best.pair.sort((a, b) => curvature(a) - curvature(b))
}

/**
 * Place a Kreuzung or Kreuzungsweiche: two routes crossing at one point.
 *
 * Both routes are imported track, so — as with the turnout — nothing is drawn
 * here. The body is the four legs reaching `crossingEndDistance` out of the
 * crossing point along both routes, and those legs are the halves the two
 * tracks part into. What else runs through the point are the connecting routes
 * (a Kreuzungsweiche has one, a doppelte two); they are told apart by their
 * angle (crossingRoads) and left alone, since the symbol is read from the legs
 * only.
 */
function placeCrossingUnit(found, unit, type, tracks, makeId) {
  const half = crossingEndDistance(type)
  const legs = crossingRoads(found.through, type)
  if (!legs) {
    return { error: `${found.through.length} Gleise durch den Kreuzungspunkt – nicht gesetzt.` }
  }

  // The corners give the centre only approximately. Where the two legs
  // actually cross is the crossing point, so each leg is re-projected onto it:
  // where their tangents cross, found again from the stations that gives until
  // it stands still — at once on straight legs, after a step or two on a
  // Bogenkreuzungsweiche's arcs.
  const tangentLine = (leg) => {
    const at = elementAtStation(leg.track.elements, leg.station)
    if (!at) return null
    const p0 = pointAtStationUtm(at.el, at.s, leg.track.epsg)
    const rad = tangentAt(leg.track, leg.station) * Math.PI / 180
    return { p: [p0.easting, p0.northing], d: [Math.sin(rad), Math.cos(rad)] }
  }
  let placedLegs = legs
  for (let step = 0; step < 5; step++) {
    const l0 = tangentLine(placedLegs[0])
    const l1 = tangentLine(placedLegs[1])
    const centre = l0 && l1
      ? intersect(l0.p, [l0.p[0] + l0.d[0], l0.p[1] + l0.d[1]],
        l1.p, [l1.p[0] + l1.d[0], l1.p[1] + l1.d[1]])
      : null
    if (!centre) break
    const next = placedLegs.map(leg => ({
      ...leg, station: offsetOnTrack(leg.track, centre)?.station ?? leg.station,
    }))
    const moved = Math.max(...next.map((leg, k) => Math.abs(leg.station - placedLegs[k].station)))
    placedLegs = next
    if (moved < 1e-9) break
  }

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
    record: { ...identity, kind: unit.kind, pad: unit.pad, ...ports },
  }
}

/**
 * What a unit is called in a report: the file's Betriebsstelle and number, or —
 * for one the alignment gave rather than the file — where it was read.
 */
const unitLabel = (unit) => (unit.derived
  ? `Abgeleitet ${unit.where}`
  : `${unit.bst}/${unit.name}`)

/**
 * How far the Weichenanfang sits from the two tracks that meet there.
 *
 * Both are surveyed and the point is a surveyed point of both, so the three
 * are one place or the file disagrees with itself. Measured exactly against the
 * elements' own geometry — a chord could not carry a centimetre — and reported
 * beyond `AXIS_TOL`. The switch is still set: 5 cm moves no alignment, and the
 * alignment is what the model holds. What is reported is the disagreement.
 */
function axisNote(found, shape) {
  const host = offsetOnTrack(shape.host.track, found.point)?.dist ?? 0
  const els = shape.branch.track.elements
  const node = shape.branch.endpoint === 'BEGIN' ? els[0].startNode : els[els.length - 1].endNode
  const branch = Math.hypot(node[0] - found.point[0], node[1] - found.point[1])
  if (host <= AXIS_TOL && branch <= AXIS_TOL) return null
  const cm = (v) => `${(v * 100).toFixed(1)} cm`
  return `Weichenanfang ${cm(host)} neben dem Stammgleis ${shape.host.track.name ?? '?'} `
    + `und ${cm(branch)} neben dem Anfang des Zweiggleises ${shape.branch.track.name ?? '?'} `
    + `(zulässig ${cm(AXIS_TOL)}) – gesetzt, aber die Vermessung widerspricht sich.`
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
function noteUnplaced(tracks, coords, systems, unit, reason) {
  const text = `${unit.label || '?'} (${unitLabel(unit)}): ${reason}`
  const where = unit.point ? [[unit.epsg, unit.point]] : systems
    .map(([sys, epsg]) => [epsg, coords.get(`${unit.pad}\u0000${sys}`)])
  let touched = false
  const next = tracks.map((track) => {
    for (const [epsg, pt] of where) {
      if (epsg !== track.epsg) continue
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
export function placeMdbSwitches(payload, tracks, units,
  { existingSwitches = [], newId, derive = false } = {}) {
  const errors = []
  const switches = []
  const makeId = newId ?? generateId
  // The import hands over tracks without ids — the store gives them one at save
  // time. A port names a track by id, so they get one here, before the first
  // switch parts anything.
  let current = tracks.map(t => ({ ...t, id: t.id ?? makeId() }))
  // Numbers are the project's, not the file's: the database numbers a switch
  // within its Betriebsstelle, which collides across them and with whatever the
  // project already holds. The name keeps the number the file states — that is
  // the designation on site — and `number` is drawn from the project's sequence.
  const taken = []
  const nextNumber = () => {
    const n = nextSwitchNumber(existingSwitches, taken)
    taken.push(n)
    return n
  }
  const coords = pointIndex(payload)
  const systems = systemsOf(payload)

  const give = (unit, reason) => {
    errors.push(`${unitLabel(unit)} (${unit.label}): ${reason}`)
    current = noteUnplaced(current, coords, systems, unit, reason)
  }

  // The switches the file does not state, read off the alignment itself
  // (mdbSwitchDerive). This runs on the tracks as they came in, before the
  // first placement parts any of them, and skips every point Satzart 31
  // already names — placed or not, a point the file names is the file's.
  let all = units
  if (derive) {
    const stated = []
    for (const unit of units) {
      for (const pad of [unit.pad, ...(unit.pads ?? [])]) {
        if (!pad) continue
        for (const [sys, epsg] of systems) {
          const pt = coords.get(`${pad}\u0000${sys}`)
          if (pt) stated.push({ epsg, point: pt })
        }
      }
    }
    const found = deriveMdbTurnouts(current, stated)
    all = [...units, ...found.units]
    if (found.units.length) {
      errors.push(`${found.units.length} Weichen ergänzt, die in Satzart 31 fehlen – `
        + 'ein Gleis endet dort mitten auf einem anderen. Die Bauform ist aus der '
        + 'Geometrie gelesen, nicht aus der Datei.')
    }
    errors.push(...found.errors)
  }

  for (const unit of all) {
    // A derived unit brings the form its geometry gave it; a stated one is
    // looked up by the Bauform the file writes.
    const type = unit.type ?? switchTypeFor(unit)
    if (!type) {
      give(unit, 'keine Form im Weichenkatalog – nicht gesetzt.')
      continue
    }
    // A Kreuzung is located by the point its two routes cross at, a turnout by
    // its Weichenanfang — the database states the latter, the former follows
    // from the corners.
    const crossing = unit.kind !== 'turnout'
    const found = locatorFor(coords, systems, current)(unit,
      crossing ? (sys) => crossingCentre(coords, unit, sys) : null,
      crossing ? CROSSING_TOL : PLACE_TOL)
    if (found.reason) { give(unit, `${found.reason} – nicht gesetzt.`); continue }

    let placed
    if (crossing) {
      placed = placeCrossingUnit(found, unit, type, current, makeId)
    } else {
      const shape = chooseShape(found, type)
      if (shape.reason) { give(unit, `${shape.reason} – nicht gesetzt.`); continue }
      const off = axisNote(found, shape)
      if (off) errors.push(`${unitLabel(unit)} (${unit.label}): ${off}`)
      placed = placeOne({ ...found, ...shape }, unit, type, current, makeId)
    }
    if (placed.error) { give(unit, placed.error); continue }
    current = placed.tracks
    // Parting the host invalidates every port an earlier switch put on it. The
    // store's own rule decides which half each keeps: the one its endpoint is
    // on. Without this the second switch on a track leaves the first dangling.
    for (const remap of placed.remaps ?? []) {
      switches.splice(0, switches.length, ...remapSwitches(switches, [remap]))
    }
    // Only a switch that was actually built takes a number — a failed one must
    // not burn one, or 372 refusals would push the sequence past its ceiling.
    // A derived switch has no designation from the file either, so it is named
    // from that number, the way a switch built in the app is.
    const number = nextNumber()
    switches.push({
      ...placed.record,
      number,
      name: placed.record.name || switchDesignation(number, placed.record.kind),
    })
  }

  // The symbol travels with the record, exactly as a dialog commits it — the
  // store appends a switch as it is given and only derives the body again when
  // a project is read back from disk. A record saved without it would stay
  // invisible until the next reload.
  const byId = Object.fromEntries(current.map(t => [t.id, t]))
  const drawn = switches.map(sw => rebuildSwitchSymbol(sw, byId))
  // A record whose body cannot be read back from its routes would sit in the
  // project invisible. It is kept — the ports are right and the routes are
  // marked — but it is named, because nothing on the map would say it is there.
  for (const sw of drawn) {
    if (!sw.fillCoords) errors.push(`${sw.name} (${sw.label}): gesetzt, aber der Weichenkörper `
      + 'lässt sich aus den Routen nicht ableiten – auf der Karte unsichtbar.')
  }
  return { tracks: current, switches: drawn, errors }
}

function placeOne(found, unit, type, tracks, makeId) {
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
      trailing: reversed, speed: type.speed,
      kind: unit.kind,
      pad: unit.pad,
      portA_trackId: split.behind.id, portA_endpoint: split.behindEndpoint,
      portB1_trackId: branchCarved.id, portB1_endpoint: branch.endpoint,
      portB2_trackId: split.ahead.id, portB2_endpoint: split.aheadEndpoint,
    },
  }
}
