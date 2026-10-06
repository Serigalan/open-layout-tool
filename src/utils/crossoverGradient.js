/**
 * Fitting the gradient of a crossover in cant (decisions 159–163).
 *
 * The two turnouts of a crossover each lie in the plane of their own track
 * (switchGradient). Where the tracks are canted, the connection between them
 * only runs in one plane if the two tracks do: across the crossover the
 * second track has to lie u/1500 · y above the first, with u the cant both
 * carry there and y the second track's distance to the left of the first.
 *
 *   z₂ − z₁ = u / 1500 · y
 *
 * Two ways to get there:
 *
 * - **heights from cant** — a cant is wanted (by default the one there), and
 *   the heights are moved until the difference fits;
 * - **cant from heights** — the heights stay, and the cant is what their
 *   difference asks for, on the 5 mm grid (LP.KB.03); what the rounding
 *   leaves over is made up with the heights.
 *
 * Either way the cant both tracks carry over the crossover becomes u — on the
 * curve they run through there — and the heights are moved within what each
 * track may be raised or lowered and only inside the stretch marked for it.
 * The correction is shared half and half; where one track's limit is reached,
 * the other takes the rest, and where both are, nothing is moved.
 *
 * The shape: over the crossover — from the first toe to the last ldS, and the
 * points the other track's ones lie across from — each track runs straight,
 * offset as needed; from the ends of the marked stretch it is ramped up to
 * that offset. The gradient changes this makes are rounded with the
 * Regelwert of Tabelle 12 (HP.AR.03) where they need rounding at all
 * (HP.AR.01), and the straight is drawn out so far that the curves stay
 * outside the turnouts (HP.AR.06).
 */

import { catalogLimit } from './regelkatalog'
import { adjacentTracks, elementAtStation, gradientAt, jointHeightUpdates, pointAtStationUtm, trackLength } from './heightUtils'
import { RUNNING_CIRCLE_DISTANCE, sectionAtStation } from './crossSectionUtils'
import { cantSign, roundCant } from './rules/cant'
import { isLinkSwitch, portsOf } from './switchModel'
import { ldsFromToe } from './switchGradient'

const EPS = 1e-6
const STATION_TOL = 0.01
const MAX_CHAIN = 5000        // m either way — far beyond any ramp
const roundMm = (x) => Math.round(x * 1000) / 1000

// ── Which pairs of turnouts are crossovers ──────────────────────────────────

const isTurnout = (sw) => !isLinkSwitch(sw) && (sw?.kind ?? 'turnout') === 'turnout'

/**
 * Every crossover: two turnouts whose branches are the two ends of one track.
 * Returns [{ w1, w2, conn }] with w1 the turnout at the connecting track's
 * BEGIN.
 */
export function findCrossovers(tracks, switches) {
  const out = []
  for (const conn of tracks ?? []) {
    const at = (end) => (switches ?? []).find(sw => isTurnout(sw)
      && sw.portB1_trackId === conn.id && (sw.portB1_endpoint ?? 'BEGIN') === end)
    const w1 = at('BEGIN'), w2 = at('END')
    if (w1 && w2 && w1.switchId !== w2.switchId) out.push({ w1, w2, conn })
  }
  return out
}

// ── A line followed through its track ends ──────────────────────────────────

const other = (end) => (end === 'BEGIN' ? 'END' : 'BEGIN')

/**
 * Where a line runs on beyond one end of a track: through a turnout along its
 * main route (A ↔ B2) — never into a branch — or end to end into the next
 * track. Null where it stops, or branches off.
 */
