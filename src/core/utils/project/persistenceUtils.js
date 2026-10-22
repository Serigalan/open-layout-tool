import { reconstructElements, derivedEndBearing, loadedTrackCants, storedTrackCants } from '../geometry'
import { rebuildSwitchSymbol } from '../switch'
import { rebuildPlatformSymbol, isModelledSwitch, rebuildCoords } from '../track'

/**
 * oltjson-1.1 — the one format of a project (decision 333, version 1.1 since
 * Entscheidung 371): what a file holds, what the browser and the server keep,
 * and what the app works on in memory.
 *
 *   { format: 'oltjson', version: '1.1', projects: [...] }
 *
 * One record per project. The app's model *is* this record, plus the display
 * geometry the load derives from it (hydrateProjects) and the save strips
 * again (dehydrateProjects):
 *
 *   – a track carries one coordinate system (`track.epsg`), and its elements
 *     are stated in it: startNode / endNode, bearing [°], length, radius resp.
 *     r1 / r2 [m]. Everything in WGS84 — element.geometry and renderCoords,
 *     track.coordinates, the switch and platform symbols — is derived and never
 *     kept, so it cannot disagree with the plane data.
 *   – an element states only what does not follow from the rest: no running
 *     station (the stations are the sum of the lengths), and an end bearing
 *     only where it is not the one its bearing, length and radius give (a
 *     kinked straight, an imported tangent). The load puts the derived one back
 *     on arcs and transitions, so code may read `el.endBearing` there.
 *   – a switch element carries the switch's id (`switchId`) and its route; the
 *     switch's name and form label are the switch's own.
 *   – a switch keeps what it joins under `ports`: { A: { trackId, endpoint } … }
 *     — which ports a kind has, switchModel.portsOf says.
 *   – the vertical alignment is the track's own (`track.heights`, stationed
 *     along the track), a platform is stationed along its track too.
 *   – the cant of an element is `cant` where it is the same at both ends and
 *     `cantStart` + `cantEnd` where it changes along it, never both
 *     (Entscheidung 369); a transition always states both its ends, and an
 *     absent cant is 0 (Entscheidung 371). The load gives an arc or a straight
 *     with a ramp its `cant` back, the end that helps the curve least, and
 *     leaves a transition the ends its neighbours give it anyway, so it follows
 *     them (geometry.loadedTrackCants).
 *   – how the element table may change an element (Entscheidung 371): `role`
 *     'follow' from this element on (Folgeelement — it and every one after it
 *     take length and radius, each starting where the one before ends) or
 *     'intermediate' (Zwischenelement — its radius is typed, it and the two
 *     elements beside it are worked out anew, everything else stays); absent,
 *     the element is a Festelement. `reasons` { ruleId: text } the written
 *     justification for each Hinweis of the rule catalogue on the element (a
 *     boundary rule's on the element after the joint); the one for cant in a
 *     turnout over 100 mm stays `cantException`.
 *   – numbers are kept to what they mean: positions, lengths, radii and
 *     stations to 1 µm, heights to 0.1 mm, angles to 10⁻⁹ °. Not coarser for
 *     the plane: nodes and design values must agree to the 10⁻⁶ ° the chain
 *     checks hold a tangent joint to — 0.1 mm on a 40 m arc is 10⁻⁵ °, and a
 *     switch laid into a track read back that way would inherit the break.
 *   – `kmLines` are foreign reference data, kept in WGS84 as they came, the
 *     one exception to the plane rule (see kmLineUtils).
 *   – project images live outside the records; an export embeds them.
 *
 * A payload of another format or version is refused, not converted:
 * parseProjectsPayload is the door, and nothing behind it has to ask again
 * whether a record is complete.
 */
const FORMAT = 'oltjson'
const FORMAT_VERSION = '1.1'
/** The format's name as it is spoken of: oltjson-1.1. */
export const FORMAT_NAME = `${FORMAT}-${FORMAT_VERSION}`

/**
 * A payload this tool will not take, `code` being the key the UI translates.
 */
export class PayloadError extends Error {
  constructor(code) {
    super(code)
    this.name = 'PayloadError'
    this.code = code
  }
}

/** A file of `records` (already dehydrated): { format, version, projects }. */
export const projectsPayload = (records) => ({ format: FORMAT, version: FORMAT_VERSION, projects: records })

