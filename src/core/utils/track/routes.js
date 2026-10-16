import { tracksOnFrom } from './topology'
import { trackLength } from './heightUtils'
import { pointAtStation, stationOnTrack } from './platformUtils'

/**
 * Routes (Paket RT): a named run of connected tracks — over joints, links and
 * the routes of switches — with stations of its own from 0 in its direction.
 *
 * A route stores its name and its tracks in the order it runs them, nothing
 * else (decision 248): which way it runs each track follows from where they
 * meet — the end of track i that leads to track i+1 — so turning a track
 * round leaves the route right. A route of one track runs with that track.
 * Two tracks in a row that do not meet are a gap: the route is broken there,
 * and says so.
 */

const other = (end) => (end === 'BEGIN' ? 'END' : 'BEGIN')

/** The ends at which `a` leads onto `b`: [{ exit (end of a), entry (end of b) }]. */
function links(a, b, tracks, switches) {
  const out = []
  for (const exit of ['END', 'BEGIN']) {
    for (const o of tracksOnFrom(a, exit, tracks, switches)) {
      if (o.trackId === b) out.push({ exit, entry: o.endpoint })
    }
  }
  return out
}

/**
 * A route as it lies in the project: its parts in order, each { trackId,
 * track, reversed, offset, length } — `offset` the route station it begins at,
 * `reversed` whether the route runs it against its stations — the route's
 * length, and where it is broken: `gaps` [{ after, kind }] with `after` the
 * index of the part before the gap (−1 before the first) and `kind`
 * 'missing' (a track the project no longer has; `trackId` names it) or
 * 'disconnected' (two parts that do not meet).
 */
export function resolveRoute(route, tracks, switches) {
  const byId = new Map((tracks ?? []).map(t => [t.id, t]))
  const gaps = []
  const present = []
  for (const id of route?.trackIds ?? []) {
    if (byId.has(id)) present.push(id)
    else gaps.push({ after: present.length - 1, kind: 'missing', trackId: id })
  }
  // How each part is run: entered at one end, left at the other.
  const entry = new Array(present.length).fill(null)
  const exit = new Array(present.length).fill(null)
  for (let i = 0; i + 1 < present.length; i++) {
    const found = links(present[i], present[i + 1], tracks, switches)
    // Leave a part at the end it was not entered by.
    const pick = found.find(l => !entry[i] || l.exit === other(entry[i]))
    if (!pick) {
      if (!gaps.some(g => g.after === i)) gaps.push({ after: i, kind: 'disconnected' })
      continue
    }
    exit[i] = pick.exit
    entry[i + 1] = pick.entry
  }
  const parts = []
  let offset = 0
  present.forEach((id, i) => {
    const track = byId.get(id)
    const reversed = entry[i] ? entry[i] === 'END' : exit[i] ? exit[i] === 'BEGIN' : false
    const length = trackLength(track)
    parts.push({ trackId: id, track, reversed, offset, length })
    offset += length
  })
  gaps.sort((a, b) => a.after - b.after)
  return { route, parts, length: offset, gaps, ok: parts.length > 0 && gaps.length === 0 }
}

/** A track's own station from the station along one part of a route. */
export const partStation = (part, s) => (part.reversed ? part.length - s : s)

/**
 * Where route station `s` lies: { part, index, trackId, station } — the part
 * and the track's own station there. At the joint of two parts the later one,
 * except at the route's end. Null for a route without parts.
 */
export function routeAt(resolved, s) {
  const parts = resolved?.parts ?? []
  if (!parts.length) return null
  const at = Math.max(0, Math.min(resolved.length, s))
  let index = parts.findIndex(p => at < p.offset + p.length)
  if (index < 0) index = parts.length - 1
  const part = parts[index]
  const local = Math.max(0, Math.min(part.length, at - part.offset))
  return { part, index, trackId: part.trackId, station: partStation(part, local) }
}

/** The route station of a track's own station, on the first part that runs that track — null where none does. */
export function routeStationOf(resolved, trackId, station) {
  const part = (resolved?.parts ?? []).find(p => p.trackId === trackId)
  if (!part) return null
  const local = Math.max(0, Math.min(part.length, station))
  return part.offset + partStation(part, local)
}

