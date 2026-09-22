import { projectOnArcUtm } from './elementUtils'
import { projectOnTransitionUtm, clothoidRadiusAt } from './clothoidUtils'
import { pointAtStationUtm } from './heightUtils'
import {
  ALL_SWITCH_TYPES,
  asRadius, switchBranchLength,
} from './switchUtils'

/**
 * The switches a file does not state — read out of the alignment itself.
 *
 * Satzart 31 is an inventory, and an inventory can be short: a survey delivery
 * carries the alignment complete and its Knoten only as far as somebody entered
 * them. What the alignment says is unambiguous in one case — **a track that
 * ends on another track is a turnout**. Nothing else parts a rail; a track
 * simply stopping in the middle of another one is not a thing that exists on
 * the ground.
 *
 * Where two tracks only *cross*, nothing follows. That is a Kreuzung on one
 * level and an Überwerfungsbauwerk on two, and in plan the two are the same
 * picture — the height records do not decide it either, since both are stated
 * as an ordinary gradient. So a crossing is left to Satzart 31, where somebody
 * decided it.
 *
 * The form is read off the geometry: a turnout is tangential at its toe, so
 * nothing but **curvature** tells its branch from the track running on —
 * κ_form = κ_branch − κ_stem, the relation a bent switch is built on
 * (switchUtils.branchRadius) — and the angle that difference turns through over
 * the branch's arc is the frog angle. Measured against the turnouts the
 * delivered databases state a Bauform for, the pair reproduces the stated form
 * exactly in the median, for every form in the catalogue.
 *
 * An end that lies on another track and leaves it with **no** angle is no
 * turnout: it is one track running into the middle of another, which is a
 * chain cut somewhere else or the same stretch surveyed twice. Those are
 * counted and named, not turned into switches.
 */

/** How far a track end may sit from another track's axis and still be on it [m]. */
export const ON_TOL = 0.5

/**
 * How far a Weichenanfang may sit from either of its two tracks before it is
 * reported [m]. Not a refusal — the switch is set — but a Weichenanfang is a
 * surveyed point on two surveyed tracks, and a centimetre is what that is worth.
 */
export const AXIS_TOL = 0.05

/** A hit this close to the other track's own end is a joint, not a turnout [m]. */
const END_TOL = 1.0

/** A derived point this close to one already known is that one [m]. */
const SAME_TOL = 2.0

/**
 * Flattest frog angle that is still a turnout's. The catalogue ends at 1:26.5
 * and nothing on the network is flatter; beyond this the branch is not leaving,
 * it is running on.
 */
const MAX_RATIO = 40

/** Side of the index grid [m]. */
const CELL = 100

const ALL_TYPES = ALL_SWITCH_TYPES

export const trackLength = (t) => (t.elements ?? []).reduce((s, e) => s + (e.length ?? 0), 0)

/**
 * Exact offset of a plane point from one element: the perpendicular distance to
 * the element's own geometry, and the station along it.
 *
 * The chord is not good enough for this. A 100 m arc of R = 500 m leaves its
 * chord by 2.5 m in the middle, so a point measured against chords cannot be
 * held to a centimetre — and a centimetre is what is being asked about here.
 */
export function offsetOnElement(el, pt, epsg) {
  const start = { easting: el.startNode[0], northing: el.startNode[1], zone: epsg }
  const p = { easting: pt[0], northing: pt[1], zone: epsg }
  const hit = el.elementType === 2 && el.r1 !== undefined
    ? projectOnTransitionUtm(start, p, el.bearing, el.length, el.r1, el.r2 ?? null, el.transitionType)
    : projectOnArcUtm(start, p, el.bearing, asRadius(el.radius))
  const s = Math.min(el.length ?? 0, Math.max(0, hit.along))
  // Beyond either end the foot of the perpendicular is off the element, so what
  // is measured is the distance to the end itself.
  if (hit.along >= 0 && hit.along <= (el.length ?? 0)) return { s, dist: Math.abs(hit.perp) }
  const foot = pointAtStationUtm(el, s, epsg)
  return { s, dist: Math.hypot(foot.easting - pt[0], foot.northing - pt[1]) }
}

