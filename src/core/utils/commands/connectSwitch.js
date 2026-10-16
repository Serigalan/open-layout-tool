import { buildSwitchOnTrack, switchOnTrackPlacement, switchOnTrackRemnant, switchOnTrackRouteEnd } from './switches'
import { connectionRoots, fitConnectingElement, joinRouteIntoTrack, refitCount, refitTrackEnd } from '../switch/connectToTrack'
import { switchStraightLength, switchBranchLength } from '../switch/catalogue'
import { switchRoutePointUtm } from '../switch/route'
import { elementAtStation, trackLength } from '../track/heightUtils'
import { reverseElement } from '../geometry/elementUtils'
import { checkTrack } from '../rules/trassierungCheck'
import { severityRank } from '../rules/regelkatalog'
import { portTrack, withPort } from '../track/switchModel'

// "Weiche an Gleis anschließen" (Entscheidungen 302–304): a turnout laid into
// the host track whose new route ends on an open end of another track. The
// element at that end is refitted (connectToTrack) and the turnout slides along
// the host until the two meet tangentially.

/** Scan step along the host [m]: the miss is smooth, two roots closer than this are one choice. */
const SCAN_STEP = 2

/**
 * The turnout at toe station `x` as the search needs it: where its new route
 * — the branch, or the straight of a swapped one — ends and the bearing the
 * connecting element has to arrive there on, against the route. Null where the
 * turnout cannot lie at x. With `full`, also the placement it came from, which
 * the commit builds from.
 */
function routeEndAt({ track, reversed, sw, side }, x, full = false) {
  const straightLen = switchStraightLength(sw)
  if (!full) {
    const end = switchOnTrackRouteEnd({ track, reversed, sw, side, straightLen }, x)
    return end && { port: end.utm, bearingIn: (end.bearing + 180) % 360 }
  }
  const p = switchOnTrackPlacement({ track, toeStation: x, reversed, sw, side, straightLen })
  if (p.error || !p.geom) return null
  const g = p.geom
  const end = g.swapped
    ? { utm: g.swapped.straightUtm, bearing: g.swapped.mainEndBearing }
    : { utm: g.curvedUtm, bearing: g.branchEndBearing }
  return { port: end.utm, bearingIn: (end.bearing + 180) % 360, placement: p }
}

/** The point of the host at `station`, and one `ahead` metres further along it. */
export function hostPointAt(track, station, ahead = 0) {
  const hit = elementAtStation(track.elements, Math.min(trackLength(track), Math.max(0, station)))
  if (!hit) return null
  const el = hit.el
  const route = el.elementType === 2
    ? { length: el.length, r1: el.r1 ?? null, r2: el.r2 ?? null }
    : { length: el.length, r1: el.radius ?? null, r2: el.radius ?? null }
  const start = { easting: el.startNode[0], northing: el.startNode[1], zone: track.epsg }
  return switchRoutePointUtm(start, el.bearing, route, Math.min(el.length, hit.s + ahead))
}

/** The side of the host, seen in the direction a turnout opens in, a point lies on. */
function sideOf(track, station, reversed, point) {
  const p = hostPointAt(track, station), q = hostPointAt(track, station, 0.1)
  if (!p || !q) return 'left'
  const sign = (reversed ? -1 : 1) * ((q.easting - p.easting) * (point.northing - p.northing)
    - (q.northing - p.northing) * (point.easting - p.easting))
  return sign > 0 ? 'left' : 'right'
}

/**
 * Every way the turnout connects, nearest to the click first: per opening
 * direction and side, the toe stations where the refitted element meets its
 * route (connectionRoots). The scan covers the stretch of host the
 * connection can reasonably lie on — around the click, as far again as the
 * connecting element's node lies from it, plus the turnout.
 *
 * `lead` puts a transition of that length before the refitted arc (a remedy);
 * `only` ({ reversed, side }) and `reach` narrow the search to one way and to
 * that far around `clickStation`, as a remedy asks it again near a solution.
 *
 * Returns { solutions: [{ reversed, side, x, fit, at }], preferred } — the
 * preferred one on the side the connected track lies on, where there is one.
 */
export function switchConnectSolutions({ track, clickStation, anchor, sw, lead = 0, only = null, reach: within = null }) {
  const total = trackLength(track)
  const near = clickStation
  const clickUtm = hostPointAt(track, near) ?? anchor.fixedUtm
  const reach = within ?? (2 * Math.hypot(clickUtm.easting - anchor.fixedUtm.easting, clickUtm.northing - anchor.fixedUtm.northing)
    + 2 * switchBranchLength(sw) + anchor.oldLength + 100)
  const from = Math.max(0, near - reach), to = Math.min(total, near + reach)
  const solutions = []
  for (const reversed of [false, true]) {
    for (const side of ['left', 'right']) {
      if (only && (only.reversed !== reversed || only.side !== side)) continue
      const args = { track, reversed, sw, side }
      for (const root of connectionRoots(anchor, x => routeEndAt(args, x), { from, to, step: SCAN_STEP, near, lead })) {
        // Found on the route's end alone; the commit builds from the whole
        // placement, and the element is refitted to the port that one gives.
        const at = routeEndAt(args, root.x, true)
        const fit = at && fitConnectingElement(anchor, at.port, at.bearingIn, lead)
        if (fit && Math.abs(fit.miss) < 1e-5) solutions.push({ reversed, side, x: root.x, fit, at })
      }
    }
  }
  solutions.sort((a, b) => Math.abs(a.x - near) - Math.abs(b.x - near))
  const own = (s) => s.side === sideOf(track, s.x, s.reversed, anchor.fixedUtm)
  return { solutions, preferred: solutions.find(own) ?? solutions[0] ?? null }
}