function continuation(tracks, switches, track, end) {
  for (const sw of switches ?? []) {
    const ports = portsOf(sw)
    const here = ports.find(p => sw[p.trackKey] === track.id && (sw[p.endKey] ?? 'BEGIN') === end)
    if (!here) continue
    if (!isTurnout(sw)) return null
    const to = here.port === 'A' ? 'B2' : here.port === 'B2' ? 'A' : null
    if (!to) return null
    const next = tracks.find(t => t.id === sw[`port${to}_trackId`])
    return next ? { track: next, end: sw[`port${to}_endpoint`] ?? 'BEGIN' } : null
  }
  const [n] = adjacentTracks(tracks, switches, track, end)
  return n ? { track: n.track, end: n.endpoint } : null
}

/**
 * The line a track lies on, as the run of tracks it continues into either
 * way: segments { track, from, length, reversed } along a common distance
 * whose 0 is the start track's BEGIN. A reversed segment's stations run
 * against the line.
 */
export function lineChain(tracks, switches, start) {
  const segments = [{ track: start, from: 0, length: trackLength(start), reversed: false }]
  const seen = new Set([start.id])
  // Forward from the start's END, backward from its BEGIN.
  for (const dir of [1, -1]) {
    let cur = { track: start, end: dir === 1 ? 'END' : 'BEGIN' }
    let at = dir === 1 ? segments[0].length : 0
    while (Math.abs(at) < MAX_CHAIN) {
      const next = continuation(tracks, switches, cur.track, cur.end)
      if (!next || seen.has(next.track.id)) break
      seen.add(next.track.id)
      const length = trackLength(next.track)
      // Entered at `next.end`: running forward, a track entered at its BEGIN
      // runs with the line; running backward, one entered at its END does.
      const reversed = dir === 1 ? next.end === 'END' : next.end === 'BEGIN'
      const from = dir === 1 ? at : at - length
      segments.push({ track: next.track, from, length, reversed })
      at = dir === 1 ? at + length : at - length
      cur = { track: next.track, end: other(next.end) }
    }
  }
  return segments.sort((a, b) => a.from - b.from)
}

const stationOf = (seg, d) => (seg.reversed ? seg.from + seg.length - d : d - seg.from)
const distanceOf = (seg, station) => (seg.reversed ? seg.from + seg.length - station : seg.from + station)

/** The segment a line distance lies in, preferring `prefer` at a joint. */
function segmentAt(chain, d) {
  const inside = chain.filter(s => d >= s.from - EPS && d <= s.from + s.length + EPS)
  return inside.find(s => d > s.from + EPS && d < s.from + s.length - EPS) ?? inside[0] ?? null
}

function chainPoint(chain, d) {
  const seg = segmentAt(chain, d)
  if (!seg) return null
  const hit = elementAtStation(seg.track.elements, stationOf(seg, d))
  const p = hit && pointAtStationUtm(hit.el, hit.s, seg.track.epsg)
  return p ? [p.easting, p.northing] : null
}

/** Unit tangent of the line at a distance, in the direction the line runs. */
function chainTangent(chain, d) {
  const a = chainPoint(chain, d - 0.05) ?? chainPoint(chain, d)
  const b = chainPoint(chain, d + 0.05) ?? chainPoint(chain, d)
  if (!a || !b) return null
  const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy)
  return n > 0 ? [dx / n, dy / n] : null
}

/** Height of the line at a distance (the rounded gradient of its track), or null. */
function chainZ(chain, d) {
  const seg = segmentAt(chain, d)
  if (!seg?.track.heights?.length) return null
  const st = stationOf(seg, d)
  const h = seg.track.heights
  if (st < h[0].station - STATION_TOL || st > h[h.length - 1].station + STATION_TOL) return null
  return gradientAt(h, st)
}

/** The distance along a line nearest to a point [E, N]. */
function nearestOn(chain, p, near = null) {
  const lo0 = chain[0].from, hi0 = chain[chain.length - 1].from + chain[chain.length - 1].length
  const [lo, hi] = near == null ? [lo0, hi0] : [Math.max(lo0, near - 400), Math.min(hi0, near + 400)]
  const dist = (d) => { const q = chainPoint(chain, d); return q ? Math.hypot(q[0] - p[0], q[1] - p[1]) : Infinity }
  let best = lo, bestD = Infinity
  const step = 1
  for (let d = lo; d <= hi; d += step) {
    const v = dist(d)
    if (v < bestD) { bestD = v; best = d }
  }
  let a = Math.max(lo, best - step), b = Math.min(hi, best + step)
  for (let k = 0; k < 50; k++) {
    const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3
    if (dist(m1) < dist(m2)) b = m2; else a = m1
  }
  return (a + b) / 2
}

