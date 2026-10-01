import { elementStations, pointAtStation, stationFromClick } from '../platformUtils'
import { portsOf } from '../switchModel'

/**
 * Carrying a reference across a change of track ids (decision 93, merge rule 5).
 *
 * Splitting and joining tracks give the pieces new ids, and the working copy
 * logs that as `{ from, to: [ids] }` (see storage.js, the id log). What it does
 * not log is which piece a given point of the old track went to — and it does
 * not have to: the pieces lie exactly where the old track lay, so a reference
 * the other side made to the old track is carried over by geometry. A switch
 * port on `a.END` goes to the piece one of whose ends is where `a`'s end was; a
 * platform goes to the piece both of its stations lie on, at the stations
 * there. That holds however many splits and joins came in between, which a
 * table of offsets would have to replay one by one.
 */

/** Two ends are one node below this [m]. */
export const END_TOL = 0.01

/** A point lies on a track below this [m]. */
export const ON_TRACK_TOL = 0.05

const fromEntries = (log) => {
  const map = new Map()
  for (const e of log ?? []) {
    if (!e?.from || !Array.isArray(e.to)) continue
    if (!map.has(e.from)) map.set(e.from, [])
    map.get(e.from).push(...e.to)
  }
  return map
}

/** Every id the log derives from `id`, transitively (not `id` itself). */
export function descendants(id, log) {
  const next = fromEntries(log)
  const seen = new Set()
  const queue = [...(next.get(id) ?? [])]
  while (queue.length) {
    const cur = queue.shift()
    if (seen.has(cur) || cur === id) continue
    seen.add(cur)
    queue.push(...(next.get(cur) ?? []))
  }
  return seen
}

/** Whether the log split (`'split'`) or folded (`'joined'`) this track, or neither. */
export function remapKind(id, log) {
  const entries = (log ?? []).filter(e => e?.from === id && e.to?.some(t => t !== id))
  if (!entries.length) return null
  return entries.some(e => e.to.length > 1) ? 'split' : 'joined'
}

const planePoint = (node) => (Array.isArray(node) && Number.isFinite(node[0]) && Number.isFinite(node[1])
  ? { easting: node[0], northing: node[1] } : null)

const dist = (a, b) => Math.hypot(a.easting - b.easting, a.northing - b.northing)

/** A track end in its plane. */
export function endPoint(track, endpoint) {
  const els = track?.elements ?? []
  if (!els.length) return null
  return endpoint === 'BEGIN' ? planePoint(els[0].startNode) : planePoint(els[els.length - 1].endNode)
}

/** Nearest station of a plane point on a track, with its distance. */
export function stationOnTrack(track, utm) {
  let best = null
  for (const row of elementStations(track)) {
    const s = stationFromClick(track, row.index, utm)
    if (s == null) continue
    const p = pointAtStation(track, s)
    if (!p) continue
    const d = dist(p.utm, utm)
    if (!best || d < best.dist) best = { station: s, dist: d, bearing: p.bearing }
  }
  return best
}

/**
 * The end of one of `candidates` that `oldTrack`'s `endpoint` became, or null
 * when none or more than one end lies there.
 */
export function mapEnd(oldTrack, endpoint, candidates) {
  const at = endPoint(oldTrack, endpoint)
  if (!at) return null
  const hits = []
  for (const tr of candidates) {
    if (tr.epsg !== oldTrack.epsg) continue
    for (const end of ['BEGIN', 'END']) {
      const p = endPoint(tr, end)
      if (p && dist(p, at) < END_TOL) hits.push({ trackId: tr.id, endpoint: end })
    }
  }
  return hits.length === 1 ? hits[0] : null
}

const bearingGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

/**
 * Where a stretch [s0, s1] of `oldTrack` lies on one of `candidates`: the piece
 * both stations fall on, the stations there, and whether that piece runs the
 * other way. Null when the stretch is not on exactly one piece — a platform
 * over the place a track was split has no single track to stand on.
 */
