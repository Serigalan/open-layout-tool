// The design data of a track as an exchange file states it, shared by the two
// formats the app writes: OSRD's RailJSON (osrdExport) and the alignment
// exchange format (exchangeExport). Both carry the same element chain — the
// scalars a polyline cannot express — and differ only in where it sits and
// what surrounds it. The import (osrdImport) reads either.

import { transitionCantEnds } from './clothoidUtils'
import { portsOf } from './switchModel'

export const DEG2GON = 10 / 9
export const GON2DEG = 9 / 10

// Everything that defines the geometry is written at full precision: the
// alignment is re-imported by chaining these values, so a rounded bearing walks
// the whole track off course (1e-4 gon ≈ 9 mm over 44 km). `exact` only trims
// float noise. `round3`/`round4` are for reference values that rebuild nothing.
export const exact  = (n) => (n == null ? null : Math.round(n * 1e9) / 1e9)
export const round3 = (n) => (n == null ? null : Math.round(n * 1e3) / 1e3)
export const round4 = (n) => (n == null ? null : Math.round(n * 1e4) / 1e4)

/** The track's polyline: the elements' display geometry, joints not repeated. */
export function buildCoords(track) {
  return (track.elements ?? []).reduce((coords, el, i) => {
    const c = el.geometry?.coordinates ?? []
    return i === 0 ? [...c] : [...coords, ...c.slice(1)]
  }, [])
}

export function totalLength(track) {
  return (track.elements ?? []).reduce((sum, el) => sum + (el.length ?? 0), 0)
}

function elementType(el) {
  if (el.elementType === 2) return el.transitionType === 'bloss' ? 'bloss' : 'clothoid'
  return el.radius != null ? 'curve' : 'straight'
}

/**
 * The element chain of a track: type, station, length and the design scalars —
 * signed radii, cants and design speed.
 *
 * Cant lives on arcs as a scalar; across a transition it is a ramp, so its two
 * ends are taken from the neighbouring elements — or from the transition's own
 * ends where it was cut (see transitionCantEnds). Values equal to 0 are omitted,
 * as is a design speed of 0 (unknown).
 */
export function horizontalElements(track) {
  const els = track.elements ?? []
  const cantEnds = (el, i) => el.elementType === 2
    ? transitionCantEnds(els, i)
    : { start: el.cant ?? 0, end: el.cant ?? 0 }

  let station = 0
  return els.map((el, i) => {
    const type = elementType(el)
    const out = { type, station_start_m: round4(station), length_m: exact(el.length) }
    // A straight whose stored end bearing differs from its own direction has a
    // kink at its end (Verm.ESN type 5): the alignment leaves in a different
    // direction than the straight runs. Stated as the deflection angle itself,
    // signed like a bearing change (positive = to the right), so the break is
    // visible as such. It cannot be re-derived — without it the chain drifts
    // for every following element.
    if (type === 'straight' && el.endBearing != null && el.endBearing !== el.bearing) {
      const kink = (((el.endBearing - el.bearing) + 540) % 360) - 180
      out.kink_gon = exact(kink * DEG2GON)
    }
    if (type === 'curve') out.radius_m = exact(el.radius)
    if (type === 'clothoid' || type === 'bloss') {
      // Both ends are always stated; null means it runs into a straight.
      out.radius_start_m = exact(el.r1 ?? null)
      out.radius_end_m   = exact(el.r2 ?? null)
    }
    const { start, end } = cantEnds(el, i)
    if (start) out.cant_start_mm = start
    if (end)   out.cant_end_mm   = end
    if (el.speed) out.design_speed_kmh = el.speed
    station += el.length ?? 0
    return out
  })
}

/** Where the track begins in its own CRS, with the gon bearing it leaves in. */
export function startAnchor(track) {
  const first = (track.elements ?? [])[0]
  return {
    epsg: Number(track.epsg) || null,
    easting:  exact(first?.startNode?.[0]),
    northing: exact(first?.startNode?.[1]),
    bearing_gon: exact((first?.bearing ?? 0) * DEG2GON),
  }
}

/** Where it ends — check values the import compares its walk against. */
export function endAnchor(track) {
  const els  = track.elements ?? []
  const last = els[els.length - 1]
  return {
    easting:  exact(last?.endNode?.[0]),
    northing: exact(last?.endNode?.[1]),
    bearing_gon: exact((last?.endBearing ?? last?.bearing ?? 0) * DEG2GON),
  }
}

/**
 * The switches as an exchange file states them: a node whose ports name the
 * track ends meeting there. That end is recorded when the switch is built and
 * maintained when a track is reversed or split, so it is read here rather than
 * inferred from `trailing` (which only ever held for the plain switch forms,
 * not for junction switches). Switches the app manages are regenerated; ones
 * from an import that it does not model (`foreign`) are appended as long as no
 * generated switch already carries that id.
 */
// Country the operational point is reported in, from the track's owner.
const COUNTRY_CODE = { DB: 'DE', SNCF: 'FR' }

const slug = (s) => String(s).trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'op'

/**
 * The platforms as an operational point states them. OSRD models a station as
 * one operational point holding a part per point of interest, and names the
 * platforms as the example: each part is a point on a track, and the point a
 * train is dispatched against is the middle of the platform — so that is the
 * position written here.
 *
 * Platforms are grouped by their station name (the code decides when there is
 * no name), so a station with four platforms is one operational point with
 * four parts. Positions need no conversion: a platform's stations and a part's
 * `position` are both metres along the track from its BEGIN.
 *
 * What OSRD's own fields lose — the extent, the side, the edge distances and
 * the height over top of rail — rides along in the part's `olt` extension, so
 * the app's own exchange file states the platform fully while the RailJSON
 * fields stay what OSRD expects. It is still written and never read back (see
 * osrdImport, which keeps a file's own operational points in the passthrough
 * instead). What the app does not model on the platform is taken from its
 * track: the UIC number and the country of the infrastructure owner.
 */