// ── The crossover's frame: zone, offset, cant ───────────────────────────────

/** Line distance of a turnout's toe and of its ldS, on the line its main route lies on. */
function toeAndLds(chain, tracks, sw) {
  const seg = chain.find(s => s.track.id === sw.portB2_trackId)
  if (!seg) return null
  const fromBegin = (sw.portB2_endpoint ?? 'BEGIN') !== 'END'
  const toeStation = fromBegin ? 0 : seg.length
  const reach = ldsFromToe(tracks, sw) ?? 0
  const ldsStation = fromBegin ? reach : seg.length - reach
  return { toe: distanceOf(seg, toeStation), lds: distanceOf(seg, ldsStation) }
}

/**
 * The frame a crossover is fitted in: the line each turnout's main route lies
 * on, the stretch of line 1 the crossover covers and the stretch of line 2
 * across from it, how far line 2 lies to the left of line 1, and the cant
 * there. Null where the crossover cannot be read (a track missing, lines that
 * are one, a plane change).
 */
export function crossoverFrame(tracks, switches, { w1, w2 }) {
  const main1 = tracks.find(t => t.id === w1.portB2_trackId)
  const main2 = tracks.find(t => t.id === w2.portB2_trackId)
  if (!main1 || !main2 || Number(main1.epsg) !== Number(main2.epsg)) return null
  const line1 = lineChain(tracks, switches, main1)
  const line2 = lineChain(tracks, switches, main2)
  if (line1.some(s => line2.some(t => t.track.id === s.track.id))) return null
  const a = toeAndLds(line1, tracks, w1)
  const b = toeAndLds(line2, tracks, w2)
  if (!a || !b) return null
  // Turnout 2's toe and ldS, laid across onto line 1.
  const across = [b.toe, b.lds].map(d => chainPoint(line2, d)).filter(Boolean)
    .map(p => nearestOn(line1, p, a.toe))
  const ds1 = [a.toe, a.lds, ...across]
  const zone1 = [Math.min(...ds1), Math.max(...ds1)]
  // Across from the ends of the zone on line 2.
  const zone2 = zone1.map(d => nearestOn(line2, chainPoint(line1, d), b.toe))
  const mid = (zone1[0] + zone1[1]) / 2
  const p1 = chainPoint(line1, mid), p2 = chainPoint(line2, nearestOn(line2, p1, b.toe))
  const seg = segmentAt(line1, mid)
  // Left of line 1's track *in the direction of its own stations* — the frame
  // its signed cant is stated in.
  const t = chainTangent(line1, mid)
  if (!p1 || !p2 || !t || !seg) return null
  const own = seg.reversed ? [-t[0], -t[1]] : t
  const y = own[0] * (p2[1] - p1[1]) - own[1] * (p2[0] - p1[0])
  const state = sectionAtStation(seg.track, stationOf(seg, mid))
  return { line1, line2, zone1, zone2, y, cant: state?.cant ?? 0, radius: state?.radius ?? null, seg }
}

// ── Sharing the correction ──────────────────────────────────────────────────

/**
 * How much each track moves to change z₂ − z₁ by `e`: half each, within
 * [−lower, +raise] of either; where one is at its limit the other takes the
 * rest. Null where both together cannot.
 */
