import { portsOf } from './switchModel'
import { pointOnElement } from './platformUtils'
import { sampleTransitionUtm } from './clothoidUtils'
import { endKey } from './trackEndMarks'
import { absLengthErrors, epsgMismatches, nodeGaps, untrueLengths } from './chainChecks'
import { trackLabel } from './trackModel'
import { surveyDefect } from './axisSurvey'

/**
 * Whether a project record holds together — the check every merge result and
 * every revision the server takes has to pass (phase 10, "Die Validierung").
 * Pure, on the plane data alone, so browser and server run the same code on a
 * hydrated or a dehydrated record.
 *
 * Returns { errors, warnings }, each finding
 *   { code, key, collection, id, label?, params }
 * `key` names the finding stably (code and ids), so two states can be compared
 * for what is new in one of them (newFindings).
 *
 * The element chains are checked as far as they hold for existing track: an
 * imported track has real kinks and node gaps of millimetres (the PEK data set
 * one of 9 cm), so a gap of a centimetre or more is a warning, and an error only where it is a break
 * no survey leaves (GAP_ERROR).
 */

/** A node gap above this [m] is worth a warning … */
const GAP_WARNING = 0.01
/** … and above this a broken chain, not survey noise. */
const GAP_ERROR = 0.5

/** Stations may overshoot the track length by this much [m]. */
const STATION_TOL = 0.01

/** Two tracks lying on each other: closer than this [m] … */
const OVERLAP_DIST = 0.5
/** … over more than this [m]. */
const OVERLAP_LENGTH = 10

const trackLength = (t) => (t.elements ?? []).reduce((s, e) => s + (e.length ?? 0), 0)

