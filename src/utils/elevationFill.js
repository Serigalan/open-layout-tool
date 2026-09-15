import { loadTracks, loadSwitches, setHeightsForTracks } from '../storage'
import { sampleHeights } from './elevationSource'
import {
  heightStations, trackSamplePoints, trackLength, jointGroup, jointHeightUpdates,
} from './heightUtils'

const STATION_TOL = 0.001   // m

/**
 * Keep the joints between the freshly read tracks (`written`) and their
 * neighbours at one height. Terrain gives two track ends meeting at a joint
 * the same value anyway — they are the same spot — so this only matters where
 * a re-read track meets one that was not re-read: there the standing height
 * wins, and an edited joint survives the reload of its neighbour. Joints that
 * already agree are left alone.
 */
function unifyJoints(projectId, written) {
  const tracks   = loadTracks(projectId)
  const switches = loadSwitches(projectId)
  const heightOf = (p) => tracks.find(t => t.id === p.trackId)?.heights?.[p.index]
  const entries = [], seen = new Set()
  for (const trackId of written) {
    const heights = tracks.find(t => t.id === trackId)?.heights
    if (!heights?.length) continue
    for (const index of [0, heights.length - 1]) {
      const group = jointGroup(tracks, switches, { trackId, index })
      const key = group.map(p => `${p.trackId}|${p.index}`).sort().join(' ')
      if (group.length < 2 || seen.has(key)) continue
      seen.add(key)
      const zs = group.map(p => heightOf(p).z)
      if (zs.every(z => z === zs[0])) continue
      const standing = group.find(p => !written.has(p.trackId)) ?? group[0]
      entries.push({ ...standing, z: heightOf(standing).z })
    }
  }
  if (entries.length) setHeightsForTracks(projectId, jointHeightUpdates(tracks, switches, entries), { undo: false })
}

/**
 * The stations of a track the terrain still has to be read for: all of them
 * for a track without a vertical alignment, and the stretch past its last
 * point for a track that has grown — an element appended to it. A point the
 * user deleted is not read again; only new track is.
 */
export function stationsToRead(track, force = false) {
  const length = trackLength(track)
  if (!(length > 0)) return []
  const heights = track.heights
  if (force || !(heights?.length >= 2)) return heightStations(length)
  const last = heights[heights.length - 1].station
  if (length - last <= STATION_TOL) return []
  // The grown stretch, stationed from the last point on, its own start left to
  // the point that is already there.
  return heightStations(length - last).slice(1).map(s => last + s)
}

/**
 * Give tracks their height points from the terrain. Without `force` only
 * tracks that have none yet, and stretches added to a track since, are read —
 * that is how a new track gets its first heights while edited ones are left
 * alone; with `force` the whole track (or project) is read again and
 * overwritten.
 *
 * A track whose length changed while its heights were being fetched is
 * skipped: the points would belong to the old geometry.
 * Resolves to { updated, missing } — tracks written, and tracks the terrain
 * sources had no data for.
 */
export async function fillHeights(projectId, { force = false, trackId = null } = {}) {
  const jobs = []
  for (const track of loadTracks(projectId)) {
    if (trackId && track.id !== trackId) continue
    if (!track.epsg) continue
    const stations = stationsToRead(track, force)
    if (stations.length) {
      jobs.push({ trackId: track.id, length: trackLength(track), points: trackSamplePoints(track, stations) })
    }
  }
  if (!jobs.length) return { updated: 0, missing: 0 }

  const zs = await sampleHeights(jobs.flatMap(j => j.points.map(p => p.lngLat)))
  let k = 0, updated = 0, missing = 0
  const byTrack = new Map()
  for (const job of jobs) {
    const fresh = job.points.map(p => ({ station: p.station, z: zs[k++] }))
    if (fresh.some(h => h.z == null)) { missing++; continue }
    const track = loadTracks(projectId).find(t => t.id === job.trackId)
    if (!track || Math.abs(trackLength(track) - job.length) > STATION_TOL) continue
    const kept = force ? [] : (track.heights ?? [])
    if (!force && kept.length && stationsToRead(track, false).length !== job.points.length) continue
    byTrack.set(job.trackId, [...kept, ...fresh])
    updated++
  }
  if (byTrack.size) setHeightsForTracks(projectId, byTrack, { undo: force })
  unifyJoints(projectId, new Set(byTrack.keys()))
  return { updated, missing }
}

// The automatic fill runs after every change; a change during a run queues one
// more run, so nothing is missed and nothing runs twice at once.
const running = new Map()   // projectId → { promise, again }

/** Fill the heights every track still lacks — serialized per project. */
export function fillMissingHeights(projectId) {
  const state = running.get(projectId)
  if (state) { state.again = true; return state.promise }
  const entry = { again: false }
  entry.promise = (async () => {
    let total = { updated: 0, missing: 0 }
    do {
      entry.again = false
      const r = await fillHeights(projectId).catch(() => ({ updated: 0, missing: 0 }))
      total = { updated: total.updated + r.updated, missing: r.missing }
    } while (entry.again)
    running.delete(projectId)
    return total
  })()
  running.set(projectId, entry)
  return entry.promise
}
