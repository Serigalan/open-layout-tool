import { utmToWgs84 } from './coordinateUtils'
import {
  nodeUtm, endPointStraightUtm, endPointCurvedUtm, bearingAfterUtm, projectOnArcUtm,
} from './elementUtils'
import { transitionPointAtUtm, transitionBearingAtUtm } from './clothoidUtils'
import { heightAt } from './heightUtils'
import { SAGITTA_ELEMENT, STRAIGHT_VERTEX_SPACING } from './mapConstants'

/**
 * A platform is anchored to one track: the two picked points are stations along
 * it (m from the track's BEGIN), and its edges are perpendicular offsets of the
 * track's centreline between them — the front edge (the platform edge trains
 * stop at) at FRONT_OFFSET, the back edge a platform width behind it.
 * Everything is derived in the track's own plane and only turned into WGS84 for
 * the drawn polygon, which is stripped on persist and rebuilt on load like the
 * switch symbols.
 *
 * Vertically the platform is stated over top of rail (`height`, mm), so the
 * edge stays tied to the track: its absolute elevation is the track's gradient
 * at that station plus that height (see platformEdgeElevation), and the two
 * are never maintained side by side.
 *
 * A track that is split (a switch placed on it) becomes two new tracks: a
 * platform on it keeps its record but can no longer resolve its host, so its
 * symbol is left out until it is deleted and drawn again.
 */

const DEG = Math.PI / 180

/**
 * Distance of the front edge from the track axis [m], and the platform's width
 * behind it. One value for every platform height and cant — the graded tables
 * belong to a later design stage, and this is the value an early one works with.
 */
export const PLATFORM_FRONT_OFFSET = 1.68
export const PLATFORM_WIDTH        = 3.00
export const PLATFORM_BACK_OFFSET  = PLATFORM_FRONT_OFFSET + PLATFORM_WIDTH

/** Platform heights over top of rail [mm]: the standard ones, and the default. */
export const PLATFORM_HEIGHTS       = [380, 550, 760]
export const DEFAULT_PLATFORM_HEIGHT = 550

/** Longest station code (DS100-style abbreviation) accepted. */
export const PLATFORM_CODE_MAX = 4

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** The elements of a track with the station each of them starts and ends at. */
export function elementStations(track) {
  let station = 0
  return (track?.elements ?? []).map((el, index) => {
    const start = station
    station += el.length ?? 0
    return { el, index, start, end: station }
  })
}

/** Point and tangent bearing at station `s` within one element, in the plane. */
function pointOnElement(el, epsg, s) {
  const startUtm = nodeUtm(el.startNode, el.geometry?.coordinates?.[0], epsg)
  if (el.elementType === 2) {
    return {
      utm:     transitionPointAtUtm(startUtm, el.bearing, el.length, el.r1 ?? null, el.r2 ?? null, el.transitionType, s),
      bearing: transitionBearingAtUtm(el.bearing, el.length, el.r1 ?? null, el.r2 ?? null, el.transitionType, s),
    }
  }
  if (el.radius != null) {
    return {
      utm:     endPointCurvedUtm(startUtm, el.bearing, s, el.radius),
      bearing: bearingAfterUtm(el.bearing, s, el.radius),
    }
  }
  return { utm: endPointStraightUtm(startUtm, el.bearing, s), bearing: el.bearing }
}

/** Point and tangent bearing at a station of the whole track, in its plane. */
export function pointAtStation(track, station) {
  const rows = elementStations(track)
  if (!rows.length || !track?.epsg) return null
  const total = rows[rows.length - 1].end
  const s     = clamp(station, 0, total)
  const row   = rows.find(r => s <= r.end + 1e-9) ?? rows[rows.length - 1]
  return pointOnElement(row.el, track.epsg, s - row.start)
}

/**
 * Sampling step [m] along an element so its offset edge stays within the
 * element sagitta of the true curve. The edge carries its own radius (the
 * offset shifts it), which is what the step has to be sized for.
 */
function sampleStep(el, dist) {
  const stepFor = (radius) => {
    const r = Math.abs(radius)
    if (!(r > 0.5)) return null
    return Math.max(0.5, r * 2 * Math.acos(clamp(1 - SAGITTA_ELEMENT / r, -1, 1)))
  }
  if (el.radius != null) return stepFor(el.radius - dist) ?? STRAIGHT_VERTEX_SPACING
  if (el.elementType === 2) {
    // Curvature varies along a transition — size the step for its tightest end.
    const radii = [el.r1, el.r2].filter(r => r != null && Number.isFinite(r)).map(r => r - dist)
    const steps = radii.map(stepFor).filter(s => s != null)
    return steps.length ? Math.min(...steps) : 5
  }
  return STRAIGHT_VERTEX_SPACING
}

/**
 * Polyline (WGS84) of the track's centreline between two stations, offset
 * perpendicular by `dist` metres — positive to the right of the running
 * direction, the same sign convention as offsetTrackElements. Every point is
 * stepped along the element in the track's own plane, so an offset arc point
 * lands exactly on the concentric circle.
 */
