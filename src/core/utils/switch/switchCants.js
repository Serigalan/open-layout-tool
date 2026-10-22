import { cantEnds, withCantAtEnd, withCantsOver } from '../geometry'
import { portEnd, portTrack } from '../track'
import { switchAbreast } from './route'

// A turnout lies on one set of sleepers, so its two routes carry one cant
// side by side (Entscheidung 367). Laying it reads the branch off the track
// it is laid into; this keeps the two together afterwards (Entscheidung 376):
// whichever route a write changed the cant of, the other takes it.

const isTurnout = (sw) => (sw?.kind ?? 'turnout') === 'turnout'

/** Two plane nodes this close are one [m]. */
const NODE_TOL = 0.001
/** Two cants this close are one [mm] — the thousandth a record keeps. */
const SAME_CANT = 0.001
/** Turnouts coupled again after a pass changed one of their tracks, at most this often. */
const MAX_PASSES = 24

const near = (a, b) => Array.isArray(a) && Array.isArray(b) && Math.hypot(a[0] - b[0], a[1] - b[1]) <= NODE_TOL

/**
 * The elements of each route of every turnout, by switch id: { main, branch },
 * each { trackId, from, to } — the run of the track's elements marked with
 * the switch and the route.
 */
function routeRuns(tracks) {
  const out = new Map()
  for (const tr of tracks ?? []) {
    ;(tr.elements ?? []).forEach((el, i) => {
      if (!el.switchId || (el.switchRoute !== 'main' && el.switchRoute !== 'branch')) return
      if (!out.has(el.switchId)) out.set(el.switchId, {})
      const runs = out.get(el.switchId)
      const run = runs[el.switchRoute]
      if (!run) runs[el.switchRoute] = { trackId: tr.id, from: i, to: i }
      else if (run.trackId === tr.id && run.to === i - 1) run.to = i
    })
  }
  return out
}

/**
 * One route of a turnout as it runs from the toe (WA): its elements in that
 * order with the station each starts at, whether it runs against its track
 * (`reversed`), and the signed cant along it in the frame of the toe — the
 * track's sign turned where the track runs the other way, since the cant is
 * signed by the raised rail as seen along the track.
 */
function oriented(track, run, toe) {
  const els = track.elements
  const reversed = !near(els[run.from].startNode, toe)
  const idx = []
  for (let i = run.from; i <= run.to; i++) idx.push(i)
  if (reversed) idx.reverse()
  const sign = reversed ? -1 : 1
  let s = 0
  const pieces = idx.map(i => {
    const e = cantEnds(els, i)
    const [a, b] = reversed ? [e.end, e.start] : [e.start, e.end]
    const piece = { index: i, s0: s, length: els[i].length ?? 0, start: sign * a, end: sign * b }
    s += piece.length
    return piece
  })
  return { track, run, reversed, sign, pieces, length: s }
}

/** The cant of an oriented route at station `u` from the toe, linear along each element. */
function cantAt(route, u) {
  const { pieces } = route
  const p = pieces.find(q => u <= q.s0 + q.length + 1e-9) ?? pieces[pieces.length - 1]
  const t = p.length > 0 ? Math.min(1, Math.max(0, (u - p.s0) / p.length)) : 0
  return p.start + (p.end - p.start) * t
}

/** Where the elements under the turnout change, from the toe — the stations its routes part at. */
const jointsOf = (route) => route.pieces.slice(1).map(p => p.s0)

/** The toe: the node the two routes start from. */
function toeOf(tracks, runs) {
  const m = tracks.get(runs.main.trackId), b = tracks.get(runs.branch.trackId)
  if (!m || !b) return null
  const ends = (tr, run) => [tr.elements[run.from].startNode, tr.elements[run.to].endNode]
  for (const p of ends(m, runs.main)) for (const q of ends(b, runs.branch)) if (near(p, q)) return p
  return null
}

/** Does the cant along a route differ between two states of its track? */
function cantChanged(before, after, run) {
  if (!before || before === after) return false
  if (before.elements.length !== after.elements.length) return true
  for (let i = run.from; i <= run.to; i++) {
    const a = cantEnds(before.elements, i), b = cantEnds(after.elements, i)
    if (Math.abs(a.start - b.start) > SAME_CANT || Math.abs(a.end - b.end) > SAME_CANT) return true
  }
  return false
}

/**
 * The track of route `to` with the cant of route `from` laid onto it: each of
 * its elements takes, at both ends, the cant of `from` at the station abreast
 * (switchAbreast over the joints of the route the turnout was laid onto —
 * `host`), and its track carries it on over the run's ends. Null where it
 * carries that cant already.
 */
function laidOnto(from, to, host) {
  const joints = jointsOf(host)
  const at = (u) => to.sign * cantAt(from, switchAbreast(u, joints, to.length, from.length))
  const byIndex = new Map(to.pieces.map(p => [p.index, [at(p.s0), at(p.s0 + p.length)]]))
  let differs = false
  const ends = []
  for (let i = to.run.from; i <= to.run.to; i++) {
    const [a, b] = byIndex.get(i)
    const [start, end] = to.reversed ? [b, a] : [a, b]
    const e = cantEnds(to.track.elements, i)
    if (Math.abs(e.start - start) > SAME_CANT || Math.abs(e.end - end) > SAME_CANT) differs = true
    ends.push([start, end])
  }
  if (!differs) return null
  return { ...to.track, elements: withCantsOver(to.track.elements, to.run.from, to.run.to, ends) }
}

