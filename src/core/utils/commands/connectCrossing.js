import { buildCrossingOnTrack, crossingOnTrackPlacement, crossingOnTrackPort } from './switches'
import { hostPointAt, refitOutcome } from './connectSwitch'
import { connectionRoots, fitConnectingElement, joinRouteIntoTrack, refitTrackEnd } from '../connectToTrack'
import { crossingAngle, crossingEndDistance } from '../switch/crossing'
import { trackLength } from '../heightUtils'
import { nextTrackName, reverseTrack } from '../trackModel'
import { portTrack, withPort } from '../switchModel'

// "Kreuzung(-sweiche) an Gleis anschließen" (Entscheidung 307): a crossing or
// crossing switch laid into the host track, one end of its cross route — B or
// D — running into the open end of another track. As for a turnout
// (connectSwitch), the element at that end is refitted and the crossing point
// slides along the host until the two meet tangentially.

/** Scan step along the host [m]. */
const SCAN_STEP = 2

/** The crossing's cross angle for a side, signed as CrossingOnTrackForm signs it [deg]. */
export const crossAngleOf = (form, crossSide) => {
  const alpha = crossingAngle(form) * 180 / Math.PI
  return crossSide === 'right' ? alpha : -alpha
}

/** The side of the host, seen along it, the port lies on. */
function portSide(port, crossSide) {
  // D runs ahead on the cross bearing, B behind on its reverse: the side the
  // crossing turns to is D's, the other one B's.
  return port === 'D' ? crossSide : crossSide === 'right' ? 'left' : 'right'
}

/** The side of the host, seen along it, a point lies on. */
function sideOf(track, station, point) {
  const p = hostPointAt(track, station), q = hostPointAt(track, station, 0.1)
  if (!p || !q) return 'left'
  const cross = (q.easting - p.easting) * (point.northing - p.northing) - (q.northing - p.northing) * (point.easting - p.easting)
  return cross > 0 ? 'left' : 'right'
}

/**
 * Every way the crossing connects, nearest to the click first: per side the
 * cross route leaves to and per end (B, D), the crossing points where the
 * refitted element meets that end's leg. `preferred` is the nearest whose end
 * lies on the side the connected track does.
 *
 * Returns { solutions: [{ port, crossSide, x, fit, at }], preferred }.
 */
export function crossingConnectSolutions({ track, clickStation, anchor, form, lead = 0, only = null, reach: within = null }) {
  const total = trackLength(track)
  const endDist = crossingEndDistance(form)
  const near = clickStation
  const clickUtm = hostPointAt(track, near) ?? anchor.fixedUtm
  const reach = within ?? (2 * Math.hypot(clickUtm.easting - anchor.fixedUtm.easting, clickUtm.northing - anchor.fixedUtm.northing)
    + 2 * endDist + anchor.oldLength + 100)
  const from = Math.max(0, near - reach), to = Math.min(total, near + reach)
  const solutions = []
  for (const crossSide of ['right', 'left']) {
    const args = { track, endDist, form, crossAngle: crossAngleOf(form, crossSide) }
    for (const port of ['B', 'D']) {
      if (only && (only.crossSide !== crossSide || only.port !== port)) continue
      const portAt = (x) => {
        const end = crossingOnTrackPort({ ...args, pointStation: x }, port)
        return end && { port: end.utm, bearingIn: (end.bearing + 180) % 360 }
      }
      for (const root of connectionRoots(anchor, portAt, { from, to, step: SCAN_STEP, near, lead })) {
        const placement = crossingOnTrackPlacement({ ...args, pointStation: root.x })
        if (placement.error || !placement.geom) continue
        const portUtm = placement.geom[`port${port}_utm`]
        const at = { port: portUtm, bearingIn: root.at.bearingIn, placement }
        const fit = fitConnectingElement(anchor, portUtm, at.bearingIn, lead)
        if (fit && Math.abs(fit.miss) < 1e-5) solutions.push({ port, crossSide, x: root.x, fit, at })
      }
    }
  }
  solutions.sort((a, b) => Math.abs(a.x - near) - Math.abs(b.x - near))
  const own = (s) => portSide(s.port, s.crossSide) === sideOf(track, s.x, anchor.fixedUtm)
  return { solutions, preferred: solutions.find(own) ?? solutions[0] ?? null }
}

/** The connected track refitted and the chain the rules judge, before anything is written. */
export const crossingConnectOutcome = refitOutcome

/** What describes a track besides its geometry and its name — for the tracks the crossing adds. */
const describe = (track) => Object.fromEntries(Object.entries(track)
  .filter(([k]) => !['id', 'name', 'elements', 'coordinates', 'heights', 'epsg'].includes(k)))

/**
 * The commit: the crossing laid into the host as "Kreuzung auf Gleis" lays
 * it, the leg at the connected end joined into the refitted track (the leg
 * running from the crossing point out to the port), the other leg and the
 * slip routes as tracks of their own described like the connected one — the
 * argument for commitSwitchConnection, or { noRoom }.
 */
export function buildCrossingConnect({ track, target, anchor, solution, tracks, form, switchName, switchNumber, speedLimit = null }) {
  const { placement } = solution.at
  const laid = buildCrossingOnTrack({
    g: placement.geom, ahead: placement.ahead, track, tracks, form, endDist: crossingEndDistance(form),
    switchName, switchNumber, name: null, fields: {},
  })
  if (laid.noRoom) return laid
  const record = laid.addSwitches[0]
  const legId = portTrack(record, solution.port)
  const leg = laid.addTracks.find(tr => tr.id === legId)
  // Leg B runs from its port in to the crossing point, leg D out from it; the
  // join wants the route from the crossing point out.
  const route = solution.port === 'B' ? reverseTrack(leg) : leg
  const refitted = refitTrackEnd(target, anchor, solution.fit, solution.at.port, { speedLimit })
  const { track: joined, shift } = joinRouteIntoTrack(refitted, anchor, route)
  const moved = shift ? shift + trackLength(refitted) - trackLength(target) : 0
  const hostIds = new Set(laid.remap.flatMap(r => r.newId))
  const own = describe(target)
  // The other leg is the cross route's line on the far side: it is named after
  // the connected track, as the next free number of the same stem.
  const otherId = portTrack(record, solution.port === 'B' ? 'D' : 'B')
  const names = [...tracks.map(tr => tr.name), ...laid.addTracks.map(tr => tr.name)].filter(Boolean)
  const stem = (target.name ?? '').replace(/\.\d+$/, '') || 'track'
  const otherName = nextTrackName(stem, names)
  const described = (tr) => (hostIds.has(tr.id) ? tr
    : { ...tr, ...own, ...(tr.id === otherId ? { name: otherName } : {}) })
  return {
    removeTrackIds: [...laid.removeTrackIds, target.id],
    addTracks: [...laid.addTracks.filter(tr => tr.id !== legId).map(described), joined],
    addSwitches: [withPort(record, solution.port, { trackId: target.id, endpoint: anchor.endpoint })],
    remap: laid.remap,
    restation: moved ? [{ trackId: target.id, shift: moved }] : [],
  }
}