export function shareCorrection(e, lim1, lim2) {
  const clip = (v, l) => Math.max(-(l?.lower ?? 0), Math.min(l?.raise ?? 0, v))
  let d2 = clip(e / 2, lim2)
  let d1 = clip(-e / 2, lim1)
  let rest = e - (d2 - d1)
  d2 = clip(d2 + rest, lim2)
  rest = e - (d2 - d1)
  d1 = clip(d1 - rest, lim1)
  rest = e - (d2 - d1)
  return Math.abs(rest) <= 0.0005 ? { d1, d2 } : null
}

// ── Reshaping one line ──────────────────────────────────────────────────────

/** The rounding a gradient change needs: Regelwert of Tabelle 12, or none (HP.AR.01). */
function roundingFor(dsPerMille, v, siding) {
  const scope = { 'physics.gradient_change': Math.max(dsPerMille, 0.01), 'point.vertical_radius': 1,
    'point.design_speed': v, 'model.crest': true }
  const free = catalogLimit('HP.AR.01', 'ds_free', scope, { inContext: (id) => id === 'siding' && siding })
  if (dsPerMille <= free + EPS || !(v > 0)) return null
  return catalogLimit('HP.AR.03', 'reg', scope)
}

const speedAt = (chain, d) => {
  const seg = segmentAt(chain, d)
  const hit = seg && elementAtStation(seg.track.elements, stationOf(seg, d))
  return hit?.el?.speed ?? 0
}

/**
 * The new profile of one line: offset `da` at the start of the zone and `db`
 * at its end, straight in between, ramped from `r0` and to `r1`. The straight
 * reaches beyond the zone by the tangent of the curve at its ends, so the
 * curves stay outside the turnouts. Returns the line's vertices
 * [{ d, z, rv? }] and the warnings it ran into.
 */
function reshape(chain, zone, r0, r1, da, db, siding) {
  const z = (d) => chainZ(chain, d)
  let pa = zone[0], pb = zone[1]
  let verts = null
  const warnings = []
  for (let k = 0; k < 4; k++) {
    const za = z(pa), zb = z(pb), z0 = z(r0), z1 = z(r1)
    if ([za, zb, z0, z1].some(v => v == null)) return { error: 'no_gradient' }
    verts = [
      { d: r0, z: z0 }, { d: pa, z: za + da }, { d: pb, z: zb + db }, { d: r1, z: z1 },
    ]
    // The gradient change at each vertex, with the original profile beyond the ends.
    const g = (a, b) => (b.z - a.z) / (b.d - a.d)
    const before0 = (z0 - z(r0 - 1)) / 1, after1 = (z(r1 + 1) - z1) / 1
    const changes = [
      Math.abs(g(verts[0], verts[1]) - (Number.isFinite(before0) ? before0 : g(verts[0], verts[1]))),
      Math.abs(g(verts[1], verts[2]) - g(verts[0], verts[1])),
      Math.abs(g(verts[2], verts[3]) - g(verts[1], verts[2])),
      Math.abs((Number.isFinite(after1) ? after1 : g(verts[2], verts[3])) - g(verts[2], verts[3])),
    ]
    verts.forEach((vtx, i) => {
      const rv = roundingFor(changes[i] * 1000, speedAt(chain, vtx.d), siding)
      if (rv) { vtx.rv = rv; vtx.t = rv * changes[i] / 2 } else vtx.t = 0
    })
    const npa = zone[0] - verts[1].t, npb = zone[1] + verts[2].t
    if (Math.abs(npa - pa) < 0.01 && Math.abs(npb - pb) < 0.01) break
    pa = npa; pb = npb
  }
  if (verts[0].t + verts[1].t > verts[1].d - verts[0].d + EPS
    || verts[2].t + verts[3].t > verts[3].d - verts[2].d + EPS) warnings.push('ramp_too_short')
  if (verts.some(v => !v.rv && v.t === 0 && !(speedAt(chain, v.d) > 0))) warnings.push('no_speed')
  return { verts, warnings }
}

/**
 * The heights every track of a line gets from its new profile: the vertices
 * where they fall on it, every point between them moved with them — onto the
 * straight over the crossover, by the share of the ramp beside it — and the
 * rest left alone.
 */