/** The point at route station `s`, as pointAtStation gives it, with the bearing the route runs in. */
export function routePointAt(resolved, s) {
  const at = routeAt(resolved, s)
  const p = at && pointAtStation(at.part.track, at.station)
  if (!p) return null
  return { ...p, bearing: at.part.reversed ? (p.bearing + 180) % 360 : p.bearing, trackId: at.trackId, station: at.station }
}

/**
 * The shortest run of tracks from track `fromId`, left at one of `exits`, to
 * track `toId` — over joints and the routes of switches — as the tracks after
 * `fromId` up to and including `toId`. Null where `toId` cannot be reached.
 * Each track counts with its length; the one aimed at with none.
 */
export function routePath(tracks, switches, fromId, exits, toId) {
  const byId = new Map((tracks ?? []).map(t => [t.id, t]))
  const best = new Map()        // `${trackId}|${entry}` → { cost, prev }
  const queue = []
  const push = (trackId, entry, cost, prev) => {
    const key = `${trackId}|${entry}`
    if (best.has(key) && best.get(key).cost <= cost) return
    best.set(key, { cost, prev, trackId })
    queue.push({ key, cost })
  }
  for (const exit of exits) {
    for (const o of tracksOnFrom(fromId, exit, tracks, switches)) push(o.trackId, o.endpoint, 0, null)
  }
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost)
    const { key, cost } = queue.shift()
    const node = best.get(key)
    if (node.cost < cost) continue
    if (node.trackId === toId) {
      const path = []
      for (let k = key; k; k = best.get(k).prev) path.unshift(best.get(k).trackId)
      return path
    }
    if (node.trackId === fromId) continue
    const track = byId.get(node.trackId)
    if (!track) continue
    const entry = key.slice(key.lastIndexOf('|') + 1)
    const next = cost + trackLength(track)
    for (const o of tracksOnFrom(node.trackId, other(entry), tracks, switches)) push(o.trackId, o.endpoint, next, key)
  }
  return null
}

/**
 * The route with `trackId` added at its end (decision 250): directly where it
 * meets the last part, else over the shortest connected run to it. Returns
 * { trackIds, added } — `added` the tracks that came in, empty where the track
 * cannot be reached (the route then stays as it was) or is the last already.
 */
export function extendRoute(trackIds, trackId, tracks, switches) {
  if (!trackIds.length) return { trackIds: [trackId], added: [trackId] }
  const last = trackIds[trackIds.length - 1]
  if (last === trackId) return { trackIds, added: [] }
  // The end the route leaves its last track by — both, while it has one track.
  const resolved = resolveRoute({ trackIds }, tracks, switches)
  const lastPart = resolved.parts[resolved.parts.length - 1]
  const exits = !lastPart ? [] : resolved.parts.length === 1 ? ['END', 'BEGIN'] : [lastPart.reversed ? 'BEGIN' : 'END']
  const path = routePath(tracks, switches, last, exits, trackId)
  if (!path) return { trackIds, added: [] }
  // A route of one track that turns out to leave by its begin runs it backwards — fine, that is read from the joints.
  return { trackIds: [...trackIds, ...path], added: path }
}

/**
 * The route with every gap between two tracks that do not meet closed over
 * the shortest connected run between them, where there is one. Returns
 * { trackIds, closed, open } — how many gaps were closed and how many are left.
 */
export function closeGaps(trackIds, tracks, switches) {
  const resolved = resolveRoute({ trackIds }, tracks, switches)
  const ids = resolved.parts.map(p => p.trackId)
  const out = []
  let closed = 0, open = 0
  ids.forEach((id, i) => {
    out.push(id)
    if (!resolved.gaps.some(g => g.after === i && g.kind === 'disconnected')) return
    // Left by the end it was not entered by — either end where it was not entered from a track before.
    const entered = i > 0 && !resolved.gaps.some(g => g.after === i - 1)
    const exits = entered ? [resolved.parts[i].reversed ? 'BEGIN' : 'END'] : ['END', 'BEGIN']
    const path = routePath(tracks, switches, id, exits, ids[i + 1])
    if (!path) { open++; return }
    out.push(...path.slice(0, -1))
    closed++
  })
  return { trackIds: out, closed, open }
}

