import { resolveRoute, reverseTrack, flipSwitchEndpoints } from '../track'
import { reverseElement } from '../geometry'
import { elementRoles } from './elementRoles'

// What the element table shows (Entscheidung 381): one track, or a route —
// its tracks in the order it runs them, each turned into the route's
// direction where the route runs it against its own. Every row stands for
// one element of one track; what is typed into a row is written onto that
// element, turned back into the track's direction. A geometry edit and a role
// act in the view's direction: a track the route runs against is turned round
// for them (inRun) and back, so what follows an element is what follows it
// along the route.

/**
 * The parts a table shows, in order: [{ trackId, reversed }]. A track is one
 * part as it runs; a route its tracks as resolveRoute reads them (decision
 * 248), `gaps` where it is broken.
 */
export function tableParts({ trackId = null, route = null }, tracks, switches) {
  if (!route) return { parts: trackId ? [{ trackId, reversed: false }] : [], gaps: [] }
  const res = resolveRoute(route, tracks, switches)
  return { parts: res.parts.map(p => ({ trackId: p.trackId, reversed: p.reversed })), gaps: res.gaps }
}

/**
 * The rows of those parts as the table reads them: `elements` one chain in
 * the view's direction (a reversed part's elements turned round and in
 * reverse order), `rows` per element { trackId, index, reversed, epsg } — the
 * track element it is — and `stations` [{ start, end }] along the view,
 * `length` the whole of it.
 */
export function tableRows(parts, tracks) {
  const byId = new Map((tracks ?? []).map(t => [t.id, t]))
  const elements = [], rows = [], stations = []
  let at = 0
  for (const part of parts) {
    const track = byId.get(part.trackId)
    const els = track?.elements ?? []
    const order = part.reversed ? els.map((_, i) => els.length - 1 - i) : els.map((_, i) => i)
    for (const index of order) {
      const el = part.reversed ? reverseElement(els[index]) : els[index]
      elements.push(el)
      rows.push({ trackId: part.trackId, index, reversed: part.reversed, epsg: track.epsg })
      stations.push({ start: at, end: at + (el.length ?? 0) })
      at += el.length ?? 0
    }
  }
  return { elements, rows, stations, length: at }
}

/** The row of a track element in the view, or −1 where the view does not show it. */
export const rowOf = (rows, trackId, index) => rows.findIndex(r => r.trackId === trackId && r.index === index)

/** A row's element's index in its track as the view runs it. */
const runIndex = (row, count) => (row.reversed ? count - 1 - row.index : row.index)

/**
 * What the elements may take, per row (elementRoles, Entscheidung 375): read
 * on each track in the view's direction — a Folgeelement takes the elements
 * after it along the view — with `by` turned into the row that sets it.
 */
export function tableRoles(rows, tracks) {
  const byId = new Map((tracks ?? []).map(t => [t.id, t]))
  const perTrack = new Map()
  return rows.map(r => {
    const els = byId.get(r.trackId)?.elements ?? []
    if (!perTrack.has(r.trackId)) perTrack.set(r.trackId, elementRoles(r.reversed ? [...els].reverse() : els))
    const role = perTrack.get(r.trackId)[runIndex(r, els.length)]
    if (!role || role.by == null) return role
    const index = r.reversed ? els.length - 1 - role.by : role.by
    return { ...role, by: rowOf(rows, r.trackId, index) }
  })
}

/**
 * An edit of a row's track done in the view's direction: `edit(tracks,
 * switches, index)` gets the project with that track turned round where the
 * row's part is reversed (its switch ports with it) and the element's index
 * there, and returns { tracks, … } as planElementChange does; the track comes
 * back in its own direction.
 */
export function inRun(row, tracks, switches, edit) {
  const track = tracks.find(t => t.id === row.trackId)
  if (!track) return null
  const index = runIndex(row, track.elements?.length ?? 0)
  if (!row.reversed) return edit(tracks, switches, index)
  const turned = tracks.map(t => (t.id === row.trackId ? reverseTrack(t) : t))
  const out = edit(turned, flipSwitchEndpoints(switches, row.trackId), index)
  if (!out?.tracks) return out
  return { ...out, tracks: out.tracks.map(t => (t.id === row.trackId ? reverseTrack(t) : t)) }
}

/**
 * A value typed into a row as its track element takes it: in a reversed part
 * a radius and a cant change sign, and the cant at the element's start is the
 * one at its end. Returns { key, value }. (Geometry goes through inRun.)
 */
export function trackEdit(row, key, value) {
  if (!row?.reversed) return { key, value }
  const neg = (v) => (v == null || !Number.isFinite(v) ? v : -v)
  if (key === 'radius' || key === 'cant') return { key, value: neg(value) }
  if (key === 'cantStart') return { key: 'cantEnd', value: neg(value) }
  if (key === 'cantEnd') return { key: 'cantStart', value: neg(value) }
  return { key, value }
}

/**
 * The tracks with the view's elements `elements` (tableRows' chain, as
 * something rewrote it field by field — speeds, say) written back onto the
 * track elements they stand for, turned back where the part is reversed.
 * Only tracks that changed are new objects.
 */
export function writeRows(tracks, rows, elements) {
  const edits = new Map()
  rows.forEach((r, i) => {
    const el = r.reversed ? reverseElement(elements[i]) : elements[i]
    if (!edits.has(r.trackId)) edits.set(r.trackId, new Map())
    edits.get(r.trackId).set(r.index, el)
  })
  return tracks.map(t => {
    const mine = edits.get(t.id)
    if (!mine) return t
    let changed = false
    const els = (t.elements ?? []).map((e, i) => {
      const next = mine.get(i)
      if (!next || sameFields(e, next)) return e
      changed = true
      return { ...e, ...diffFields(e, next) }
    })
    return changed ? { ...t, elements: els } : t
  })
}

/** The fields a rewritten element states differently — not its geometry, which turning round rebuilds. */
const GEOMETRY = new Set(['geometry', 'renderCoords', 'startNode', 'endNode', 'bearing', 'endBearing'])
function diffFields(old, next) {
  const out = {}
  for (const [k, v] of Object.entries(next)) if (!GEOMETRY.has(k) && old[k] !== v) out[k] = v
  return out
}
const sameFields = (a, b) => Object.keys(diffFields(a, b)).length === 0
