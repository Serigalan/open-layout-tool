import { reconstructElements } from './elementReconstruct'
import { rebuildSwitchSymbol } from './switchUtils'
import { rebuildPlatformSymbol } from './platformUtils'
import { migrateTrackHeights } from './heightUtils'
import { migrateProjectSwitches } from './switchModel'

/**
 * Persisted store format:
 *   { version: 1, projects: [...] }
 *   – one lean record per project. What defines an element is its plane data:
 *     startNode / endNode in the track's CRS (`track.epsg`, one code per
 *     track — the single source of truth for all of its elements), bearing,
 *     length and radius resp. r1 / r2. Everything in WGS84 is display data
 *     derived from that — element.geometry, element.renderCoords,
 *     track.coordinates and the switch symbols (fillCoords, lcsCoords) — and is
 *     stripped on persist and rebuilt on load, so it can never disagree with
 *     the plane data.
 *   – the vertical alignment is the track's own (`track.heights`, stationed
 *     along the track); records written before that are migrated on load.
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
 * Version 2 gave every switch record a `switchId`, a `kind` and the
 * `formVersion` of the form table it was built against, and wrote that id onto
 * the elements of its routes (see switchModel). Older records are migrated on
 * load by the absence of those fields rather than by the stated version — the
 * store is read field by field and a record can reach hydrateProjects from an
 * import that states no version at all.
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

/** Unwrap an imported/exported payload ({ version, projects }). */
export function parseProjectsPayload(data) {
  return { projects: Array.isArray(data?.projects) ? data.projects : [] }
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
 * plane data only.
 */
export function hydrateProjects(projects) {
  for (const p of projects ?? []) {
    if (p.tracks) p.tracks = p.tracks.map(migrateTrackHeights)
    for (const track of p.tracks ?? []) {
      track.elements    = reconstructElements(track.elements, track.epsg)
      track.coordinates = buildTrackCoords(track.elements)
    }
    // Before the symbols: rebuilding one reads its routes back off the tracks,
    // and which elements answer for it is what the migration settles.
    migrateProjectSwitches(p)
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