export function validateProject(project) {
  const errors = [], warnings = []
  const tracks = project?.tracks ?? []
  const switches = project?.switches ?? []
  const byId = new Map(tracks.map(t => [t.id, t]))

  const add = (list, code, collection, id, label, params = {}, extra = '') => {
    list.push({ code, key: `${code}:${collection}:${id}${extra ? `:${extra}` : ''}`, collection, id, label, params })
  }

  // ── switches: every port on a track and an end, no end held twice ──
  const held = new Map()
  for (const sw of switches) {
    const label = sw.name ?? sw.label ?? sw.switchId
    for (const { port, trackKey, endKey: ek } of portsOf(sw)) {
      const trackId = sw[trackKey], endpoint = sw[ek]
      if (!trackId || !byId.has(trackId)) {
        add(errors, 'port_track_missing', 'switches', sw.switchId, label, { port, trackId }, port)
        continue
      }
      if (endpoint !== 'BEGIN' && endpoint !== 'END') {
        add(errors, 'port_endpoint_invalid', 'switches', sw.switchId, label, { port, endpoint }, port)
        continue
      }
      const k = endKey(trackId, endpoint)
      if (held.has(k) && held.get(k).switchId !== sw.switchId) {
        add(errors, 'end_held_twice', 'switches', sw.switchId, label,
          { port, track: trackLabel(byId.get(trackId)), endpoint, other: held.get(k).label }, port)
      } else if (!held.has(k)) {
        held.set(k, { switchId: sw.switchId, label })
      }
    }
  }

  // ── tracks: their switch elements, chains, heights ──
  const switchIds = new Set(switches.map(sw => sw.switchId))
  for (const t of tracks) {
    const label = trackLabel(t)
    const els = t.elements ?? []
    const missing = new Set(els.filter(el => el.switchId && !switchIds.has(el.switchId)).map(el => el.switchId))
    for (const switchId of missing) add(errors, 'element_switch_missing', 'tracks', t.id, label, { switchId }, switchId)

    for (const g of nodeGaps(els, GAP_WARNING)) {
      add(g.gap > GAP_ERROR ? errors : warnings, 'chain_gap', 'tracks', t.id, label,
        { index: g.index, gap: g.gap }, g.index)
    }
    for (const e of absLengthErrors(els, 1e-3)) {
      add(errors, 'chain_abs_length', 'tracks', t.id, label, e, e.index)
    }
    for (const e of untrueLengths(els)) add(warnings, 'chain_length', 'tracks', t.id, label, e, e.index)
    for (const e of epsgMismatches(t)) add(errors, 'chain_epsg', 'tracks', t.id, label, e, e.index)

    const length = trackLength(t)
    const heights = t.heights ?? []
    heights.forEach((h, i) => {
      if (!(h.station >= -STATION_TOL && h.station <= length + STATION_TOL)) {
        add(errors, 'height_out_of_range', 'tracks', t.id, label, { station: h.station, length }, `h${i}`)
      }
      if (i > 0 && !(h.station > heights[i - 1].station)) {
        add(errors, 'height_not_rising', 'tracks', t.id, label, { station: h.station }, `r${i}`)
      }
    })
  }

  // ── platforms on their track, within its length ──
  for (const pf of project?.platforms ?? []) {
    const label = [pf.stationName, pf.code].filter(Boolean).join(' ') || pf.id
    const t = byId.get(pf.trackId)
    if (!t) { add(errors, 'platform_track_missing', 'platforms', pf.id, label, { trackId: pf.trackId }); continue }
    const length = trackLength(t)
    const inside = (s) => Number.isFinite(s) && s >= -STATION_TOL && s <= length + STATION_TOL
    if (!inside(pf.startStation) || !inside(pf.endStation)) {
      add(errors, 'platform_out_of_range', 'platforms', pf.id, label,
        { track: trackLabel(t), start: pf.startStation, end: pf.endStation, length })
    }
  }

  // ── end marks only on free ends (the rule of pruneEndMarks) ──
  const seen = new Set()
  for (const m of project?.endMarks ?? []) {
    const k = endKey(m.trackId, m.endpoint)
    const t = byId.get(m.trackId)
    const label = t ? `${trackLabel(t)} ${m.endpoint}` : m.id
    if (!t) add(errors, 'end_mark_track_missing', 'endMarks', m.id, label, { trackId: m.trackId })
    else if (held.has(k)) add(errors, 'end_mark_not_free', 'endMarks', m.id, label, { switch: held.get(k).label })
    else if (seen.has(k)) add(errors, 'end_mark_twice', 'endMarks', m.id, label, {})
    seen.add(k)
  }

  // ── measured axes: a plane and arrays of one length ──
  for (const s of project?.axisSurveys ?? []) {
    const defect = surveyDefect(s)
    if (defect) add(errors, 'axis_survey_malformed', 'axisSurveys', s?.id ?? '?', s?.name ?? s?.id, { field: defect })
  }

  // ── tracks drawn twice ──
  for (const o of overlappingTracks(tracks, switches)) {
    const [a, b] = [byId.get(o.a), byId.get(o.b)]
    add(warnings, 'tracks_overlap', 'tracks', o.a, trackLabel(a), { other: trackLabel(b), otherId: o.b, length: o.length }, o.b)
  }

  return { errors, warnings }
}

/** The findings of `next` that `previous` does not have (by key). */
export function newFindings(next, previous) {
  const known = new Set((previous ?? []).map(f => f.key))
  return (next ?? []).filter(f => !known.has(f.key))
}

// ── overlap ──────────────────────────────────────────────────────────────────

const SAMPLE_STEP = 2
const CELL = 5

function samplePlane(track) {
  const pts = []
  let station = 0
  for (const el of track.elements ?? []) {
    const L = el.length ?? 0
    if (!Array.isArray(el.startNode) || !(L > 0)) { station += L; continue }
    const n = Math.max(1, Math.ceil(L / SAMPLE_STEP))
    // A transition is integrated once along its length rather than from its
    // start for every sample.
    const run = el.elementType === 2
      ? sampleTransitionUtm({ easting: el.startNode[0], northing: el.startNode[1] }, el.bearing, L,
        el.r1 ?? null, el.r2 ?? null, el.transitionType, { steps: n, subdiv: 4 })
      : null
    for (let i = pts.length ? 1 : 0; i <= n; i++) {
      const s = L * i / n
      const [x, y] = run ? run[i] : (({ utm }) => [utm.easting, utm.northing])(pointOnElement(el, track.epsg, s))
      pts.push({ x, y, station: station + s })
    }
    station += L
  }
  return pts
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  const u = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(ax + u * dx - px, ay + u * dy - py)
}

