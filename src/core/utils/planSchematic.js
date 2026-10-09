import { trackPointAt } from './planGeometry'
import { trackLength } from './heightUtils'
import { kmForTrackPoint } from './kmLineUtils'
import { utmToWgs84, wgs84ToUTM } from './coordinateUtils'
import { isLinkSwitch, portsOf, turnoutLinePort } from './switchModel'
import { trackStatus } from './planStatus'

/**
 * The track network as a schematic strip: the lines of the layout become
 * horizontal lanes laid out along one reference axis, and every switch that
 * joins two lanes becomes a 45° connection between them.
 *
 * Only the length along the axis is to scale. It is read by projecting every
 * track onto the reference, so a switch sits where it sits in reality; which
 * lane a track takes follows from which side of the reference it lies on and
 * how far out, and the spacing of the lanes is a drawing convention.
 *
 * The network comes from the switches. A turnout's A and B2 ports carry the
 * through route, so the tracks meeting there are one continuous strand; the
 * same holds for the A–C road of a crossing and for a link. Every other port —
 * a turnout's branch, the second road of a crossing — attaches a strand to the
 * switch as a node on the strand that carries it through.
 */

/** Spacing of the samples a track is measured by [m]. */
const SAMPLE_STEP = 20
/** Cell size of the index over the reference axis [m]. */
const INDEX_CELL = 250
/** Strands no longer than this that run between two other strands are drawn as connections [m]. */
const CONNECTOR_MAX = 500
/** Strands closer than this in x still count as side by side [m]. */
const LANE_CLEARANCE = 40
/** How far from the reference a track may lie and still be drawn [m]. */
export const DEFAULT_CORRIDOR = 300

const endKey = (trackId, end) => `${trackId}:${end}`
const otherEnd = (end) => (end === 'END' ? 'BEGIN' : 'END')

/** A plane point of `from` in the plane of `to`. */
export function toPlane(point, from, to) {
  if (!from || !to || Number(from) === Number(to)) return point
  const u = wgs84ToUTM(utmToWgs84(point[0], point[1], from), to)
  return [u.easting, u.northing]
}

/** Samples along a track, in the plane of `epsg`. */
function sampleTrack(track, epsg) {
  const total = trackLength(track)
  const n = Math.max(2, Math.ceil(total / SAMPLE_STEP))
  const out = []
  for (let i = 0; i <= n; i++) {
    const s = total * i / n
    const at = trackPointAt(track, s)
    if (at) out.push({ s, p: toPlane(at.point, track.epsg, epsg) })
  }
  return out
}

/**
 * Could any of the track reach into `box`? Read off its element nodes, which
 * is enough to leave out the far side of a large network without sampling it.
 */