const isPort = (p) => p == null || (typeof p === 'object' && !Array.isArray(p))

/** The roles an element may state (absent: a Festelement). */
const ELEMENT_ROLES = ['follow', 'intermediate']

/** Does an element state its role and its reasons as the format has them? */
const keptRoleAndReasons = (el) => (el.role == null || ELEMENT_ROLES.includes(el.role))
  && (el.reasons == null || (typeof el.reasons === 'object' && !Array.isArray(el.reasons)
    && Object.values(el.reasons).every(r => typeof r === 'string')))

/**
 * Unwrap an imported payload ({ format, version, projects }) — and refuse it
 * where it is not one of this tool's own.
 *
 * This is the one place that decides. Everything downstream — hydrateProjects,
 * the switch symbols, the delete rules — may then take the model for granted
 * instead of each guarding for a field that might be missing.
 *
 * Refused with `unsupported_version` where the file is another format or
 * another version of this one, and with `invalid_payload` where it states the
 * right one but does not hold it.
 */
export function parseProjectsPayload(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) {
    throw new PayloadError('invalid_payload')
  }
  if (data.format !== FORMAT || data.version !== FORMAT_VERSION) throw new PayloadError('unsupported_version')

  for (const p of data.projects) {
    for (const sw of p.switches ?? []) {
      if (!isModelledSwitch(sw)) throw new PayloadError('invalid_payload')
      if (sw.ports != null && (typeof sw.ports !== 'object' || !Object.values(sw.ports).every(isPort))) {
        throw new PayloadError('invalid_payload')
      }
    }
    for (const track of p.tracks ?? []) {
      for (const el of track.elements ?? []) {
        if (el.switchBranch && !el.switchId) throw new PayloadError('invalid_payload')
        if (!keptRoleAndReasons(el)) throw new PayloadError('invalid_payload')
      }
    }
  }
  return { projects: data.projects }
}

const isPoint = (p) => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite)

/**
 * Unwrap a file of tracks as the data exchange panel exports them (one track
 * or an array of them, elements without their derived geometry) — and refuse
 * it where it is not one: every track needs an id and a chain of elements of a
 * known kind between two plane points. A track that belongs to a switch may
 * only come back into a project that has that switch (`switchIds`), or its
 * branch would point at nothing.
 *
 * Returns the tracks; throws a PayloadError ('invalid_payload',
 * 'tracks_empty', 'switch_missing') otherwise.
 */
export function parseTracksPayload(data, { switchIds = new Set() } = {}) {
  const tracks = Array.isArray(data) ? data : [data]
  if (tracks.length === 0) throw new PayloadError('tracks_empty')
  for (const track of tracks) {
    if (!track || typeof track !== 'object') throw new PayloadError('invalid_payload')
    if (typeof track.id !== 'string' || !track.id) throw new PayloadError('invalid_payload')
    if (!Array.isArray(track.elements) || track.elements.length === 0) throw new PayloadError('invalid_payload')
    for (const el of track.elements) {
      if (!el || typeof el !== 'object') throw new PayloadError('invalid_payload')
      if (![0, 1, 2].includes(el.elementType)) throw new PayloadError('invalid_payload')
      if (!isPoint(el.startNode) || !isPoint(el.endNode)) throw new PayloadError('invalid_payload')
      if (!Number.isFinite(el.length) || el.length < 0) throw new PayloadError('invalid_payload')
      if (el.switchBranch && !el.switchId) throw new PayloadError('invalid_payload')
      if (el.switchId && !switchIds.has(el.switchId)) throw new PayloadError('switch_missing')
      if (!keptRoleAndReasons(el)) throw new PayloadError('invalid_payload')
    }
  }
  return tracks
}

// ── Numbers as they are kept ─────────────────────────────────────────────────

const at = (digits) => {
  const f = 10 ** digits
  return (v) => (Number.isFinite(v) ? Math.round(v * f) / f : v)
}
/** Positions, lengths, radii, stations: 1 µm. */
const um = at(6)
/** Heights: 0.1 mm. */
const mm10 = at(4)
/** Angles in degrees: 10⁻⁹ °. */
const angle = at(9)
/** Cant [mm]: a thousandth of a millimetre. */
const cant = at(3)