/**
 * Pairs of tracks with different ids that lie on each other: closer than
 * OVERLAP_DIST over more than OVERLAP_LENGTH of one of them — the one case no
 * id comparison finds, two people having drawn the same track. Tracks that
 * meet at a switch are left out: a turnout's routes leave each other slowly
 * enough to run within half a metre for ten or twenty metres. Two tracks that
 * part from a common end do the same where no switch joins them (any longer:
 * it was deleted), so a stretch that begins or ends at an end both share
 * counts only once it covers half the shorter track — a track drawn twice
 * lies on the other all along. Only tracks in the same plane (epsg) are
 * compared.
 */
export function overlappingTracks(tracks, switches = []) {
  const together = new Set()
  for (const sw of switches) {
    const ids = portsOf(sw).map(p => sw[p.trackKey]).filter(Boolean)
    for (const a of ids) for (const b of ids) if (a !== b) together.add(`${a}|${b}`)
  }

  const samples = new Map(tracks.map(t => [t.id, samplePlane(t)]))
  const lengths = new Map(tracks.map(t => [t.id, (t.elements ?? []).reduce((sum, e) => sum + (e.length ?? 0), 0)]))
  const ends = new Map(tracks.map(t => {
    const pts = samples.get(t.id)
    return [t.id, pts.length ? [pts[0], pts[pts.length - 1]] : []]
  }))
  const SHARED = 1   // [m] a stretch this close to an end both tracks have starts there
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < SHARED
  const fromSharedEnd = (a, b, run) => ends.get(a).some(ea => ends.get(b).some(eb => near(ea, eb)
    && (near(ea, run.start) || near(ea, run.end))))
  const keep = (a, b, run) => !fromSharedEnd(a, b, run)
    || run.to - run.from >= 0.5 * Math.min(lengths.get(a), lengths.get(b))
  const grid = new Map()
  const cellKey = (epsg, cx, cy) => `${epsg}|${cx}|${cy}`
  for (const t of tracks) {
    const pts = samples.get(t.id)
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]
      const x0 = Math.floor(Math.min(a.x, b.x) / CELL), x1 = Math.floor(Math.max(a.x, b.x) / CELL)
      const y0 = Math.floor(Math.min(a.y, b.y) / CELL), y1 = Math.floor(Math.max(a.y, b.y) / CELL)
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const k = cellKey(t.epsg, cx, cy)
          if (!grid.has(k)) grid.set(k, [])
          grid.get(k).push({ id: t.id, a, b })
        }
      }
    }
  }

  const found = new Map()
  for (const t of tracks) {
    const runs = new Map()      // other id → { from, to }
    for (const p of samples.get(t.id)) {
      const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL)
      const close = new Map()
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const seg of grid.get(cellKey(t.epsg, cx + dx, cy + dy)) ?? []) {
            if (seg.id === t.id || together.has(`${t.id}|${seg.id}`)) continue
            const d = segDist(p.x, p.y, seg.a.x, seg.a.y, seg.b.x, seg.b.y)
            if (d < (close.get(seg.id) ?? Infinity)) close.set(seg.id, d)
          }
        }
      }
      for (const [other, run] of runs) {
        if (!((close.get(other) ?? Infinity) < OVERLAP_DIST)) {
          if (keep(t.id, other, run)) record(found, t.id, other, run)
          runs.delete(other)
        }
      }
      for (const [other, d] of close) {
        if (d >= OVERLAP_DIST) continue
        const run = runs.get(other)
        if (run) { run.to = p.station; run.end = p } else runs.set(other, { from: p.station, to: p.station, start: p, end: p })
      }
    }
    for (const [other, run] of runs) if (keep(t.id, other, run)) record(found, t.id, other, run)
  }
  return [...found.values()]
}

function record(found, a, b, run) {
  const length = run.to - run.from
  if (!(length > OVERLAP_LENGTH)) return
  const [x, y] = a < b ? [a, b] : [b, a]
  const k = `${x}|${y}`
  if (!found.has(k) || found.get(k).length < length) found.set(k, { a: x, b: y, length })
}