/** Exact offset of a plane point from a whole track: { dist, station }. */
export function offsetOnTrack(track, pt) {
  let best = null
  let acc = 0
  for (const el of track.elements ?? []) {
    const { s, dist } = offsetOnElement(el, pt, track.epsg)
    if (!best || dist < best.dist) best = { dist, station: acc + s }
    acc += el.length ?? 0
  }
  return best
}

/** How far an arc's middle leaves its chord [m] — how far its box must grow. */
function bulge(el) {
  const r = Math.abs(asRadius(el.radius) ?? asRadius(el.r1) ?? asRadius(el.r2) ?? 0)
  return r ? ((el.length ?? 0) ** 2) / (8 * r) : 0
}

/** Distance of a point from an element's chord — the cheap test before the exact one. */
function chordDist(el, pt) {
  const [sx, sy] = el.startNode
  const [ex, ey] = el.endNode
  const dx = ex - sx
  const dy = ey - sy
  const len2 = dx * dx + dy * dy
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((pt[0] - sx) * dx + (pt[1] - sy) * dy) / len2)) : 0
  return Math.hypot(pt[0] - (sx + u * dx), pt[1] - (sy + u * dy))
}

/**
 * Every element of every track, filed by a square grid of its own plane, so a
 * point can ask what runs near it without walking the whole database. An
 * element goes into each cell its chord's box touches, grown by how far its
 * curve leaves that chord and by the tolerance — so a point within tolerance of
 * an element always finds it in its own cell.
 */
export function trackGrid(tracks) {
  const cells = new Map()
  const lengths = new Map()
  for (const track of tracks) {
    let acc = 0
    lengths.set(track, trackLength(track))
    for (const el of track.elements ?? []) {
      const before = acc
      acc += el.length ?? 0
      if (!el.startNode || !el.endNode) continue
      const pad = bulge(el) + ON_TOL
      const entry = { track, el, before }
      const cx0 = Math.floor((Math.min(el.startNode[0], el.endNode[0]) - pad) / CELL)
      const cx1 = Math.floor((Math.max(el.startNode[0], el.endNode[0]) + pad) / CELL)
      const cy0 = Math.floor((Math.min(el.startNode[1], el.endNode[1]) - pad) / CELL)
      const cy1 = Math.floor((Math.max(el.startNode[1], el.endNode[1]) + pad) / CELL)
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = `${track.epsg}/${cx}/${cy}`
          let cell = cells.get(key)
          if (!cell) { cell = []; cells.set(key, cell) }
          cell.push(entry)
        }
      }
    }
  }
  return { cells, lengths }
}

/** What the grid holds in the cell a point falls in. */
const gridAt = (grid, epsg, pt) =>
  grid.cells.get(`${epsg}/${Math.floor(pt[0] / CELL)}/${Math.floor(pt[1] / CELL)}`) ?? []

/**
 * The track a point lies on, other than the ones skipped — the nearest one, and
 * only where the point falls inside it rather than at one of its own ends.
 *
 * A point at another track's end is a joint: two tracks meeting end to end is
 * how one line is delivered in pieces, and nothing parts there.
 */
export function throughTrackAt(grid, epsg, pt, skip, tol = ON_TOL) {
  let best = null
  for (const { track, el, before } of gridAt(grid, epsg, pt)) {
    if (skip.has(track)) continue
    if (chordDist(el, pt) > tol + bulge(el)) continue
    const { s, dist } = offsetOnElement(el, pt, epsg)
    if (dist > tol) continue
    const station = before + s
    const total = grid.lengths.get(track) ?? trackLength(track)
    if (station <= END_TOL || station >= total - END_TOL) continue
    if (!best || dist < best.dist) best = { track, el, s, station, dist }
  }
  return best
}

