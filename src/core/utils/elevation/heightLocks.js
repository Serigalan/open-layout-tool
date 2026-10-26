// Locked height points (Entscheidung 382). A locked point keeps its height
// and its station — the table and the profile let neither be typed. The
// store asks lockBreach after every write, the turnouts' lines and coupling
// done (decision 384), and refuses the write where it would change a locked
// height: that way it holds for every way heights change (profile, table,
// taking a height over, the terrain fill, the coupling itself) — a locked
// WA or ldS holds its turnout, a locked point behind one the line through it.
// A change of the track's geometry may still move a locked point along it —
// the alignment comes first —, its height stays.

/** Heights that agree to this already agree: they are kept to 0.1 mm [m]. */
const Z_TOL = 0.00006

/** Every locked point of a project: [{ trackId, station, z }]. */
function lockedPoints(project) {
  const out = []
  for (const t of project?.tracks ?? []) for (const p of t.heights ?? []) if (p.locked) out.push({ trackId: t.id, station: p.station, z: p.z })
  return out
}

/**
 * What a write from `before` to `after` would change that a lock holds, or
 * null: { kind: 'point', trackId, station } for a locked point whose height
 * changed or that went.
 *
 * `unlock`: the write may take locks away (unlocking, or deleting a locked
 * point after asking) — then only what is still locked after it is held.
 * `parted`: the ids of tracks the write split or joined into others, whose
 * locked points live on there. A track that is simply gone takes its points
 * with it.
 */
export function lockBreach(before, after, { unlock = false, parted = new Set() } = {}) {
  const was = lockedPoints(before)
  if (!was.length && !unlock) return null
  const now = lockedPoints(after)
  const afterIds = new Set((after.tracks ?? []).map(t => t.id))
  const held = was.filter(p => afterIds.has(p.trackId) || parted.has(p.trackId))

  // Every locked height that was there is there still — as a multiset over
  // the project, since a split or a join moves points to other tracks. A lock
  // is laid by a write of its own, so points newly locked are no breach;
  // where locks may go, what is locked after the write was locked before it,
  // at its height.
  const [from, to] = unlock ? [now, held] : [held, now]
  const pool = [...to]
  for (const p of from) {
    const k = pool.findIndex(q => Math.abs(q.z - p.z) <= Z_TOL)
    if (k < 0) return { kind: 'point', trackId: p.trackId, station: p.station }
    pool.splice(k, 1)
  }
  return null
}