/** An end bearing agreeing with the one the element's design values give is not kept. */
const SAME_END_BEARING = 1e-7   // °

const turnBetween = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180)

/** The reasons an element keeps: each trimmed, an empty one dropped, none at all no field. */
function keptReasons(el) {
  const { reasons, ...rest } = el
  const kept = Object.entries(reasons ?? {}).map(([id, text]) => [id, String(text ?? '').trim()]).filter(([, text]) => text)
  return kept.length ? { ...rest, reasons: Object.fromEntries(kept) } : rest
}

/**
 * One element as it is kept: nothing derived, numbers to what they mean. Its
 * cant comes in from the track (storedTrackCants), which a transition needs to
 * state the ends its neighbours give it.
 */
function keptElement({ renderCoords: _rc, geometry: _g, ...el }) {
  const out = keptReasons(el)
  if (out.endBearing != null) {
    const derived = derivedEndBearing(out) ?? out.bearing
    if (derived != null && turnBetween(out.endBearing, derived) < SAME_END_BEARING) delete out.endBearing
  }
  for (const k of ['startNode', 'endNode']) if (Array.isArray(out[k])) out[k] = out[k].map(um)
  for (const k of ['length', 'radius', 'r1', 'r2']) if (out[k] != null) out[k] = um(out[k])
  for (const k of ['bearing', 'endBearing']) if (out[k] != null) out[k] = angle(out[k])
  for (const k of ['cant', 'cantStart', 'cantEnd']) if (out[k] != null) out[k] = cant(out[k])
  return out
}

/** A height point as it is kept. */
function keptHeight(h) {
  const out = { ...h }
  for (const k of ['station', 'rv', 'la']) if (out[k] != null) out[k] = um(out[k])
  if (out.z != null) out.z = mm10(out.z)
  return out
}

// ── Hydrate (load) / dehydrate (persist) ─────────────────────────────────────

/**
 * Rebuild all derived data in place: element geometry and renderCoords, the
 * end bearing of arcs and transitions where the record leaves it to them,
 * track coordinates, the switch symbols and the platform polygons — from the
 * plane data only. Nothing here converts or repairs; what reaches this point
 * has been through parseProjectsPayload or was written by this tool.
 */
export function hydrateProjects(projects) {
  for (const p of projects ?? []) {
    for (const track of p.tracks ?? []) {
      const elements = loadedTrackCants(track.elements ?? []).map(el => {
        if (el.endBearing != null) return el
        const derived = derivedEndBearing(el)
        return derived == null ? el : { ...el, endBearing: derived }
      })
      track.elements    = reconstructElements(elements, track.epsg)
      track.coordinates = rebuildCoords(track.elements)
    }
    if (p.switches || p.platforms) {
      const byId = Object.fromEntries((p.tracks ?? []).map(t => [t.id, t]))
      if (p.switches)  p.switches  = p.switches.map(sw => rebuildSwitchSymbol(sw, byId))
      if (p.platforms) p.platforms = p.platforms.map(pf => rebuildPlatformSymbol(pf, byId))
    }
  }
  return projects ?? []
}

/** The records as they are kept (oltjson-1.1): derived data stripped, numbers rounded. */
export function dehydrateProjects(projects) {
  return (projects ?? []).map((p) => {
    if (!p.tracks && !p.switches && !p.platforms) return p
    return {
      ...p,
      ...(p.tracks ? {
        tracks: p.tracks.map(({ coordinates: _coords, ...track }) => ({
          ...track,
          // `cant` or `cantStart` + `cantEnd`, never both (Entscheidung 369).
          elements: storedTrackCants(track.elements ?? []).map(keptElement),
          ...(track.heights ? { heights: track.heights.map(keptHeight) } : {}),
        })),
      } : {}),
      ...(p.switches ? {
        switches: p.switches.map(({
          fillCoords: _f, lcsCoords: _l, labelCoords: _lc, bodyCentre: _bc, bauform: _b, ...sw
        }) => sw),
      } : {}),
      ...(p.platforms ? {
        platforms: p.platforms.map(({ coords: _c, ...pf }) => ({
          ...pf,
          ...(pf.startStation != null ? { startStation: um(pf.startStation) } : {}),
          ...(pf.endStation != null ? { endStation: um(pf.endStation) } : {}),
        })),
      } : {}),
    }
  })
}