export function mapStretch(oldTrack, s0, s1, candidates) {
  const p0 = pointAtStation(oldTrack, s0)
  const p1 = pointAtStation(oldTrack, s1)
  if (!p0 || !p1) return null
  const hits = []
  for (const tr of candidates) {
    if (tr.epsg !== oldTrack.epsg) continue
    const a = stationOnTrack(tr, p0.utm)
    const b = stationOnTrack(tr, p1.utm)
    if (!a || !b || a.dist > ON_TRACK_TOL || b.dist > ON_TRACK_TOL) continue
    hits.push({ trackId: tr.id, s0: a.station, s1: b.station, reversed: bearingGap(a.bearing, p0.bearing) > 90 })
  }
  return hits.length === 1 ? hits[0] : null
}

/**
 * Repoint the references of a merged record that name a track it no longer
 * has, through the id logs of both sides. `oldTracks` finds the old track's
 * geometry (base, or whichever side still had it).
 *
 * Returns the record (a new object, the input untouched) and the list of
 * references carried over: { collection, id, from, to }. A reference that
 * cannot be carried unambiguously is left as it is — validation then names it.
 */
export function carryReferences(project, logs, oldTracks) {
  const tracks = project.tracks ?? []
  const present = new Map(tracks.map(t => [t.id, t]))
  const carried = []
  const log = logs.flatMap(l => l ?? [])

  const candidatesFor = (id) => [...descendants(id, log)].map(d => present.get(d)).filter(Boolean)
  const oldTrack = (id) => oldTracks(id)

  const switches = (project.switches ?? []).map(sw => {
    let out = sw
    for (const { trackKey, endKey } of portsOf(sw)) {
      const id = sw[trackKey]
      if (!id || present.has(id)) continue
      const old = oldTrack(id)
      const cands = candidatesFor(id)
      if (!old || !cands.length) continue
      const hit = mapEnd(old, sw[endKey], cands)
      if (!hit) continue
      out = { ...out, [trackKey]: hit.trackId, [endKey]: hit.endpoint }
      carried.push({ collection: 'switches', id: sw.switchId, from: id, to: hit.trackId })
    }
    return out
  })

  const platforms = (project.platforms ?? []).map(pf => {
    if (!pf.trackId || present.has(pf.trackId)) return pf
    const old = oldTrack(pf.trackId)
    const cands = candidatesFor(pf.trackId)
    if (!old || !cands.length) return pf
    const hit = mapStretch(old, pf.startStation, pf.endStation, cands)
    if (!hit) return pf
    carried.push({ collection: 'platforms', id: pf.id, from: pf.trackId, to: hit.trackId })
    const flip = hit.reversed
    return {
      ...pf,
      trackId: hit.trackId,
      startStation: round(flip ? hit.s1 : hit.s0),
      endStation:   round(flip ? hit.s0 : hit.s1),
      ...(flip && pf.side ? { side: pf.side === 'left' ? 'right' : 'left' } : {}),
    }
  })

  const endMarks = (project.endMarks ?? []).map(m => {
    if (!m.trackId || present.has(m.trackId)) return m
    const old = oldTrack(m.trackId)
    const cands = candidatesFor(m.trackId)
    if (!old || !cands.length) return m
    const hit = mapEnd(old, m.endpoint, cands)
    if (!hit) return m
    carried.push({ collection: 'endMarks', id: m.id, from: m.trackId, to: hit.trackId })
    return { ...m, trackId: hit.trackId, endpoint: hit.endpoint }
  })

  const out = { ...project }
  if (project.switches)  out.switches  = switches
  if (project.platforms) out.platforms = platforms
  if (project.endMarks)  out.endMarks  = endMarks
  return { project: out, carried }
}

// Stations to the millimetre: what a projection adds below that is noise.
const round = (s) => Math.round(s * 1000) / 1000
