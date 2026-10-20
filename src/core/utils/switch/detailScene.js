/**
 * A turnout in detail with what lies around it (Paket WD): the turnouts it is
 * joined to in a switch connection, the other turnouts close by, and the
 * tracks there — all in the frame of the turnout shown, so one drawing holds
 * them.
 *
 * The partner of a switch connection is found along the branch: its track is
 * followed to its far end, across links, and a turnout met there is the other
 * half of the connection, however long the straight between them. Close by
 * means within `margin` of the turnout and its partners; the tracks are cut to
 * that window and drawn as their rails.
 */

import { elementStations, isLinkSwitch, pointOnElement, portEnd, portsOf, portTrack, turnoutDivergingPort } from '../track'
import { RAIL_OFFSET, switchDetail } from './detail'

/** How far around the turnout and its partners the scene reaches [m]. */
const MARGIN = 15
/** Rail points of a track every so many metres. */
const TRACK_STEP = 1
/** How many links a partner search crosses at most. */
const MAX_HOPS = 4
/**
 * How far along the branch a partner may lie, toe to toe [m]: the longest
 * branch of the DB forms and an intermediate straight. A turnout farther off
 * is the next one down the line, not the other half of a connection.
 */
const MAX_REACH = 250

const isTurnout = (sw) => (sw?.kind ?? 'turnout') === 'turnout'
const other = (end) => (end === 'END' ? 'BEGIN' : 'END')

/** The switches with a port at (trackId, end). */
const switchesAt = (switches, trackId, end) =>
  switches.filter(s => portsOf(s).some(({ port }) => portTrack(s, port) === trackId && portEnd(s, port) === end))

/** The turnout at the far end of a turnout's branch track, across links — or none. */
function alongBranch(lengthOf, switches, sw) {
  const port = turnoutDivergingPort(sw)
  let trackId = portTrack(sw, port)
  let end = other(portEnd(sw, port))
  const found = []
  const seen = new Set([sw.switchId])
  let run = 0
  for (let hop = 0; trackId && hop <= MAX_HOPS; hop++) {
    run += lengthOf(trackId)
    if (run > MAX_REACH) break
    const there = switchesAt(switches, trackId, end).filter(s => !seen.has(s.switchId))
    const turnout = there.find(isTurnout)
    if (turnout) { found.push(turnout); break }
    const link = there.find(isLinkSwitch)
    if (!link) break
    seen.add(link.switchId)
    // On through the link: the track on its other side, to that track's far end.
    const next = portsOf(link).map(({ port: p }) => ({ trackId: portTrack(link, p), end: portEnd(link, p) }))
      .find(p => !(p.trackId === trackId && p.end === end))
    if (!next?.trackId) break
    trackId = next.trackId
    end = other(next.end)
  }
  return found
}

/**
 * The turnouts a turnout is joined to by a branch (a switch connection): the
 * one its own branch leads to, and those whose branch leads to it.
 */
export function connectionPartners(tracks, switches, sw) {
  const lengths = new Map(tracks.map(t => [t.id, (t.elements ?? []).reduce((s, el) => s + (el.length ?? 0), 0)]))
  const lengthOf = (id) => lengths.get(id) ?? Infinity
  const out = alongBranch(lengthOf, switches, sw)
  for (const s of switches) {
    if (s.switchId !== sw.switchId && isTurnout(s) && !out.includes(s)
      && alongBranch(lengthOf, switches, s).some(p => p.switchId === sw.switchId)) out.push(s)
  }
  return out
}

/** A point of one detail's frame in another's. */
const reframer = (from, to) => (q) => {
  const p = [from.origin[0] + q[0] * from.axes.x[0] + q[1] * from.axes.y[0], from.origin[1] + q[0] * from.axes.x[1] + q[1] * from.axes.y[1]]
  const v = [p[0] - to.origin[0], p[1] - to.origin[1]]
  return [v[0] * to.axes.x[0] + v[1] * to.axes.x[1], v[0] * to.axes.y[0] + v[1] * to.axes.y[1]]
}

/** A detail drawn in another's frame: every point carried over. */
function inFrame(detail, frame) {
  const f = reframer(detail, frame)
  const pair = (p) => (p ? f(p) : null)
  const m = detail.marks
  return {
    ...detail,
    sleepers: detail.sleepers.map(s => ({ ...s, ends: s.ends.map(f) })),
    rails: detail.rails.map(r => ({ ...r, points: r.points.map(f) })),
    marks: {
      WA: f(m.WA), WM: pair(m.WM),
      WE: { main: pair(m.WE.main), branch: pair(m.WE.branch) },
      ldS: { main: pair(m.ldS.main), branch: pair(m.ldS.branch) },
      joints: { WA: m.joints.WA.map(f), WE: m.joints.WE.map(p => p.map(f)) },
    },
  }
}