/** One pass over the turnouts `only`: each one's led route laid onto the other. */
function couplePass(beforeTracks, tracks, switches, only) {
  const was = new Map((beforeTracks ?? []).map(t => [t.id, t]))
  let byId = new Map(tracks.map(t => [t.id, t]))
  const changed = new Set()
  for (const sw of switches ?? []) {
    if (!only.has(sw.switchId) || !isTurnout(sw)) continue
    const runs = routeRuns([...byId.values()]).get(sw.switchId)
    if (!runs?.main || !runs?.branch) continue
    const toe = toeOf(byId, runs)
    if (!toe) continue
    const main = oriented(byId.get(runs.main.trackId), runs.main, toe)
    const branch = oriented(byId.get(runs.branch.trackId), runs.branch, toe)
    if (main.track.id === branch.track.id) continue
    const set = (track) => {
      byId = new Map(byId).set(track.id, track)
      changed.add(track.id)
    }
    // The track running up to the toe, and the cant it has there in the
    // routes' frame: one running up to the toe runs as they do, one leaving
    // from it against them.
    const approach = byId.get(portTrack(sw, 'A'))
    const end = portEnd(sw, 'A') === 'BEGIN' ? 'BEGIN' : 'END'
    const frame = end === 'END' ? 1 : -1
    const toeCant = (track) => {
      const els = track?.elements ?? []
      if (!els.length) return null
      const e = cantEnds(els, end === 'END' ? els.length - 1 : 0)
      return frame * (end === 'END' ? e.end : e.start)
    }
    const ownApproach = approach && approach.id !== main.track.id && approach.id !== branch.track.id
    const mainLed = cantChanged(was.get(main.track.id), main.track, runs.main)
    const branchLed = cantChanged(was.get(branch.track.id), branch.track, runs.branch)
    if (!mainLed && !branchLed) {
      // Only the track up to the toe changed there: the main route starts with
      // its cant, and the branch follows it on the next pass.
      const before = was.get(approach?.id)
      const v = ownApproach ? toeCant(approach) : null
      if (v == null || !before || before === approach || Math.abs((toeCant(before) ?? v) - v) <= SAME_CANT
        || Math.abs(cantAt(main, 0) - v) <= SAME_CANT) continue
      set({ ...main.track, elements: withCantAtEnd(main.track.elements, main.reversed ? 'END' : 'BEGIN', main.sign * v) })
      continue
    }
    // The route the write changed leads; both changed, the main route does.
    const [lead, follow] = branchLed && !mainLed ? [branch, main] : [main, branch]
    const next = laidOnto(lead, follow, sw.swapped ? branch : main)
    if (next) set(next)
    // The track running up to the toe meets it with the same cant.
    if (ownApproach) {
      const v = cantAt(lead, 0)
      if (Math.abs(toeCant(approach) - v) > SAME_CANT) {
        set({ ...approach, elements: withCantAtEnd(approach.elements, end, frame * v) })
      }
    }
  }
  return { tracks: changed.size ? tracks.map(t => byId.get(t.id) ?? t) : tracks, changed }
}

/**
 * The tracks `after` with the cant of every turnout's two routes coupled
 * (Entscheidung 376): where a write (`before` → `after`) changed the cant
 * along one route of a turnout, the other route takes it — element by
 * element at the station abreast, as the turnout was laid — and its track
 * carries it on over the route's ends to the next element that states its
 * ends. That track may be a route of the next turnout (a crossover's
 * connecting track, a track running on into another turnout), which is
 * coupled in turn, until nothing changes any more. Returns `after` itself
 * where nothing had to change.
 */
export function coupleSwitchCants(beforeTracks, afterTracks, switches) {
  if (!afterTracks?.length || !switches?.length) return afterTracks
  const was = new Map((beforeTracks ?? []).map(t => [t.id, t]))
  // The turnouts a write reached: one of its routes, or the track up to its toe.
  const touched = (tracks, prev) => {
    const ids = new Set(tracks.filter(t => prev.get(t.id) !== t).map(t => t.id))
    const runs = routeRuns(tracks)
    return new Set(switches.filter(sw => {
      const r = runs.get(sw.switchId)
      return ids.has(r?.main?.trackId) || ids.has(r?.branch?.trackId) || ids.has(portTrack(sw, 'A'))
    }).map(sw => sw.switchId))
  }
  let only = touched(afterTracks, was)
  let before = beforeTracks
  let tracks = afterTracks
  for (let n = 0; n < MAX_PASSES && only.size; n++) {
    const pass = couplePass(before, tracks, switches, only)
    if (!pass.changed.size) break
    before = tracks
    const prev = new Map(tracks.map(t => [t.id, t]))
    tracks = pass.tracks
    only = touched(tracks, prev)
  }
  return tracks
}
