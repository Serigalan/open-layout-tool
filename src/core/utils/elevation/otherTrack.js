/**
 * The heights of a switch's other tracks, worked out from the one given — on
 * request, with the button in the Höhenplan (decision 383); nothing couples on
 * its own any more.
 *
 * - A turnout (switchChain.turnoutOtherTracks): its plane from the track
 *   given, in pairs on the sleepers, the coupling points at the ldS as Paket
 *   WK has them; in a crossover the connecting track and the other main route
 *   with it.
 * - A crossing, a single or double slip: its routes cross in one plane, the
 *   given track's — every other track the switch has elements on takes, over
 *   those elements, the height that plane gives it (planeAcross): the given
 *   track's height at the foot of the perpendicular, tilted across by its
 *   cant the way it leans.
 */

import { elementBelongsToSwitch, isLinkSwitch, jointHeightUpdates, roundHeight, trackLength } from '../track'
import { carried, isTurnout, planeAcross, roundMm, STATION_TOL } from './switchGradient'
import { turnoutOtherTracks, turnoutsOfTrack } from './switchChain'

/** A middle point is stored where the plane leaves the straight between the ends by more than this [m]. */
const BOW_TOL = 0.0001

/** The stretch of each track a switch has elements on: Map(trackId → { from, to }) in its stations. */
function switchStretches(tracks, sw) {
  const out = new Map()
  for (const t of tracks ?? []) {
    let at = 0
    for (const el of t.elements ?? []) {
      const end = at + (el.length ?? 0)
      if (elementBelongsToSwitch(el, sw)) {
        const had = out.get(t.id)
        out.set(t.id, had ? { from: Math.min(had.from, at), to: Math.max(had.to, end) } : { from: at, to: end })
      }
      at = end
    }
  }
  return out
}

/**
 * The project with the other routes of a crossing (or slip) in the plane of
 * the given track: each other track's points over the switch replaced by its
 * two ends — and its middle, where the plane bows away from the straight
 * between them — at the plane's heights, a point at a track end with the
 * tracks joined there. Returns { project } or { error }.
 */
function crossingOtherTracks(project, sw, givenId) {
  const spans = switchStretches(project.tracks, sw)
  const given = project.tracks.find(t => t.id === givenId)
  if (!given || !spans.has(givenId)) return { error: 'not_on_track' }
  const own = spans.get(givenId)
  const gh = given.heights ?? []
  if (!(gh.length >= 2) || gh[0].station > own.from + STATION_TOL || gh[gh.length - 1].station < own.to - STATION_TOL) {
    return { error: 'no_gradient' }
  }
  let tracks = project.tracks
  const joints = []
  for (const [id, { from, to }] of spans) {
    if (id === givenId) continue
    const track = tracks.find(t => t.id === id)
    const zAt = (s) => planeAcross(given, track, s)
    const ends = [from, to].map(s => ({ station: roundMm(s), z: zAt(s) }))
    if (ends.some(p => p.z == null)) return { error: 'no_gradient' }
    const mid = (from + to) / 2
    const zMid = zAt(mid)
    const bows = zMid != null && Math.abs(zMid - (ends[0].z + ends[1].z) / 2) > BOW_TOL
    const put = [ends[0], ...(bows ? [{ station: roundMm(mid), z: zMid }] : []), ends[1]]
    const h = track.heights ?? []
    const had = (s) => h.find(p => Math.abs(p.station - s) <= STATION_TOL)
    const next = [
      ...h.filter(p => p.station < from - STATION_TOL || p.station > to + STATION_TOL),
      ...put.map(p => ({ ...(had(p.station) ? carried(had(p.station)) : {}), station: p.station, z: roundHeight(p.z) })),
    ].sort((a, b) => a.station - b.station)
    if (next.length === h.length && next.every((p, i) => p.station === h[i].station && p.z === h[i].z)) continue
    tracks = tracks.map(t => (t.id === id ? { ...t, heights: next } : t))
    const L = trackLength(track)
    next.forEach((p, index) => {
      if (p.station <= STATION_TOL || p.station >= L - STATION_TOL) joints.push({ trackId: id, index, z: p.z })
    })
  }
  if (tracks === project.tracks) return { project }
  const byTrack = jointHeightUpdates(tracks, project.switches, joints)
  // The given track stays as it is: where it is joined, the plane gives it its own height.
  byTrack.delete(givenId)
  tracks = tracks.map(t => (byTrack.has(t.id) ? { ...t, heights: byTrack.get(t.id) } : t))
  return { project: { ...project, tracks } }
}

/**
 * The project with the other tracks of switch `switchId` worked out from the
 * track `givenId` (decision 383). Returns { project } — the same object where
 * nothing changes — or { error }: 'not_coupled' (no such switch, or a
 * turnout whose tracks cannot be read), 'not_on_track' (the track is none
 * the switch could be given by), 'no_gradient' (the given track has no
 * heights over the switch).
 */
export function otherTrackHeights(project, switchId, givenId, opts) {
  const sw = project?.switches?.find(s => s.switchId === switchId)
  if (!sw || isLinkSwitch(sw)) return { error: 'not_coupled' }
  return isTurnout(sw) ? turnoutOtherTracks(project, switchId, givenId, opts) : crossingOtherTracks(project, sw, givenId)
}

/**
 * The switches a track can be the given one of, for the Höhenplan's list:
 * [{ sw, side, other }] — `side` 'main', 'branch' or 'crossing', `other` the
 * second turnout of a crossover (switchChain.turnoutsOfTrack). A turnout
 * whose tracks cannot be read is listed with side null, so the list can
 * say why it does nothing.
 */
export function switchesOfTrack(project, trackId, opts) {
  if (!project?.tracks) return []
  const turnouts = turnoutsOfTrack(project, trackId, opts)
  const out = [...turnouts]
  for (const sw of project.switches ?? []) {
    if (isLinkSwitch(sw) || turnouts.some(x => x.sw === sw || x.other === sw)) continue
    const onTrack = (project.tracks.find(t => t.id === trackId)?.elements ?? []).some(el => elementBelongsToSwitch(el, sw))
    if (!onTrack) continue
    out.push({ sw, side: isTurnout(sw) ? null : 'crossing', other: null })
  }
  return out
}