/**
 * Signed radius of an element in the direction it is travelled — null =
 * straight. `s` is the station along the element in its own direction, which
 * only a transition needs: its curvature runs from one end to the other.
 */
function signedRadius(el, forward, s = null) {
  const r = el.elementType === 2 && el.r1 !== undefined
    ? (s == null ? (forward ? el.r1 : el.r2) : clothoidRadiusAt(el.r1, el.r2 ?? null, el.length, s))
    : el.radius
  const v = asRadius(r)
  return v == null ? null : (forward ? v : -v)
}

/**
 * The arc a branch leaves its toe on: its signed radius and how far it runs on
 * it, taken across joints the survey happened to cut it at — a chain of
 * elements on one radius is one arc.
 */
function branchArc(track, endpoint) {
  const els = endpoint === 'BEGIN' ? track.elements : [...track.elements].reverse()
  const forward = endpoint === 'BEGIN'
  const signedR = signedRadius(els[0], forward)
  if (signedR == null) return null
  let length = 0
  for (const el of els) {
    const r = signedRadius(el, forward)
    if (r == null || Math.abs(r - signedR) / Math.abs(signedR) > 0.01) break
    length += el.length ?? 0
  }
  return { signedR, length }
}

/**
 * The form two alignments state where they part, or null where they part on
 * nothing.
 *
 * `stemSignedR` is the track the branch leaves, signed in the direction the
 * branch runs away from the toe; `arc` is what the branch does from there. The
 * form is the difference of the two curvatures, and the frog angle is what that
 * difference turns through over the arc — which for an unbent switch is simply
 * the branch's own radius and its own angle.
 */
export function formFromGeometry(stemSignedR, arc) {
  if (!arc) return null
  const kForm = 1 / arc.signedR - (stemSignedR ? 1 / stemSignedR : 0)
  if (!Number.isFinite(kForm) || kForm === 0) return null
  const angle = arc.length * Math.abs(kForm)
  if (!(angle > 0) || angle >= Math.PI / 2) return null
  return { R: Math.abs(1 / kForm), ratio: 1 / Math.tan(angle), side: kForm > 0 ? 'right' : 'left' }
}

/** How far a measured radius and frog angle may sit from a catalogue form. */
const R_TOL = 0.05
const N_TOL = 0.10

/** The catalogue form a measured one is, or null where the catalogue has none. */
export function formInCatalogue(measured) {
  if (!measured) return null
  let best = null
  for (const type of ALL_TYPES) {
    const dR = Math.abs(type.R - measured.R) / type.R
    const dn = Math.abs(type.ratio - measured.ratio) / type.ratio
    if (dR > R_TOL || dn > N_TOL) continue
    if (!best || dR + dn < best.score) best = { type, score: dR + dn }
  }
  return best?.type ?? null
}

/** The points already known, filed by cell so a lookup is not a scan. */
function pointIndex(points) {
  const cells = new Map()
  for (const p of points) {
    const key = `${p.epsg}/${Math.floor(p.point[0] / CELL)}/${Math.floor(p.point[1] / CELL)}`
    let cell = cells.get(key)
    if (!cell) { cell = []; cells.set(key, cell) }
    cell.push(p.point)
  }
  return {
    add(epsg, pt) {
      const key = `${epsg}/${Math.floor(pt[0] / CELL)}/${Math.floor(pt[1] / CELL)}`
      let cell = cells.get(key)
      if (!cell) { cell = []; cells.set(key, cell) }
      cell.push(pt)
    },
    // SAME_TOL is far below a cell, so the nine around the point are all of it.
    has(epsg, pt, tol) {
      const cx = Math.floor(pt[0] / CELL)
      const cy = Math.floor(pt[1] / CELL)
      for (let x = cx - 1; x <= cx + 1; x++) {
        for (let y = cy - 1; y <= cy + 1; y++) {
          for (const q of cells.get(`${epsg}/${x}/${y}`) ?? []) {
            if (Math.hypot(q[0] - pt[0], q[1] - pt[1]) <= tol) return true
          }
        }
      }
      return false
    },
  }
}