function mayReach(track, epsg, box) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const el of track.elements ?? []) {
    for (const node of [el.startNode, el.endNode]) {
      if (!Array.isArray(node)) continue
      const [x, y] = toPlane(node, track.epsg, epsg)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return maxX >= box.minX && minX <= box.maxX && maxY >= box.minY && minY <= box.maxY
}

/**
 * The reference axis as a projector: a plane point in, its station along the
 * axis and its signed offset out (left of the direction of travel positive) —
 * or null for a point further than `reach` from it. Past either end the first
 * and last segments are extended, so a strand that runs on a little beyond the
 * reference still gets an x of its own.
 */
function makeAxis(points, reach) {
  const segs = []
  let station = 0
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 1e-6) continue
    segs.push({ ax, ay, dx: (bx - ax) / len, dy: (by - ay) / len, len, s0: station })
    station += len
  }
  const grid = new Map()
  const cell = (x, y) => `${Math.floor(x / INDEX_CELL)},${Math.floor(y / INDEX_CELL)}`
  segs.forEach((sg, i) => {
    const steps = Math.max(1, Math.ceil(sg.len / (INDEX_CELL / 2)))
    for (let k = 0; k <= steps; k++) {
      const key = cell(sg.ax + sg.dx * sg.len * k / steps, sg.ay + sg.dy * sg.len * k / steps)
      if (!grid.has(key)) grid.set(key, new Set())
      grid.get(key).add(i)
    }
  })

  const onSegment = (i, [px, py]) => {
    const sg = segs[i]
    let t = (px - sg.ax) * sg.dx + (py - sg.ay) * sg.dy
    if (i > 0) t = Math.max(t, 0)
    if (i < segs.length - 1) t = Math.min(t, sg.len)
    const fx = sg.ax + sg.dx * t
    const fy = sg.ay + sg.dy * t
    const cross = sg.dx * (py - sg.ay) - sg.dy * (px - sg.ax)
    return { x: sg.s0 + t, off: cross, dist: Math.hypot(px - fx, py - fy) }
  }

  const project = (pt) => {
    let best = null
    const cx = Math.floor(pt[0] / INDEX_CELL)
    const cy = Math.floor(pt[1] / INDEX_CELL)
    const seen = new Set()
    const rings = Math.ceil(reach / INDEX_CELL) + 1
    for (let r = 0; r <= rings; r++) {
      if (best && (r - 1) * INDEX_CELL > best.dist) break
      for (let ix = cx - r; ix <= cx + r; ix++) {
        for (let iy = cy - r; iy <= cy + r; iy++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy)) !== r) continue
          for (const i of grid.get(`${ix},${iy}`) ?? []) {
            if (seen.has(i)) continue
            seen.add(i)
            const hit = onSegment(i, pt)
            if (!best || hit.dist < best.dist) best = hit
          }
        }
      }
    }
    return best && best.dist <= reach ? best : null
  }
  return { project, length: station }
}