/** The box around the points of a detail. */
function boxOf(detail) {
  const pts = [...detail.sleepers.flatMap(s => s.ends), ...detail.rails.flatMap(r => r.points)]
  return {
    x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])),
    y0: Math.min(...pts.map(p => p[1])), y1: Math.max(...pts.map(p => p[1])),
  }
}
const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) })
const grow = (b, d) => ({ x0: b.x0 - d, x1: b.x1 + d, y0: b.y0 - d, y1: b.y1 + d })
const inside = (b, p) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1
const meets = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1

/**
 * The scene of one laid turnout, or null where it has no detail:
 *
 *   { detail, partners, nearby, tracks, box, focus }
 *
 * `detail` as switchDetail gives it; `partners` the details of the turnouts
 * joined to it in a switch connection and `nearby` those of the others close
 * by, each in its frame with `sw`; `tracks` every track in the window as
 * runs of its two rails ([{ trackId, name, rails: [left, right] }]); `box`
 * the window and `focus` the box of the turnout and its partners — what a
 * view is fitted to.
 */
export function switchDetailScene(tracks, switches, sw, { margin = MARGIN } = {}) {
  const detail = switchDetail(tracks, sw)
  if (!detail) return null
  const frame = { origin: detail.origin, axes: detail.axes }
  const toLocal = (p) => {
    const v = [p[0] - frame.origin[0], p[1] - frame.origin[1]]
    return [v[0] * frame.axes.x[0] + v[1] * frame.axes.x[1], v[0] * frame.axes.y[0] + v[1] * frame.axes.y[1]]
  }

  const partners = connectionPartners(tracks, switches, sw)
    .map(p => switchDetail(tracks, p)).filter(Boolean).map(d => inFrame(d, frame))
  const focus = [detail, ...partners].map(boxOf).reduce(union)
  const box = grow(focus, margin)

  // Every other turnout with a port node near the window: its detail, kept
  // where it reaches into it.
  const byId = new Map(tracks.map(t => [t.id, t]))
  const node = (s, port) => {
    const t = byId.get(portTrack(s, port))
    const els = t?.elements ?? []
    const el = portEnd(s, port) === 'END' ? els[els.length - 1] : els[0]
    const n = portEnd(s, port) === 'END' ? el?.endNode : el?.startNode
    return n ? toLocal(n) : null
  }
  const taken = new Set([sw.switchId, ...partners.map(p => p.sw.switchId)])
  const reach = grow(box, 120)    // a port that far off belongs to a turnout too long to reach in
  const nearby = switches
    .filter(s => isTurnout(s) && !taken.has(s.switchId))
    .filter(s => portsOf(s).some(({ port }) => { const p = node(s, port); return p && inside(reach, p) }))
    .map(s => switchDetail(tracks, s)).filter(Boolean).map(d => inFrame(d, frame))
    .filter(d => meets(boxOf(d), box))

  // The tracks in the window, as runs of their rails.
  const runs = []
  for (const t of tracks) {
    const nodes = (t.elements ?? []).flatMap(el => [el.startNode, el.endNode]).filter(Boolean).map(toLocal)
    if (!nodes.length) continue
    const tb = nodes.reduce((b, p) => union(b, { x0: p[0], x1: p[0], y0: p[1], y1: p[1] }),
      { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity })
    if (!meets(grow(tb, 5), box)) continue
    let run = null
    const close = () => { if (run && run.rails[0].length > 1) runs.push(run); run = null }
    for (const { el } of elementStations(t)) {
      const len = el.length ?? 0
      // An element whose ends lie well away from the window is not sampled:
      // an arc leaves its chord by less than a fifth of its length.
      if (el.startNode && el.endNode) {
        const [a, c] = [toLocal(el.startNode), toLocal(el.endNode)]
        const eb = { x0: Math.min(a[0], c[0]), x1: Math.max(a[0], c[0]), y0: Math.min(a[1], c[1]), y1: Math.max(a[1], c[1]) }
        if (!meets(grow(eb, len / 5 + 2), box)) { close(); continue }
      }
      const n = Math.max(1, Math.ceil(len / TRACK_STEP))
      for (let i = 0; i <= n; i++) {
        const e = pointOnElement(el, t.epsg, len * i / n)
        if (!e?.utm) continue
        const c = toLocal([e.utm.easting, e.utm.northing])
        if (!inside(box, c)) { close(); continue }
        const b = e.bearing * Math.PI / 180
        // Left of the running direction in the plane, then into the frame.
        const nl = toLocal([e.utm.easting - Math.cos(b), e.utm.northing + Math.sin(b)])
        const dn = [nl[0] - c[0], nl[1] - c[1]]
        run ??= { trackId: t.id, name: t.name ?? null, rails: [[], []] }
        run.rails[0].push([c[0] + dn[0] * RAIL_OFFSET, c[1] + dn[1] * RAIL_OFFSET])
        run.rails[1].push([c[0] - dn[0] * RAIL_OFFSET, c[1] - dn[1] * RAIL_OFFSET])
      }
    }
    close()
  }

  return { detail, partners, nearby, tracks: runs, box, focus }
}