function lineWrites(chain, verts) {
  const [v0, va, vb, v1] = verts
  const z0 = (d) => chainZ(chain, d)
  const offset = (d) => {
    if (d <= v0.d || d >= v1.d) return 0
    if (d < va.d) return (va.z - z0(va.d)) * (d - v0.d) / (va.d - v0.d)
    if (d > vb.d) return (vb.z - z0(vb.d)) * (v1.d - d) / (v1.d - vb.d)
    return null   // on the straight
  }
  const straight = (d) => va.z + (vb.z - va.z) * (d - va.d) / (vb.d - va.d)
  const writes = new Map()
  for (const seg of chain) {
    const lo = seg.from, hi = seg.from + seg.length
    if (hi < v0.d - EPS || lo > v1.d + EPS) continue
    const h = seg.track.heights
    if (!(h?.length >= 2)) return { error: 'no_gradient', track: seg.track }
    const pts = h.map(p => ({ ...p, d: distanceOf(seg, p.station) }))
    for (const v of verts) {
      if (v.d < lo - EPS || v.d > hi + EPS) continue
      const hit = pts.find(p => Math.abs(p.d - v.d) <= STATION_TOL)
      if (hit) { hit.vertex = v } else pts.push({ station: stationOf(seg, v.d), d: v.d, z: z0(v.d), vertex: v })
    }
    const out = pts.map(p => {
      const { d, vertex, ...rest } = p
      if (vertex) {
        const q = { ...rest, z: roundMm(vertex.z) }
        if (vertex.rv) q.rv = vertex.rv; else delete q.rv
        // The ends of the ramps keep the curve they had where none is needed.
        if (!vertex.rv && (vertex === v0 || vertex === v1) && p.rv) q.rv = p.rv
        return q
      }
      const off = offset(d)
      if (off === null) {
        const { rv: _rv, ...flat } = rest
        return { ...flat, z: roundMm(straight(d)) }
      }
      return off ? { ...rest, z: roundMm(rest.z + off) } : rest
    }).sort((a, b) => a.station - b.station)
    writes.set(seg.track.id, out)
  }
  return { writes }
}

// ── The plan ────────────────────────────────────────────────────────────────

/** The cant [mm] the curve over a crossover's zone carries now, as a magnitude. */
export const crossoverCant = (frame) => Math.abs(frame?.cant ?? 0)

/**
 * The run of curve elements of a line around a distance that carry one cant:
 * consecutive arcs of the same radius and cant — the curve the crossover lies
 * in, which is given its new cant as one.
 */
function curveRun(chain, d) {
  const seg = segmentAt(chain, d)
  const hit = seg && elementAtStation(seg.track.elements, stationOf(seg, d))
  if (!hit || hit.el.elementType !== 1) return null
  const key = (el) => el.elementType === 1 && Math.abs(Math.abs(el.radius ?? 0) - Math.abs(hit.el.radius ?? 0)) < 1e-6
    && Math.abs(Math.abs(el.cant ?? 0) - Math.abs(hit.el.cant ?? 0)) < 1e-6
  // Every element of every segment, along the line.
  const all = chain.flatMap(s => {
    let at = 0
    const els = (s.track.elements ?? []).map((el, i) => {
      const from = distanceOf(s, s.reversed ? at + (el.length ?? 0) : at)
      at += el.length ?? 0
      return { track: s.track, i, el, from }
    })
    return s.reversed ? els.reverse() : els
  }).sort((a, b) => a.from - b.from)
  const k = all.findIndex(x => x.track.id === seg.track.id && x.i === hit.elIdx)
  if (k < 0) return null
  let lo = k, hi = k
  while (lo > 0 && key(all[lo - 1].el)) lo--
  while (hi < all.length - 1 && key(all[hi + 1].el)) hi++
  return all.slice(lo, hi + 1)
}