/** Does the branch run with the host's own direction, or against it? */
function branchRuns(track, endpoint, hostEl) {
  const els = track.elements
  const el = endpoint === 'BEGIN' ? els[0] : els[els.length - 1]
  const b = endpoint === 'BEGIN'
    ? el.bearing
    : ((el.endBearing ?? el.bearing) + 180) % 360
  return Math.abs(((b - hostEl.bearing + 540) % 360) - 180) <= 90
}

/** `R ≈ 245 m, 1:8.3` — what the alignment says the form is. */
const measuredText = (m) => `R ≈ ${m.R.toFixed(0)} m, 1:${m.ratio.toFixed(1)}`

/**
 * Every turnout the alignment states and Satzart 31 does not.
 *
 * `stated` are the points the file already puts a Bauteil on, as
 * `{ epsg, point }` — a track ending at one of them is that switch, not a new
 * one, whether or not it could be placed.
 *
 * Returns { units, errors, running }: units in the shape `placeMdbSwitches`
 * consumes, each carrying the form its geometry gave it; one error line per
 * place where a track parts from another and the form could not be named —
 * which is the list of what the Weichenkatalog is still missing — and
 * `running`, the ends that lie on another track without parting from it.
 */
export function deriveMdbTurnouts(tracks, stated = [], { tol = ON_TOL } = {}) {
  const grid = trackGrid(tracks)
  const seen = pointIndex(stated)
  const units = []
  const errors = []
  let running = 0

  for (const track of tracks) {
    const els = track.elements ?? []
    if (!els.length) continue
    for (const endpoint of ['BEGIN', 'END']) {
      const node = endpoint === 'BEGIN' ? els[0].startNode : els[els.length - 1].endNode
      if (!node) continue
      const host = throughTrackAt(grid, track.epsg, node, new Set([track]), tol)
      if (!host) continue
      if (seen.has(track.epsg, node, SAME_TOL)) continue

      const stem = signedRadius(host.el, branchRuns(track, endpoint, host.el), host.s)
      const measured = formFromGeometry(stem, branchArc(track, endpoint))
      // No angle between the two: one track running into the middle of another
      // is a chain cut elsewhere or the same stretch surveyed twice, not a
      // turnout. Nothing is placed and nothing is claimed.
      if (!measured || measured.ratio > MAX_RATIO) { running++; continue }

      seen.add(track.epsg, node)
      const where = `${track.name ?? '?'} (${endpoint === 'BEGIN' ? 'Anfang' : 'Ende'}) `
        + `auf ${host.track.name ?? '?'} bei ${host.station.toFixed(0)} m`
      const type = formInCatalogue(measured)
      if (!type) {
        errors.push(`${where}: Weiche fehlt in Satzart 31, ${measuredText(measured)} `
          + '– diese Form steht nicht im Weichenkatalog. Nicht gesetzt.')
        continue
      }
      if (trackLength(track) < switchBranchLength(type)) {
        errors.push(`${where}: Weiche fehlt in Satzart 31, ${type.label} – das Zweiggleis ist `
          + `mit ${trackLength(track).toFixed(1)} m kürzer als die Weichenform. Nicht gesetzt.`)
        continue
      }
      units.push({
        pad: null, bst: null, name: null, number: null,
        kind: 'turnout', label: type.label,
        radius: type.R, slope: type.ratio, rail: null,
        type, derived: true, where,
        point: node, epsg: track.epsg, offset: host.dist,
        pads: [], padBySuffix: {}, flagged: false,
      })
    }
  }
  if (running) {
    errors.push(`${running} Gleisenden liegen mitten auf einem anderen Gleis, zweigen dort aber `
      + 'nicht ab – kein Weichenanfang, sondern eine anderswo getrennte Kette oder dieselbe '
      + 'Strecke zweimal vermessen.')
  }
  return { units, errors, running }
}
