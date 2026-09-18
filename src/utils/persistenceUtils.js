import { reconstructElements } from './elementReconstruct'
import { rebuildSwitchSymbol } from './switchUtils'
import { rebuildPlatformSymbol } from './platformUtils'
import { isModelledSwitch } from './switchModel'

/**
 * Persisted store format:
 *   { version: 2, projects: [...] }
 *   – one lean record per project. What defines an element is its plane data:
 *     startNode / endNode in the track's CRS (`track.epsg`, one code per
 *     track — the single source of truth for all of its elements), bearing,
 *     length and radius resp. r1 / r2. Everything in WGS84 is display data
 *     derived from that — element.geometry, element.renderCoords,
 *     track.coordinates and the switch symbols (fillCoords, lcsCoords) — and is
 *     stripped on persist and rebuilt on load, so it can never disagree with
 *     the plane data.
 *   – the vertical alignment is the track's own (`track.heights`, stationed
 *     along the track).
 *   – a platform is stationed along its track too (`platforms[].trackId` plus
 *     start/end station); its drawn polygon is derived like the switch symbols.
 *   – `kmLines` are the kilometrage lines the project references its main
 *     points against. They are the one exception to the rule above, and the
 *     reason is that they are not the project's geometry: they are foreign
 *     reference data, never drawn and never calculated with as they stand, and
 *     one of them serves tracks whose `epsg` may differ — so they are kept in
 *     WGS84, the only plane none of the tracks owns, and converted into a
 *     track's plane on use (see kmLineUtils). Nothing about them is derived,
 *     so they are neither stripped nor rebuilt.
 *   – project images live outside the records (own IndexedDB store).
 *
 * Export files embed images so they stay self-contained:
 *   { version: 2, projects: [...] }
 *
 * Version 2 is what this tool reads and writes, and the only thing it reads:
 * every switch record carries a `switchId`, a `kind` and the `formVersion` of
 * the form table it was built against, and the elements of its routes carry
 * that id (see switchModel). A payload from before that is refused rather than
 * converted — parseProjectsPayload is the door, and nothing downstream has to
 * ask again whether a record is complete.
 *
 * The number stays monotonic for exactly that reason: a version-1 file is
 * recognisable as one, so the refusal can say what is wrong instead of naming
 * whichever field happened to be missed first.
 */
export const SCHEMA_VERSION = 2

/** Remove embedded images from projects; returns them as [{ id, image }]. */
export function extractImages(projects) {
  const images = []
  for (const p of projects ?? []) {
    if (p.image) {
      images.push({ id: p.id, image: p.image })
      delete p.image
    }
  }
  return images
}

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

/**
 * Unwrap an imported payload ({ version, projects }) — and refuse it where it is
 * not one of this tool's own.
 *
 * This is the one place that decides. Everything downstream — hydrateProjects,
 * the switch symbols, the delete rules — may then take the model for granted
 * instead of each guarding for a field that might be missing, which is what the
 * name comparison used to be.
 *
 * Refused with `unsupported_version` where the file states another version (a
 * file from before the switch model says 1), and with `invalid_payload` where it
 * states the right one but does not hold it.
 */
export function parseProjectsPayload(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) {
    throw new PayloadError('invalid_payload')
  }
  if (data.version !== SCHEMA_VERSION) throw new PayloadError('unsupported_version')

  for (const p of data.projects) {
    if (!(p.switches ?? []).every(isModelledSwitch)) throw new PayloadError('invalid_payload')
    for (const track of p.tracks ?? []) {
      for (const el of track.elements ?? []) {
        if (el.switchBranch && !el.switchId) throw new PayloadError('invalid_payload')
      }
    }
  }
  return { projects: data.projects }
}

// ── Hydrate (load) / dehydrate (persist) ─────────────────────────────────────

function buildTrackCoords(elements) {
  return (elements ?? []).reduce((coords, el, i) => {
    const c = el.renderCoords ?? el.geometry?.coordinates ?? []
    return i === 0 ? [...c] : [...coords, ...c.slice(1)]
  }, [])
}

/**
 * Rebuild all derived geometry in place: element geometry and renderCoords,
 * track coordinates, the switch symbols and the platform polygons — from the
 * plane data only. Nothing here converts or repairs; what reaches this point
 * has been through parseProjectsPayload or was written by this tool.
 */
export function hydrateProjects(projects) {
  for (const p of projects ?? []) {
    for (const track of p.tracks ?? []) {
      track.elements    = reconstructElements(track.elements, track.epsg)
      track.coordinates = buildTrackCoords(track.elements)
    }
    if (p.switches || p.platforms) {
      const byId = Object.fromEntries((p.tracks ?? []).map(t => [t.id, t]))
      if (p.switches)  p.switches  = p.switches.map(sw => rebuildSwitchSymbol(sw, byId))
      if (p.platforms) p.platforms = p.platforms.map(pf => rebuildPlatformSymbol(pf, byId))
    }
  }
  return projects ?? []
}

/** Strip derived geometry before persisting (rebuilt on load by hydrateProjects). */
export function dehydrateProjects(projects) {
  return (projects ?? []).map((p) => {
    if (!p.tracks && !p.switches && !p.platforms) return p
    return {
      ...p,
      ...(p.tracks ? {
        tracks: p.tracks.map(({ coordinates: _coords, ...track }) => ({
          ...track,
          elements: (track.elements ?? []).map(({ renderCoords: _rc, geometry: _g, ...el }) => el),
        })),
      } : {}),
      ...(p.switches ? {
        switches: p.switches.map(({
          fillCoords: _f, lcsCoords: _l, labelCoords: _lc, bodyCentre: _bc, bauform: _b, ...sw
        }) => sw),
      } : {}),
      ...(p.platforms ? {
        platforms: p.platforms.map(({ coords: _c, ...pf }) => pf),
      } : {}),
    }
  })
}