export function offsetEdgeCoords(track, from, to, dist) {
  const epsg = track?.epsg
  const rows = elementStations(track)
  if (!epsg || !rows.length) return null
  const total = rows[rows.length - 1].end
  const a = clamp(Math.min(from, to), 0, total)
  const b = clamp(Math.max(from, to), 0, total)
  if (!(b - a > 1e-6)) return null

  const out = []
  const push = ({ easting, northing }, bearing) => {
    // Right-hand perpendicular of the running direction.
    const rad = bearing * DEG
    const p = utmToWgs84(easting + dist * Math.cos(rad), northing - dist * Math.sin(rad), epsg)
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }

  for (const row of rows) {
    const from_ = Math.max(a, row.start)
    const to_   = Math.min(b, row.end)
    if (to_ - from_ <= 1e-9) continue
    const n = Math.max(1, Math.ceil((to_ - from_) / sampleStep(row.el, dist)))
    for (let i = 0; i <= n; i++) {
      const s = from_ - row.start + (to_ - from_) * i / n
      const { utm, bearing } = pointOnElement(row.el, epsg, s)
      push(utm, bearing)
    }
  }
  return out.length >= 2 ? out : null
}

/** Signed offsets of the two edges: the side decides which way they go. */
export function edgeOffsets(platform) {
  const sign  = platform.side === 'left' ? -1 : 1
  const front = platform.frontOffset ?? PLATFORM_FRONT_OFFSET
  // The back edge follows the front one: moving the edge shifts the platform,
  // it does not make it narrower.
  const back  = platform.backOffset ?? (front + PLATFORM_WIDTH)
  return { front: sign * front, back: sign * back }
}

/**
 * Absolute elevation of the platform edge at a station [m], in the track's own
 * height datum: the track's gradient there plus the platform height over top of
 * rail. Null where the track has no heights yet or the platform no height —
 * the edge is then simply not located vertically, which is not an error in an
 * early design stage.
 */
export function platformEdgeElevation(platform, track, station) {
  const z = heightAt(track?.heights, station)
  const height = Number(platform?.height)
  return z == null || !Number.isFinite(height) ? null : z + height / 1000
}

/** Closed ring (WGS84) of a platform: front edge out, back edge back. */
export function platformRing(platform, track) {
  const { front, back } = edgeOffsets(platform)
  const frontCoords = offsetEdgeCoords(track, platform.startStation, platform.endStation, front)
  const backCoords  = offsetEdgeCoords(track, platform.startStation, platform.endStation, back)
  if (!frontCoords || !backCoords) return null
  return [...frontCoords, ...[...backCoords].reverse(), frontCoords[0]]
}

/** Rebuild a platform's drawn polygon from its plane data (see hydrateProjects). */
export function rebuildPlatformSymbol(platform, trackById) {
  const { coords: _c, ...rest } = platform
  const track = trackById[platform.trackId]
  if (!track) return rest
  const ring = platformRing(rest, track)
  return ring ? { ...rest, coords: ring } : rest
}

/**
 * Station of a point clicked on element `elIdx` of a track. A straight or arc
 * is projected onto analytically; a transition has no closed form, so the
 * nearest point of a dense sampling of its own curve stands in — a click is
 * only ever a starting value the form lets the user correct.
 */
export function stationFromClick(track, elIdx, clickUtm) {
  const row = elementStations(track)[elIdx]
  if (!row || !track?.epsg) return null
  const { el } = row
  let along
  if (el.elementType === 2) {
    const distAt = (s) => {
      const { utm } = pointOnElement(el, track.epsg, s)
      return Math.hypot(utm.easting - clickUtm.easting, utm.northing - clickUtm.northing)
    }
    // Coarse scan for the bracket, then a ternary search inside it — the
    // distance falls and rises again around the single nearest point.
    const n = 64
    let best = Infinity
    for (let i = 0; i <= n; i++) {
      const s = el.length * i / n
      const d = distAt(s)
      if (d < best) { best = d; along = s }
    }
    let lo = Math.max(0, along - el.length / n)
    let hi = Math.min(el.length, along + el.length / n)
    for (let i = 0; i < 40 && hi - lo > 1e-4; i++) {
      const m1 = lo + (hi - lo) / 3
      const m2 = hi - (hi - lo) / 3
      if (distAt(m1) < distAt(m2)) hi = m2; else lo = m1
    }
    along = (lo + hi) / 2
  } else {
    const startUtm = nodeUtm(el.startNode, el.geometry?.coordinates?.[0], track.epsg)
    along = projectOnArcUtm(startUtm, clickUtm, el.bearing, el.radius ?? null).along
  }
  return row.start + clamp(along, 0, el.length)
}

/** Length of the platform along the track [m]. */
export const platformLength = (platform) =>
  Math.abs((platform?.endStation ?? 0) - (platform?.startStation ?? 0))
