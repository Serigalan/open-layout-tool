import { pointAtStationUtm } from '../track'
import { offsetOnElement } from './mdbSwitchDerive'

/**
 * Axis fragments the file states twice — ProVI's „Gleisachsen bereinigen“.
 *
 * A delivery can carry one stretch more than once: Satzart 33 files an element
 * under every Gleisabschnitt it belongs to (68 elements of the test database
 * under two or three track numbers, each built once per number), and a planned
 * Trasse or a second survey lays its own points over a track that is already
 * there. Each copy becomes a track of its own, and a stretch held by two
 * tracks is one no switch can be placed on: the turnout finds a second track
 * where its stem should run on.
 *
 * A track that lies **entirely** on another one — every metre of it within
 * COVER_TOL of the other's axis — is such a copy and is left out. Where two
 * cover each other the longer one stays, between equals the first. A track
 * that lies only partly on another is a real overlap the import cannot settle
 * (which one is the survey?) and is named, not cut.
 *
 * Only tracks of one plane are compared: chains of two Lagesysteme describing
 * the same stretch are a matter for the plane boundary, where links join them.
 */

/** Lateral distance up to which a point lies on another track's axis [m] — the spec's „Toleranz für Achsen“. */
export const COVER_TOL = 0.01

/** Distance between the points a track is tested at [m]. */
const STEP = 1

/**
 * Shorter tracks are not tested. A branch leaves its stem by s²/2R, so the
 * first two metres of an R 190 branch stay within a centimetre of it — a stub
 * that short at a toe would read as a copy of the stem.
 */
const MIN_LENGTH = 3

/** A track that lies on another for at least this share of its length is reported. */
const PARTIAL_SHARE = 0.5

/** Side of the index grid [m]. */
const CELL = 50

const trackLength = (t) => (t.elements ?? []).reduce((s, e) => s + (e.length ?? 0), 0)

/** How far an arc's middle leaves its chord [m]. */
function bulge(el) {
  const r = Math.abs(Number(el.radius) || Number(el.r1) || Number(el.r2) || 0)
  return r ? ((el.length ?? 0) ** 2) / (8 * r) : 0
}

/** Every element filed by the grid cells its chord's box touches, per plane. */
function elementGrid(tracks) {
  const cells = new Map()
  for (const track of tracks) {
    for (const el of track.elements ?? []) {
      if (!el.startNode || !el.endNode) continue
      const pad = bulge(el) + COVER_TOL
      const cx0 = Math.floor((Math.min(el.startNode[0], el.endNode[0]) - pad) / CELL)
      const cx1 = Math.floor((Math.max(el.startNode[0], el.endNode[0]) + pad) / CELL)
      const cy0 = Math.floor((Math.min(el.startNode[1], el.endNode[1]) - pad) / CELL)
      const cy1 = Math.floor((Math.max(el.startNode[1], el.endNode[1]) + pad) / CELL)
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = `${track.epsg}/${cx}/${cy}`
          if (!cells.has(key)) cells.set(key, [])
          cells.get(key).push({ track, el })
        }
      }
    }
  }
  return cells
}

/** The point at a station along a track, in its plane. */
function pointAt(track, station) {
  let acc = 0
  for (const el of track.elements ?? []) {
    const L = el.length ?? 0
    if (station <= acc + L) {
      const p = pointAtStationUtm(el, Math.max(0, station - acc), track.epsg)
      return [p.easting, p.northing]
    }
    acc += L
  }
  return track.elements?.[track.elements.length - 1]?.endNode ?? null
}

/** The points a track is tested at: every STEP metres and both ends, in its plane. */
function samplesOf(track) {
  const out = []
  for (const el of track.elements ?? []) {
    const L = el.length ?? 0
    for (let s = 0; s < L; s += STEP) {
      const p = pointAtStationUtm(el, s, track.epsg)
      out.push([p.easting, p.northing])
    }
  }
  const last = track.elements?.[track.elements.length - 1]
  if (last?.endNode) out.push(last.endNode)
  return out
}

/** The elements of the grid cell a point falls in. */
const cellAt = (cells, epsg, pt) => cells.get(`${epsg}/${Math.floor(pt[0] / CELL)}/${Math.floor(pt[1] / CELL)}`) ?? []

/**
 * The tracks of `among` (all but `self` where it is null) whose axis passes
 * within COVER_TOL of a point.
 */
function tracksAt(cells, epsg, pt, self, among = null) {
  const found = new Set()
  for (const { track, el } of cellAt(cells, epsg, pt)) {
    if (track === self || found.has(track) || (among && !among.has(track))) continue
    if (offsetOnElement(el, pt, epsg).dist <= COVER_TOL) found.add(track)
  }
  return found
}

/**
 * Which tracks are copies of others, and which overlap others in part.
 *
 * Returns `{ tracks, dropped, partial }`: the tracks without the copies, each
 * copy as `{ track, by }`, each partial overlap as `{ track, by, share }`.
 */
export function dropCoveredTracks(tracks) {
  const cells = elementGrid(tracks)
  const order = new Map(tracks.map((t, i) => [t, i]))
  const covered = []
  const partial = []
  for (const track of tracks) {
    const length = trackLength(track)
    if (length < MIN_LENGTH) continue
    // Whatever overlaps half the track or more passes one of these three; only
    // a track that has company there is walked metre by metre.
    const probes = [0.25, 0.5, 0.75].map(f => pointAt(track, f * length)).filter(Boolean)
    const candidates = new Set(probes.flatMap(p => [...tracksAt(cells, track.epsg, p, track)]))
    if (!candidates.size) continue
    const on = new Map([...candidates].map(c => [c, 0]))
    const pts = samplesOf(track)
    for (const p of pts) {
      for (const other of tracksAt(cells, track.epsg, p, track, candidates)) on.set(other, on.get(other) + 1)
    }
    for (const [other, n] of on) {
      if (n === pts.length) covered.push({ track, by: other })
      else if (n >= PARTIAL_SHARE * pts.length) partial.push({ track, by: other, share: n / pts.length })
    }
  }

  // Two tracks covering each other are the same stretch: the longer stays,
  // between equals the one the file lists first. A track whose cover is itself
  // dropped is not dropped on its account — what covers that one covers it too
  // and is in the list on its own.
  const dropped = new Map()
  const keeps = (a, b) => {
    const la = trackLength(a), lb = trackLength(b)
    return Math.abs(la - lb) > COVER_TOL ? la > lb : order.get(a) < order.get(b)
  }
  covered.sort((x, y) => trackLength(x.track) - trackLength(y.track) || order.get(y.track) - order.get(x.track))
  for (const { track, by } of covered) {
    if (dropped.has(track) || dropped.has(by)) continue
    const mutual = covered.some(c => c.track === by && c.by === track)
    if (mutual && keeps(track, by)) continue
    dropped.set(track, by)
  }
  // A copy is named with the track that stays: a copy of a copy lies on what
  // the first one lay on.
  const kept = (t) => { while (dropped.has(t)) t = dropped.get(t); return t }
  return {
    tracks: tracks.filter(t => !dropped.has(t)),
    dropped: [...dropped].map(([track, by]) => ({ track, by: kept(by) })),
    partial: partial.filter(p => !dropped.has(p.track) && !dropped.has(p.by)),
  }
}
