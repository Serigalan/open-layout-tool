import { heightAt } from '../track'
import { lockedHeights, turnoutHeightStations } from './switchChain'

// Locked height points (Entscheidung 382). A locked point keeps its height
// and its station — the table and the profile let neither be typed — and
// where it is one of the points the coupling sets for a turnout, the
// turnout's gradient stays as it is. The store asks lockBreach after every
// write, the coupling done, and refuses the write where it would change what
// a lock holds: that way it holds for every way heights change (profile,
// table, fitting a crossover, the terrain fill, the coupling itself). A
// change of the track's geometry may still move a locked point along it —
// the alignment comes first —, its height stays.

/** Heights that agree to this already agree: they are kept to 0.1 mm [m]. */
const Z_TOL = 0.00006

/**
 * What a write from `before` to `after` would change that a lock holds, or
 * null: { kind: 'point', trackId, station } for a locked point whose height
 * changed or that went, { kind: 'turnout', switchId, trackId, station } for a
 * turnout a lock holds whose gradient changed at its toe or an ldS.
 *
 * `unlock`: the write may take locks away (unlocking, or deleting a locked
 * point after asking) — then only what is still locked after it is held.
 * `parted`: the ids of tracks the write split or joined into others, whose
 * locked points live on there. A track that is simply gone takes its points
 * with it.
 */
export function lockBreach(before, after, { unlock = false, parted = new Set(), opts } = {}) {
  const was = lockedHeights(before, opts)
  if (!was.points.length && !unlock) return null
  const now = lockedHeights(after, opts)
  const afterIds = new Set((after.tracks ?? []).map(t => t.id))
  const held = was.points.filter(p => afterIds.has(p.trackId) || parted.has(p.trackId))

  // The gradient of every turnout a lock holds — after the write where locks
  // may go, else before it — at its toe and its two ldS.
  const frozen = unlock ? now.frozen : was.frozen
  const beforeTracks = new Map(before.tracks.map(t => [t.id, t]))
  const afterTracks = new Map(after.tracks.map(t => [t.id, t]))
  for (const switchId of frozen) {
    const a = turnoutHeightStations(before, switchId, opts)
    const b = turnoutHeightStations(after, switchId, opts)
    if (!a || !b) continue
    // The alignment comes first: a turnout whose tracks changed shape is not held.
    const reshaped = a.tracks.some(id => beforeTracks.get(id)?.elements !== afterTracks.get(id)?.elements)
    if (reshaped) continue
    for (let i = 0; i < a.at.length; i++) {
      const za = heightAt(beforeTracks.get(a.at[i].trackId)?.heights ?? [], a.at[i].station)
      const zb = heightAt(afterTracks.get(b.at[i].trackId)?.heights ?? [], b.at[i].station)
      if (za == null || zb == null) continue
      if (Math.abs(za - zb) > Z_TOL) return { kind: 'turnout', switchId, trackId: b.at[i].trackId, station: b.at[i].station }
    }
  }

  // Every locked height that was there is there still — as a multiset over
  // the project, since a split or a join moves points to other tracks. A lock
  // is laid by a write of its own, so points newly locked are no breach;
  // where locks may go, what is locked after the write was locked before it,
  // at its height.
  const [from, to] = unlock ? [now.points, held] : [held, now.points]
  const pool = [...to]
  for (const p of from) {
    const k = pool.findIndex(q => Math.abs(q.z - p.z) <= Z_TOL)
    if (k < 0) return { kind: 'point', trackId: p.trackId, station: p.station }
    pool.splice(k, 1)
  }
  return null
}