/**
 * The connecting element with the neighbour it keeps, as one short chain read
 * towards the open end — for the rule check: its own rules and the joint to
 * the rest of its track, not the turnout's.
 */
function refitCheckChain(refitted, anchor, count = 1) {
  const els = refitted.elements
  if (anchor.endpoint === 'END') return els.slice(Math.max(0, anchor.elIdx - 1), anchor.elIdx + count)
  return els.slice(0, count + 1).reverse().map(reverseElement)
}

/** The indices in such a chain the rules are asked about: the refitted elements, the last `count`. */
const refitJudged = (chain, count = 1) => chain.map((_, i) => i).slice(-count)

/** Does the catalogue find an error on the refitted elements or their joints (Entscheidung 304)? */
function refitRuleError(chain, count = 1) {
  const per = checkTrack(chain).perElement
  return refitJudged(chain, count).some(i => severityRank(per[i]?.severity) >= severityRank('error'))
}

/**
 * What the solution means for the tracks before anything is written: the
 * connected track refitted, the remnants at the toe (Entscheidungen 219, 301)
 * and the chain the rules judge.
 */
export function switchConnectOutcome({ track, target, anchor, solution, speed, speedLimit = null }) {
  return {
    ...refitOutcome({ target, anchor, solution, speedLimit }),
    remnant: switchOnTrackRemnant(track, solution.x, solution.reversed, speed),
  }
}

/**
 * The connected track refitted to a solution, and what the rules judge of it:
 * `chain` read towards the open end (the neighbour, then the refitted
 * elements), `judged` the indices in it that are new, `element` the arc (or
 * the refitted element) and `lead` the transition before it, where there is
 * one; `speedLimit` caps the speeds there (a remedy).
 */
export function refitOutcome({ target, anchor, solution, speedLimit = null }) {
  const refitted = refitTrackEnd(target, anchor, solution.fit, solution.at.port, { speedLimit })
  const count = refitCount(solution.fit)
  const chain = refitCheckChain(refitted, anchor, count)
  return {
    refitted,
    chain,
    judged: refitJudged(chain, count),
    element: chain[chain.length - 1],
    lead: count > 1 ? chain[chain.length - 2] : null,
    ruleError: refitRuleError(chain, count),
    // How far the track's own stations move at its start: by the change of length.
    delta: trackLength(refitted) - trackLength(target),
  }
}

/**
 * The commit: the turnout laid into the host as "Weiche auf Gleis" lays it,
 * its new route joined into the refitted track instead of becoming a track of
 * its own (Entscheidung 303) — the argument for commitSwitchConnection, or
 * { noRoom } as buildSwitchOnTrack gives it.
 */
export function buildSwitchConnect({
  track, target, anchor, solution, tracks, sw, cant, cantReason, speed, switchName, switchNumber, speedLimit = null,
}) {
  const { placement } = solution.at
  const straightLen = switchStraightLength(sw)
  const laid = buildSwitchOnTrack({
    track, tracks, place: placement.place, g: placement.geom, plain: placement.plain, sw, straightLen,
    cant, cantReason, speed, switchName, switchNumber, name: target.name, fields: {},
  })
  if (laid.noRoom) return laid
  const record = laid.addSwitches[0]
  // The new route is the one track the turnout added beside the parted host.
  const routeId = laid.addTracks[laid.addTracks.length - 1].id
  const route = laid.addTracks.find(tr => tr.id === routeId)
  const refitted = refitTrackEnd(target, anchor, solution.fit, solution.at.port, { speedLimit })
  const { track: joined, shift } = joinRouteIntoTrack(refitted, anchor, route)
  // At the track's start its old stations move by the route and by the change
  // of length of the refitted end.
  const moved = shift ? shift + trackLength(refitted) - trackLength(target) : 0
  const portKey = ['B1', 'B2'].find(p => portTrack(record, p) === routeId)
  return {
    removeTrackIds: [...laid.removeTrackIds, target.id],
    addTracks: [...laid.addTracks.filter(tr => tr.id !== routeId), joined],
    addSwitches: [withPort(record, portKey, { trackId: target.id, endpoint: anchor.endpoint })],
    remap: laid.remap,
    restation: moved ? [{ trackId: target.id, shift: moved }] : [],
  }
}