/**
 * What fitting a crossover would do, without doing it.
 *
 * `mode` 'heights' (heights from the wanted `cant` [mm, a magnitude]) or
 * 'cant' (cant from the heights). `limits` [lim1, lim2], one per track: how
 * far it may be raised and lowered [m] — 0 where it may not move — and how
 * far before and after the crossover the change may reach [m].
 *
 * Returns { ok: false, reason, … } or { ok: true, u, uExact, y, e, shares,
 * heights: Map(trackId → heights), elements: Map(trackId → elements),
 * warnings } — `heights` and `elements` are the writes, `shares` what each
 * track moves at the zone's two ends.
 */
export function planCrossoverGradient(tracks, switches, crossover, { mode, cant, limits }) {
  const frame = crossoverFrame(tracks, switches, crossover)
  if (!frame) return { ok: false, reason: 'no_frame' }
  const { line1, line2, zone1, zone2, y } = frame
  if (!(Math.abs(y) > 0.5)) return { ok: false, reason: 'no_frame' }

  const zAt = (line, d) => chainZ(line, d)
  const ends = [0, 1].map(i => ({ z1: zAt(line1, zone1[i]), z2: zAt(line2, zone2[i]) }))
  if (ends.some(e => e.z1 == null || e.z2 == null)) return { ok: false, reason: 'no_gradient' }

  // The sign of the cant in line 1's frame: the side the curve raises.
  const side = frame.cant ? Math.sign(frame.cant) : (frame.radius ? cantSign(frame.radius) : 1)
  const deltaNow = ends.map(e => e.z2 - e.z1)
  const uExact = (deltaNow[0] + deltaNow[1]) / 2 * RUNNING_CIRCLE_DISTANCE / y
  const uSigned = mode === 'cant' ? roundCant(uExact) : side * Math.abs(cant ?? crossoverCant(frame))
  if (mode === 'cant' && uSigned !== 0 && Math.sign(uSigned) !== side && frame.radius) {
    return { ok: false, reason: 'cant_wrong_side', uExact }
  }
  const target = uSigned * y / RUNNING_CIRCLE_DISTANCE
  const e = deltaNow.map(dn => target - dn)
  const shares = e.map(ei => shareCorrection(ei, limits[0], limits[1]))
  if (shares.some(s => !s)) return { ok: false, reason: 'limits', e, u: Math.abs(uSigned), uExact }

  const heights = new Map()
  const warnings = new Set()
  // Line 2's zone runs the way line 2 does; its ramps are measured along it.
  const lines = [
    { line: line1, zone: zone1, d: shares.map(s => s.d1), lim: limits[0] },
    { line: line2, zone: [...zone2], d: shares.map(s => s.d2), lim: limits[1] },
  ]
  for (const L of lines) {
    let [za, zb] = L.zone
    let [da, db] = L.d
    if (za > zb) { [za, zb] = [zb, za]; [da, db] = [db, da] }
    if (Math.abs(da) < 0.0005 && Math.abs(db) < 0.0005) continue
    const r0 = za - (L.lim?.before ?? 0), r1 = zb + (L.lim?.after ?? 0)
    if (!(r0 < za - 1) || !(r1 > zb + 1)) return { ok: false, reason: 'no_range' }
    const siding = L.line.some(s => s.track.trackUse === 'siding')
    const shaped = reshape(L.line, [za, zb], r0, r1, da, db, siding)
    if (shaped.error) return { ok: false, reason: shaped.error }
    shaped.warnings.forEach(w => warnings.add(w))
    const w = lineWrites(L.line, shaped.verts)
    if (w.error) return { ok: false, reason: w.error, track: w.track?.name ?? w.track?.id }
    for (const [id, h] of w.writes) heights.set(id, h)
  }

  // The cant of the curve both lines run through over the crossover.
  const elements = new Map()
  for (const [line, zone] of [[line1, zone1], [line2, zone2]]) {
    const mid = (zone[0] + zone[1]) / 2
    const seg = segmentAt(line, mid)
    const now = sectionAtStation(seg.track, stationOf(seg, mid))?.cant ?? 0
    if (Math.abs(Math.abs(now) - Math.abs(uSigned)) < 0.5) continue
    const run = curveRun(line, mid)
    if (!run) return { ok: false, reason: 'cant_not_on_arc' }
    for (const { track, i, el } of run) {
      const els = elements.get(track.id) ?? [...track.elements]
      els[i] = { ...el, cant: cantSign(el.radius) * Math.abs(uSigned) }
      elements.set(track.id, els)
    }
  }

  // The connecting track: its ends are the two toes; a track without a
  // gradient gets one from them — the coupling then lays its ldS points.
  const withWrites = tracks.map(t => (heights.has(t.id) ? { ...t, heights: heights.get(t.id) } : t))
  const joints = jointHeightUpdates(withWrites, switches, [...heights].flatMap(([id, h]) => {
    const track = withWrites.find(t => t.id === id)
    const L = trackLength(track)
    return [0, h.length - 1].filter(i => i === 0 ? h[0].station <= STATION_TOL : L - h[i].station <= STATION_TOL)
      .map(i => ({ trackId: id, index: i, z: h[i].z }))
  }))
  for (const [id, h] of joints) if (!heights.has(id)) heights.set(id, h)
  const conn = crossover.conn
  if (!(conn.heights?.length >= 2)) {
    const toeZ = (sw) => {
      const id = sw.portB2_trackId
      const t = withWrites.find(x => x.id === id)
      const st = (sw.portB2_endpoint ?? 'BEGIN') === 'END' ? trackLength(t) : 0
      return gradientAt(heights.get(id) ?? t.heights, st)
    }
    const z0 = toeZ(crossover.w1), z1 = toeZ(crossover.w2)
    if (z0 != null && z1 != null) {
      heights.set(conn.id, [{ station: 0, z: roundMm(z0) }, { station: roundMm(trackLength(conn)), z: roundMm(z1) }])
    }
  }

  return {
    ok: true, u: Math.abs(uSigned), uExact: Math.abs(uExact), y, e, shares, heights, elements,
    warnings: [...warnings], frame,
  }
}

