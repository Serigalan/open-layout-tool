import { EPSG_OPTIONS, crsDatum, crsName, epsgForLngLat, projectCrsOptions } from './coordinateUtils'
import { transformTrackToPlane } from './planeTransform'
import { portTracks, rebuildCoords, referencesTrack } from './trackModel'
import { isLinkSwitch } from './switchModel'
import { rebuildSwitchSymbol } from './switch/symbol'
import { trackLength } from './heightUtils'
import { LINE_CATEGORIES } from './identifierUtils'
import { loadGridsFor } from './ntv2Grid'

/**
 * The project settings (Paket PE): the project's coordinate system and line
 * category, and the tracks that keep one of their own.
 *
 * **The coordinate system** (decision 318) is the plane a new track is laid
 * out in. It does not move the tracks there are: each keeps its own plane
 * (`track.epsg`), and one in another plane than the project's is shown as
 * deviating. Unset, it is the plane most of the tracks lie in; a project
 * without tracks and without a setting takes the UTM zone of the first click,
 * as before.
 *
 * A track is carried into another plane only on its own row
 * (moveTracksToPlane), and with the tracks a turnout or crossing joins it to
 * (decision 319): a switch symbol and its routes are read in one plane, so the
 * tracks of a switch have to share it. A link (Gleisenden verknüpfen) is no
 * such join — it is made for tracks in two planes.
 *
 * **The line category** (decision 320) is the project's `lineCategory`; a
 * track names one of its own only where it is switched on for it.
 */

const knownCrs = (code) => (code != null && code !== '' && crsName(Number(code)) ? Number(code) : null)

/** The plane the project names for new tracks, or null where it names none. */
export const projectEpsgSetting = (project) => knownCrs(project?.epsg)

/**
 * The project's coordinate system: the one it names, else the one most of its
 * tracks lie in, else null (a new track then takes the zone of the click).
 */
export const projectEpsg = (project) =>
  projectEpsgSetting(project) ?? projectCrsOptions(project?.tracks)[0]?.code ?? null

/** The plane a new track first clicked at `lngLat` is laid out in. */
export const newTrackEpsg = (project, lngLat) => projectEpsg(project) ?? epsgForLngLat(lngLat)

/** Whether a track lies in another plane than the project's. */
export function epsgDeviates(track, project) {
  const own = Number(track?.epsg)
  const ref = projectEpsg(project)
  return ref != null && Number.isFinite(own) && own !== ref
}

/** The planes to pick from — the ones a new track is offered, and `extra` codes the tool can name. */
export function crsChoices(...extra) {
  const codes = [...new Set([...EPSG_OPTIONS.map(o => o.code), ...extra.map(knownCrs).filter(Boolean)])]
  return codes.map(code => ({ code, label: `EPSG ${code} – ${crsName(code)}` }))
}

/** The category a track names itself, or null where it runs on the project's. */
export const ownLineCategory = (track) => (LINE_CATEGORIES.includes(track?.lineCategory) ? track.lineCategory : null)

/** The track with a category of its own, or without one (`category` null). */
export function withLineCategory(track, category) {
  const { lineCategory: _c, ...rest } = track
  return LINE_CATEGORIES.includes(category) ? { ...rest, lineCategory: category } : rest
}

/**
 * The tracks that have to share a plane with `trackId`: it and every track a
 * turnout or crossing joins to it, transitively. Links do not join planes.
 * Returns the ids, `trackId` first.
 */
export function planeGroup(project, trackId) {
  const joins = (project?.switches ?? []).filter(sw => !isLinkSwitch(sw))
  const group = [trackId]
  const seen = new Set(group)
  for (let i = 0; i < group.length; i++) {
    for (const sw of joins) {
      if (!referencesTrack(sw, group[i])) continue
      for (const id of portTracks(sw)) {
        if (!seen.has(id)) { seen.add(id); group.push(id) }
      }
    }
  }
  return group
}

/**
 * The project with the tracks `trackIds` carried into plane `epsg`
 * (planeTransform.transformTrackToPlane): every element refitted to its
 * transformed nodes, the heights and the platforms on the track restationed by
 * the ratio its length changed by, and the symbol of every switch on a moved
 * track drawn again. Pure.
 *
 * Returns { project, report } — `report` { moved, scale: { min, max },
 * tangentGap, refused } says what the move cost. Where an element carries no
 * nodes to carry over (`refused` > 0) nothing is moved and `project` is null:
 * the element would be lost.
 */
export function moveTracksToPlane(project, trackIds, epsg) {
  const target = knownCrs(epsg)
  const ids = new Set(trackIds)
  const report = { moved: 0, scale: { min: 1, max: 1 }, tangentGap: 0, refused: 0 }
  if (!project || target == null) return { project: null, report }

  const ratio = new Map()
  let min = Infinity, max = -Infinity
  const tracks = (project.tracks ?? []).map(track => {
    if (!ids.has(track.id) || Number(track.epsg) === target) return track
    const res = transformTrackToPlane(track, target)
    if (!res) return track
    report.refused += res.refused
    report.tangentGap = Math.max(report.tangentGap, res.tangentGap)
    min = Math.min(min, res.scale.min); max = Math.max(max, res.scale.max)
    report.moved += 1
    const before = trackLength(track), after = trackLength(res.track)
    ratio.set(track.id, before > 0 && after > 0 ? after / before : 1)
    return { ...res.track, coordinates: rebuildCoords(res.track.elements) }
  })
  if (report.moved) report.scale = { min, max }
  if (report.refused > 0 || !report.moved) return { project: null, report }

  const byId = Object.fromEntries(tracks.map(t => [t.id, t]))
  const platforms = project.platforms?.map(pf => (ratio.has(pf.trackId) ? {
    ...pf,
    startStation: pf.startStation * ratio.get(pf.trackId),
    endStation:   pf.endStation * ratio.get(pf.trackId),
  } : pf))
  const switches = project.switches?.map(sw => (portTracks(sw).some(id => ratio.has(id)) ? rebuildSwitchSymbol(sw, byId) : sw))
  return {
    project: {
      ...project,
      tracks,
      ...(platforms ? { platforms } : {}),
      ...(switches ? { switches } : {}),
    },
    report,
  }
}

/**
 * moveTracksToPlane with the regional grids that cover the tracks loaded first
 * — the preview a dialog shows before it commits. The commit afterwards runs
 * on the grids loaded here.
 */
export async function previewTracksToPlane(project, trackIds, epsg, { loadGrids = loadGridsFor } = {}) {
  const ids = new Set(trackIds)
  const tracks = (project?.tracks ?? []).filter(t => ids.has(t.id))
  const box = tracks.reduce((b, tr) => {
    for (const c of tr.coordinates ?? []) {
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1])
      b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1])
    }
    return b
  }, [180, 90, -180, -90])
  const datums = [...new Set([...tracks.map(t => crsDatum(t.epsg)), crsDatum(epsg)].filter(Boolean))]
  if (box[0] <= box[2]) await loadGrids(box, datums)
  return moveTracksToPlane(project, trackIds, epsg)
}