const median = (vals) => {
  if (!vals.length) return 0
  const s = [...vals].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/**
 * Tracks joined into strands through the switches' through routes, and the
 * switches as nodes on them.
 */
export function schematicNetwork(tracks, switches) {
  const byId = new Map(tracks.filter(tr => (tr.elements ?? []).length).map(tr => [tr.id, tr]))
  const partner = new Map()
  const nodeOfEnd = new Map()
  const nodes = []

  for (const sw of switches) {
    const ports = portsOf(sw)
      .map(pt => ({ port: pt.port, trackId: sw[pt.trackKey], end: sw[pt.endKey] }))
      .filter(pt => byId.has(pt.trackId) && (pt.end === 'BEGIN' || pt.end === 'END'))
    if (!ports.length) continue
    const kind = sw.kind ?? 'turnout'
    const through = isLinkSwitch(sw) ? ['A', 'B']
      : kind === 'turnout' ? ['A', turnoutLinePort(sw)] : ['A', 'C']
    const node = { sw, ports, through: [], attach: [], link: isLinkSwitch(sw) }
    for (const pt of ports) {
      const key = endKey(pt.trackId, pt.end)
      nodeOfEnd.set(key, node)
      if (through.includes(pt.port)) node.through.push(key)
      else node.attach.push(key)
    }
    if (node.through.length === 2) {
      partner.set(node.through[0], node.through[1])
      partner.set(node.through[1], node.through[0])
    }
    nodes.push(node)
  }

  const visited = new Set()
  const strands = []
  for (const track of byId.values()) {
    if (visited.has(track.id)) continue
    visited.add(track.id)
    const seq = [{ track, reversed: false }]
    // Onwards from the track's END, then backwards from its BEGIN.
    for (const [from, atFront] of [['END', false], ['BEGIN', true]]) {
      let key = endKey(track.id, from)
      for (;;) {
        const next = partner.get(key)
        if (!next) break
        const [id, end] = next.split(':')
        if (visited.has(id)) break
        visited.add(id)
        const tr = byId.get(id)
        // Entered at `end`: onwards a track entered at its END runs reversed,
        // backwards one entered at its BEGIN does.
        const reversed = atFront ? end === 'BEGIN' : end === 'END'
        if (atFront) seq.unshift({ track: tr, reversed })
        else seq.push({ track: tr, reversed })
        key = endKey(id, otherEnd(end))
      }
    }
    const first = seq[0]
    const last = seq[seq.length - 1]
    strands.push({
      id: strands.length,
      parts: seq,
      length: seq.reduce((a, p) => a + trackLength(p.track), 0),
      ends: [
        endKey(first.track.id, first.reversed ? 'END' : 'BEGIN'),
        endKey(last.track.id, last.reversed ? 'BEGIN' : 'END'),
      ],
    })
  }

  const strandOfTrack = new Map()
  for (const st of strands) for (const p of st.parts) strandOfTrack.set(p.track.id, st)
  for (const node of nodes) {
    const hostKey = node.through[0] ?? null
    node.host = hostKey ? strandOfTrack.get(hostKey.split(':')[0]) : null
  }
  return { strands, nodes, nodeOfEnd, strandOfTrack, byId }
}

/**
 * The strip: every strand with its lane and x range, every switch with its
 * place, and what the kilometrage reads along the reference.
 *
 * @param {object} o
 * @param {Array}  o.tracks
 * @param {Array}  o.switches
 * @param {Array}  o.platforms
 * @param {Array}  o.kmLines
 * @param {string} o.leadTrackId  track whose strand is the reference (default: the longest strand)
 * @param {number} o.corridor     what lies further from the reference is left out [m]
 */
export function schematicLayout({
  tracks, switches = [], platforms = [], kmLines = [], leadTrackId = null, corridor = DEFAULT_CORRIDOR,
}) {
  const net = schematicNetwork(tracks, switches)
  if (!net.strands.length) return null

  const lead = leadTrackId ? net.strandOfTrack.get(leadTrackId) : null
  const ref = lead ?? net.strands.reduce((a, b) => (b.length > a.length ? b : a))
  const epsg = ref.parts[0].track.epsg

  // Samples of every track in the reference plane, in the track's own direction.
  const samples = new Map()
  for (const { track } of ref.parts) samples.set(track.id, sampleTrack(track, epsg))
  const refPoints = ref.parts.flatMap(({ track, reversed }) => {
    const sm = samples.get(track.id)
    return (reversed ? [...sm].reverse() : sm).map(q => q.p)
  })
  const reach = corridor + SAMPLE_STEP
  const box = refPoints.reduce((b, [x, y]) => ({
    minX: Math.min(b.minX, x - reach), maxX: Math.max(b.maxX, x + reach),
    minY: Math.min(b.minY, y - reach), maxY: Math.max(b.maxY, y + reach),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
  for (const tr of net.byId.values()) {
    if (samples.has(tr.id)) continue
    samples.set(tr.id, mayReach(tr, epsg, box) ? sampleTrack(tr, epsg) : [])
  }
  const axis = makeAxis(refPoints, reach)

  // Kilometrage along the reference, where the project has a line to read it off.
  const kmTable = []
  for (const { track, reversed } of ref.parts) {
    const sm = samples.get(track.id)
    for (const q of (reversed ? [...sm].reverse() : sm)) {
      const raw = trackPointAt(track, q.s)
      const hit = raw && kmLines.length ? kmForTrackPoint(kmLines, track, raw.point) : null
      const on = axis.project(q.p)
      if (hit && on && hit.offset < 200) kmTable.push({ x: on.x, km: hit.km })
    }
  }
  kmTable.sort((a, b) => a.x - b.x)
  // Kilometrage counts left to right on the sheet.
  const flip = kmTable.length > 1 && kmTable[kmTable.length - 1].km < kmTable[0].km ? -1 : 1
  const proj = (pt) => {
    const h = axis.project(pt)
    return h ? { x: flip * h.x, off: flip * h.off } : { x: NaN, off: Infinity }
  }
  if (flip < 0) {
    for (const k of kmTable) k.x = -k.x
    kmTable.reverse()
  }

  // Each track: x and offset at its samples.
  const along = new Map()
  for (const [id, sm] of samples) {
    along.set(id, sm.map(q => ({ s: q.s, ...proj(q.p) })))
  }

  const nodePoint = (key) => {
    const [id, end] = key.split(':')
    const sm = along.get(id)
    return (end === 'END' ? sm[sm.length - 1] : sm[0]) ?? { x: NaN, off: Infinity }
  }

  for (const st of net.strands) {
    const pts = st.parts.flatMap(({ track, reversed }) => {
      const a = along.get(track.id)
      return reversed ? [...a].reverse() : a
    })
    // Only what lies in the corridor takes part: a branch line leaving the
    // strip would otherwise pile up on the extended end of the axis.
    const inside = pts.filter(q => Math.abs(q.off) <= corridor)
    st.outside = inside.length < 2
    const use = st.outside ? pts : inside
    st.x0 = Math.min(...use.map(q => q.x))
    st.x1 = Math.max(...use.map(q => q.x))
    st.off = st === ref ? 0 : median(use.map(q => q.off))
    // Where each of its tracks runs, so a name — and a status — can be set over its own stretch.
    st.named = st.parts.map(({ track }) => {
      const xs = along.get(track.id).filter(q => Math.abs(q.off) <= corridor).map(q => q.x)
      return xs.length
        ? { name: track.name ?? '', status: trackStatus(track), x0: Math.min(...xs), x1: Math.max(...xs) }
        : null
    }).filter(Boolean)
    st.endNodes = st.ends.map(k => net.nodeOfEnd.get(k) ?? null)
    st.endAttached = st.ends.map((k, i) => Boolean(st.endNodes[i]?.attach.includes(k)))
  }

  for (const node of net.nodes) {
    const at = nodePoint(node.through[0] ?? node.attach[0])
    node.x = at.x
    node.outside = Math.abs(at.off) > corridor
  }

  // A short strand between two others is how a crossover or a branch
  // connection reads — it becomes a diagonal, not a lane.
  const hosts = new Set(net.nodes.map(n => n.host).filter(Boolean))
  for (const st of net.strands) {
    const [a, b] = st.endNodes
    st.connector = st !== ref && !st.outside && !hosts.has(st) && st.length <= CONNECTOR_MAX
      && st.endAttached[0] && st.endAttached[1]
      && a?.host && b?.host && a.host !== b.host && a.host !== st && b.host !== st
  }

  // Sections: each track of a strand, with where it runs and how far out.
  // A track takes its own lane, so a strand steps inwards where the track
  // beside it ends and neighbouring tracks stay one spacing apart.
  const sectionOfTrack = new Map()
  for (const st of net.strands) {
    st.sections = st.parts.map(({ track, reversed }) => {
      const a = along.get(track.id)
      const inside = a.filter(q => Math.abs(q.off) <= corridor)
      const use = inside.length >= 2 ? inside : a
      const sc = {
        strand: st, track, reversed, name: track.name ?? '', status: trackStatus(track),
        x0: Math.min(...use.map(q => q.x)), x1: Math.max(...use.map(q => q.x)),
        off: median(use.map(q => q.off)), inside: inside.length >= 2,
        // Which way along x the strand runs through this track.
        dir: (a.length < 2 || a[a.length - 1].x >= a[0].x) !== reversed ? 1 : -1,
      }
      sectionOfTrack.set(track.id, sc)
      return sc
    })
  }

  // Lanes: outwards from the reference, each section one further out than the
  // sections of other strands on its side it overlaps and that lie nearer.
  const placed = ref.sections.map(sc => Object.assign(sc, { lane: 0 }))
  const laned = net.strands.filter(st => st !== ref && !st.connector && !st.outside)
  const pending = laned.flatMap(st => st.sections.filter(sc => sc.inside))
    .sort((a, b) => Math.abs(a.off) - Math.abs(b.off))
  for (const sc of pending) {
    const side = sc.off >= 0 ? 1 : -1
    let lane = 0
    let overlaps = false
    for (const o of placed) {
      if (o.strand === sc.strand) continue
      if (o.x1 + LANE_CLEARANCE < sc.x0 || sc.x1 + LANE_CLEARANCE < o.x0) continue
      if (o.lane !== 0 && Math.sign(o.lane) !== side) continue
      overlaps = true
      lane = Math.max(lane, Math.abs(o.lane) + 1)
    }
    if (!overlaps) lane = Math.abs(sc.off) < 3 ? 0 : 1
    sc.lane = side * lane
    placed.push(sc)
  }
  // A section beyond the corridor keeps the lane of its nearest neighbour in the strand.
  for (const st of [ref, ...laned]) {
    const secs = st.sections
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < secs.length; i++) {
        if (secs[i].lane != null) continue
        secs[i].lane = secs[i - 1]?.lane ?? secs[i + 1]?.lane ?? null
      }
      secs.reverse()
    }
    st.lane = secs.find(sc => sc.lane != null)?.lane ?? null
  }
  // A switch sits on the lane of the track at its toe; a node the strand only
  // passes through on its way from one section to the next is where it steps.
  const sectionAt = (key) => sectionOfTrack.get(key.split(':')[0]) ?? null
  for (const node of net.nodes) {
    const home = node.through.map(sectionAt).find(sc => sc?.lane != null)
      ?? node.attach.map(sectionAt).find(sc => sc?.lane != null && !sc.strand.connector)
    node.lane = home?.lane ?? null
    node.home = home ?? null
  }
  // Between two sections of a strand: the switch whose through route joins them.
  for (const st of net.strands) {
    st.junctions = st.sections.slice(0, -1)
      .map(sc => net.nodeOfEnd.get(endKey(sc.track.id, sc.reversed ? 'BEGIN' : 'END')) ?? null)
  }

  // Platforms: their track's lane, the x of their two stations, and the side
  // they are on as seen on the sheet.
  const placedPlatforms = []
  for (const pf of platforms) {
    const a = along.get(pf.trackId)
    const sc = sectionOfTrack.get(pf.trackId)
    if (!a || sc?.lane == null) continue
    const xAt = (s) => {
      let i = 1
      while (i < a.length - 1 && a[i].s < s) i++
      const p = a[i - 1]
      const q = a[i]
      const t = q.s > p.s ? Math.min(Math.max((s - p.s) / (q.s - p.s), 0), 1) : 0
      return p.x + (q.x - p.x) * t
    }
    const xa = xAt(pf.startStation)
    const xb = xAt(pf.endStation)
    const increasing = a[a.length - 1].x >= a[0].x
    const left = pf.side === 'left'
    placedPlatforms.push({
      platform: pf, lane: sc.lane, x0: Math.min(xa, xb), x1: Math.max(xa, xb),
      up: left === increasing,
    })
  }

  const all = net.strands.filter(st => st.lane != null)
  const extent = [Math.min(...all.map(st => st.x0)), Math.max(...all.map(st => st.x1))]
  // Without a line to read the kilometrage off, the ruler states the chainage
  // along the reference instead.
  const kmKnown = kmTable.length >= 2
  if (!kmKnown) {
    kmTable.length = 0
    kmTable.push({ x: extent[0], km: extent[0] }, { x: extent[1], km: extent[1] })
  }
  return {
    strands: net.strands,
    nodes: net.nodes,
    platforms: placedPlatforms,
    sectionOfTrack,
    kmTable,
    kmKnown,
    ref,
    epsg,
    // The reference in the plane with its x, so a stretch of the strip can be found on the ground.
    axis: refPoints.map(p => ({ x: proj(p).x, p })).filter(q => Number.isFinite(q.x)),
    extent,
    lanes: [Math.min(...all.map(s => s.lane)), Math.max(...all.map(s => s.lane))],
  }
}