// ── What the form draws and picks ───────────────────────────────────────────

/**
 * The stretch of each line a plan may change, in line distances: the zone
 * and the marked range around it — what the map shows. `limits` as for
 * planCrossoverGradient.
 */
export function crossoverRanges(frame, limits) {
  return [frame.zone1, frame.zone2].map((zone, i) => {
    const [lo, hi] = zone[0] <= zone[1] ? zone : [zone[1], zone[0]]
    return { line: i === 0 ? frame.line1 : frame.line2, zone: [lo, hi],
      range: [lo - (limits[i]?.before ?? 0), hi + (limits[i]?.after ?? 0)] }
  })
}

/** Points [E, N] of a line from one distance to another, every `step` metres. */
export function lineCoordinates(line, from, to, step = 2) {
  const lo = Math.max(from, line[0].from)
  const hi = Math.min(to, line[line.length - 1].from + line[line.length - 1].length)
  const out = []
  for (let d = lo; d < hi; d += step) { const p = chainPoint(line, d); if (p) out.push(p) }
  const last = chainPoint(line, hi)
  if (last) out.push(last)
  return out
}

/** The line distance of a station of one of the line's tracks, or null where the track is not on it. */
export function lineDistance(line, trackId, station) {
  const seg = line.find(s => s.track.id === trackId)
  return seg ? distanceOf(seg, station) : null
}

/** The track a line runs on at a distance — what a range end is named after. */
export const lineTrackAt = (line, d) => {
  const lo = line[0].from, hi = line[line.length - 1].from + line[line.length - 1].length
  return segmentAt(line, Math.max(lo, Math.min(hi, d)))?.track ?? null
}