/**
 * What a platform is beyond the point OSRD models: its extent along the track,
 * the side it lies on, the distances of its two edges from the axis and its
 * height over top of rail. Only what the record states — the absolute level of
 * the edge follows from the track's own heights and is derived where it is
 * needed, never written.
 */
const platformExtension = (p) => ({
  start_station_m: round3(p.startStation),
  end_station_m:   round3(p.endStation),
  side:            p.side ?? null,
  front_offset_m:  round3(p.frontOffset),
  back_offset_m:   round3(p.backOffset),
  height_mm:       round3(p.height),
})

export function platformsToOperationalPoints(platforms, trackMap, foreign = []) {
  const groups = new Map()
  for (const p of platforms ?? []) {
    const track = trackMap[p.trackId]
    if (!track) continue                     // a platform whose track is gone has no position
    const name = String(p.stationName ?? '').trim()
    const code = String(p.code ?? '').trim().toUpperCase()
    // Without either the platform stands on its own rather than joining a
    // nameless heap with every other unnamed one.
    const key = name.toLowerCase() || (code ? `code:${code}` : `platform:${p.id}`)
    if (!groups.has(key)) groups.set(key, { name, code, parts: [] })
    const group = groups.get(key)
    if (!group.name && name) group.name = name
    if (!group.code && code) group.code = code
    group.parts.push({
      track: p.trackId,
      position: round3((p.startStation + p.endStation) / 2),
      extensions: { sncf: null, olt: platformExtension(p) },
      local_track_name: String(track.name ?? '').trim() || track.id,
      uic: Number(track.uicStation) || null,
      owner: track.owner,
    })
  }

  const taken = new Set()
  const out = []
  for (const { name, code, parts } of groups.values()) {
    let id = `op_${slug(code || name)}`
    for (let i = 2; taken.has(id); i++) id = `op_${slug(code || name)}_${i}`
    taken.add(id)
    const label = name || code || 'Operational point'
    out.push({
      id,
      plc: null,
      // The app carries no UIC number on a platform; the station track may.
      uic: parts.find(p => p.uic)?.uic ?? null,
      name: label,
      parts: parts.map(({ uic: _u, owner: _o, ...part }) => part),
      weight: null,
      // OSRD's own default when no code is given: the first three letters.
      main_code: code || label.slice(0, 3).toUpperCase(),
      country_code: COUNTRY_CODE[parts[0].owner] ?? 'DE',
      secondary_code: null,
      secondary_name: null,
      is_passenger_station: true,
    })
  }
  const generatedIds = new Set(out.map(op => op.id))
  return [...out, ...foreign.filter(op => !generatedIds.has(op.id))]
}

/**
 * What each kind is called in RailJSON. OSRD models the crossings as their own
 * switch types, so the discriminator maps straight onto them — which is the
 * whole reason the record carries a `kind` rather than counting its ports.
 */
export const OSRD_SWITCH_TYPES = {
  turnout:     'point_switch',
  crossing:    'crossing',
  single_slip: 'single_slip_switch',
  double_slip: 'double_slip_switch',
}

/** The kind a RailJSON switch type names, or null for one the app does not model. */
export const kindForOsrdType = (type) =>
  Object.keys(OSRD_SWITCH_TYPES).find(kind => OSRD_SWITCH_TYPES[kind] === type) ?? null

/**
 * What OSRD calls each of a kind's ports. Its node types name their own: a
 * point switch's A, B1, B2 are the app's, but the crossing kinds' four ends
 * are A1/A2 on one side and B1/B2 on the other — the app's A and C are the
 * main route's ends (OSRD's line 1, A1–B1), its B and D the cross route's
 * (line 2, A2–B2).
 */
const OSRD_PORT_NAMES = {
  turnout:  { A: 'A', B1: 'B1', B2: 'B2' },
  crossing: { A: 'A1', B: 'A2', C: 'B1', D: 'B2' },
}
OSRD_PORT_NAMES.single_slip = OSRD_PORT_NAMES.crossing
OSRD_PORT_NAMES.double_slip = OSRD_PORT_NAMES.crossing

export function switchesToPorts(switches, trackMap, foreign = []) {
  const out = switches.map((sw, i) => {
    const names = OSRD_PORT_NAMES[sw.kind] ?? OSRD_PORT_NAMES.turnout
    const ports = {}
    for (const { port, trackKey, endKey } of portsOf(sw)) {
      const trackId = sw[trackKey], endpoint = sw[endKey]
      if (trackId && endpoint && trackMap[trackId]) ports[names[port]] = { track: trackId, endpoint }
    }

    return {
      id: sw.switchId ?? sw.name ?? `switch_${i}`,
      ports,
      extensions: sw.name ? { sncf: { label: sw.name } } : null,
      switch_type: OSRD_SWITCH_TYPES[sw.kind] ?? OSRD_SWITCH_TYPES.turnout,
      group_change_delay: 0,
    }
  })
  // A switch an import brought along is the same physical one as the record it
  // became — told apart by its id, or by the label that record took its name
  // from, so it is not written out twice.
  const generated = new Set(out.flatMap(s => [s.id, s.extensions?.sncf?.label].filter(Boolean)))
  return [...out, ...foreign.filter(s =>
    !generated.has(s.id) && !generated.has(s.extensions?.sncf?.label))]
}