// ── Tracks that went away ───────────────────────────────────────────────────

/** A point lies on a track below this [m]. */
const ON_TRACK = 0.05
/** The old track is looked at every this much [m] for what lies there now. */
const SAMPLE_EVERY = 5

/**
 * The tracks among `candidates` that now lie where `oldTrack` lay, in the
 * order of its stations: looked for every few metres along it, and at the
 * middle of every candidate, so a short piece is found too.
 */
export function piecesAlong(oldTrack, candidates) {
  const length = trackLength(oldTrack)
  if (!(length > 0)) return []
  const cands = candidates.filter(c => c.epsg === oldTrack.epsg && c.elements?.length)
  if (!cands.length) return []
  const stations = []
  for (let s = 0.05; s < length - 0.05; s += SAMPLE_EVERY) stations.push(s)
  stations.push(Math.max(0, length - 0.05))
  for (const c of cands) {
    const mid = pointAtStation(c, trackLength(c) / 2)
    const on = mid && stationOnTrack(oldTrack, mid.utm)
    if (on && on.dist < ON_TRACK) stations.push(on.station)
  }
  stations.sort((a, b) => a - b)
  const out = []
  for (const s of stations) {
    const p = pointAtStation(oldTrack, s)
    if (!p) continue
    let hit = null
    for (const c of cands) {
      const on = stationOnTrack(c, p.utm)
      if (on && on.dist < ON_TRACK && (!hit || on.dist < hit.dist)) hit = { id: c.id, dist: on.dist }
    }
    if (hit && out[out.length - 1] !== hit.id) out.push(hit.id)
  }
  return out
}

/** Whether two tracks meet at an end, either way round. */
const meet = (a, b, tracks, switches) => links(a, b, tracks, switches).length > 0

/**
 * A route whose tracks are no longer all in the project, with each missing
 * one replaced by the tracks that now lie where it lay (decision 249) — in
 * the order that meets the part before it, else the next. `oldTrack(id)` gives
 * the geometry the track had, `candidates(id)` the tracks it may have become.
 * A track nothing lies on any more is dropped. The route itself where nothing
 * is missing.
 */
export function repairRoute(route, tracks, switches, oldTrack, candidates) {
  const present = new Set((tracks ?? []).map(t => t.id))
  if ((route.trackIds ?? []).every(id => present.has(id))) return route
  const ids = route.trackIds
  const out = []
  ids.forEach((id, i) => {
    if (present.has(id)) { out.push(id); return }
    const old = oldTrack(id)
    let pieces = old ? piecesAlong(old, candidates(id)) : []
    if (pieces.length > 1) {
      const prev = out[out.length - 1]
      const next = ids.slice(i + 1).find(x => present.has(x))
      const forward = prev ? meet(prev, pieces[0], tracks, switches)
        : next ? meet(pieces[pieces.length - 1], next, tracks, switches) : true
      if (!forward) pieces = [...pieces].reverse()
    }
    for (const p of pieces) if (out[out.length - 1] !== p) out.push(p)
  })
  return { ...route, trackIds: out }
}

/**
 * The project's routes after a write that took tracks away (storage.js,
 * every write comes by here): a track `before` had and `after` has not is
 * replaced by what the write brought or changed where it lay. The routes as
 * they were when nothing is missing.
 */
export function repairRoutes(before, after) {
  const routes = after?.routes
  if (!routes?.length) return after
  const present = new Set((after.tracks ?? []).map(t => t.id))
  if (routes.every(r => (r.trackIds ?? []).every(id => present.has(id)))) return after
  const old = new Map((before?.tracks ?? []).map(t => [t.id, t]))
  const touched = (after.tracks ?? []).filter(t => old.get(t.id) !== t)
  const next = routes.map(r => repairRoute(r, after.tracks, after.switches, (id) => old.get(id) ?? null, () => touched))
  return next.every((r, i) => r === routes[i]) ? after : { ...after, routes: next }
}

/** A new route's name: "Route n", the first n not taken. */
export function nextRouteName(routes, base = 'Route') {
  const taken = new Set((routes ?? []).map(r => r.name))
  let n = (routes?.length ?? 0) + 1
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}
