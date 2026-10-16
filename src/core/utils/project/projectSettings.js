import {
  EPSG_OPTIONS, crsCentre, crsDatum, crsName, crsSystem, epsgForLngLat, isCrsSystem, systemCodeAt, systemZones,
} from '../geometry/coordinateUtils'
import { transformTrackToPlane } from '../geometry/planeTransform'
import { portTracks, rebuildCoords, referencesTrack } from '../track/trackModel'
import { isLinkSwitch } from '../track/switchModel'
import { rebuildSwitchSymbol } from '../switch/symbol'
import { trackLength } from '../track/heightUtils'
import { LINE_CATEGORIES } from '../track/identifierUtils'
import { loadGridsFor } from '../geometry/ntv2Grid'

/**
 * The project settings (Paket PE): the project's coordinate system and line
 * category, and the tracks that keep one of their own.
 *
 * **The coordinate system** of the project is a system — a datum with its
 * projection, DB_REF / Gauß-Krüger, ETRS89 / UTM — not one plane (decision
 * 323): the meridian strip stays the track's own (`track.epsg`, one EPSG code
 * per strip). A new track is laid out in the project's system, in the strip
 * nearest to its first click (decision 318); the tracks there are keep their
 * plane, and one in another system is shown as deviating. Unset, the system is
 * the one most of the tracks lie in; an import sets it so where the project
 * names none (decision 322). A project without tracks and without a setting
 * takes the UTM zone of the first click, as before.
 *
 * A track is carried into another plane — another strip, or another system —
 * only on its own row (moveTracksToPlane), and with the tracks a turnout or
 * crossing joins it to (decision 319): a switch symbol and its routes are read
 * in one plane, so the tracks of a switch have to share it. A link (Gleisenden
 * verknüpfen) is no such join — it is made for tracks in two planes.
 *
 * **The line category** (decision 320) is the project's `lineCategory`; a
 * track names one of its own only where it is switched on for it.
 */

const knownCrs = (code) => (code != null && code !== '' && crsName(Number(code)) ? Number(code) : null)

/**
 * The system the project names, or null where it names none. A project set
 * before decision 323 names a plane (`epsg`), and its system is meant.
 */
export const projectSystemSetting = (project) =>
  (isCrsSystem(project?.crsSystem) ? project.crsSystem : crsSystem(project?.epsg))

/** The system most of `tracks` lie in, or null. Ties go to the first one met. */
export function dominantSystem(tracks) {
  const counts = new Map()
  for (const t of tracks ?? []) {
    const key = crsSystem(t.epsg)
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best = null
  for (const [key, n] of counts) if (!best || n > counts.get(best)) best = key
  return best
}

/** The project's coordinate system: the one it names, else the one most of its tracks lie in, else null. */
export const projectSystem = (project) => projectSystemSetting(project) ?? dominantSystem(project?.tracks)

/**
 * The project as an import leaves it (decision 322): where it names no system
 * yet, it names the one most of its tracks lie in now.
 */
export function withImportSystem(project) {
  if (!project || projectSystemSetting(project)) return project
  const key = dominantSystem(project.tracks)
  return key ? { ...project, crsSystem: key } : project
}

/** The plane a new track first clicked at `lngLat` is laid out in: the project's system, the strip of the click. */
export function newTrackEpsg(project, lngLat) {
  const key = projectSystem(project)
  return (key && systemCodeAt(key, lngLat[0])) ?? epsgForLngLat(lngLat)
}

/** Whether a track lies in another system than the project's. */
export function systemDeviates(track, project) {
  const own = crsSystem(track?.epsg)
  const ref = projectSystem(project)
  return ref != null && own != null && own !== ref
}

/** The longitude a track lies at [°]: the middle of its polyline, or null. */
function trackLng(track) {
  const cs = track?.coordinates ?? []
  return cs.length ? cs[Math.floor(cs.length / 2)][0] : null
}

/**
 * The plane of system `key` a track goes into: the strip with the central
 * meridian it has now, where the system has one (GK zone 4 of DHDN → zone 4 of
 * DB_REF), else the strip nearest to where it lies.
 */
export function planeInSystem(track, key) {
  const centre = crsCentre(track?.epsg)
  const same = systemZones(key).find(z => centre != null && Math.abs(z.centre - centre) < 1e-9)
  if (same) return same.code
  const lng = trackLng(track)
  return lng != null ? systemCodeAt(key, lng) : systemZones(key)[0]?.code ?? null
}

/**
 * The strips a track can be put in within its system: the ones around its own
 * (two either side — the WGS 84 UTM systems have sixty), as [{ zone, code, centre }].
 */
export function zoneChoices(track) {
  const key = crsSystem(track?.epsg)
  const zones = systemZones(key)
  const at = zones.findIndex(z => z.code === Number(track?.epsg))
  return at < 0 ? zones : zones.slice(Math.max(0, at - 2), at + 3)
}

/** The systems to pick from: ETRS89 / UTM and DB_REF / Gauß-Krüger, and the ones of `codes` in use. */
export function systemChoices(...codes) {
  return [...new Set(['ETRS89_UTM', 'DBREF_GK', ...codes.map(crsSystem).filter(Boolean)])]
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
