import { buildSwitchOnTrack, switchOnTrackPlacement, switchOnTrackRemnant, switchOnTrackRouteEnd } from './switches'
import { connectionRoots, fitConnectingElement, joinRouteIntoTrack, refitTrackEnd } from '../connectToTrack'
import { switchStraightLength, switchBranchLength } from '../switch/catalogue'
import { switchRoutePointUtm } from '../switch/route'
import { elementAtStation, trackLength } from '../heightUtils'
import { reverseElement } from '../elementUtils'
import { checkTrack } from '../trassierungCheck'
import { severityRank } from '../regelkatalog'

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
function hostPointAt(track, station, ahead = 0) {
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
 * Returns { solutions: [{ reversed, side, x, fit, at }], preferred } — the
 * preferred one on the side the connected track lies on, where there is one.
 */
export function switchConnectSolutions({ track, clickStation, anchor, sw }) {
  const total = trackLength(track)
  const near = clickStation
  const clickUtm = hostPointAt(track, near) ?? anchor.fixedUtm
  const reach = 2 * Math.hypot(clickUtm.easting - anchor.fixedUtm.easting, clickUtm.northing - anchor.fixedUtm.northing)
    + 2 * switchBranchLength(sw) + anchor.oldLength + 100
  const from = Math.max(0, near - reach), to = Math.min(total, near + reach)
  const solutions = []
  for (const reversed of [false, true]) {
    for (const side of ['left', 'right']) {
      const args = { track, reversed, sw, side }
      for (const root of connectionRoots(anchor, x => routeEndAt(args, x), { from, to, step: SCAN_STEP, near })) {
        // Found on the route's end alone; the commit builds from the whole
        // placement, and the element is refitted to the port that one gives.
        const at = routeEndAt(args, root.x, true)
        const fit = at && fitConnectingElement(anchor, at.port, at.bearingIn)
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
export function refitCheckChain(refitted, anchor) {
  const els = refitted.elements
  if (anchor.endpoint === 'END') return els.slice(Math.max(0, anchor.elIdx - 1), anchor.elIdx + 1)
  return els.slice(0, 2).reverse().map(reverseElement)
}

/** Does the catalogue find an error on the refitted element or its joint (Entscheidung 304)? */
export function refitRuleError(chain) {
  const own = checkTrack(chain).perElement[chain.length - 1]
  return severityRank(own?.severity) >= severityRank('error')
}

/**
 * What the solution means for the tracks before anything is written: the
 * connected track refitted, the remnants at the toe (Entscheidungen 219, 301)
 * and the chain the rules judge.
 */
export function switchConnectOutcome({ track, target, anchor, solution, speed }) {
  const refitted = refitTrackEnd(target, anchor, solution.fit, solution.at.port)
  const chain = refitCheckChain(refitted, anchor)
  return {
    refitted,
    element: refitted.elements[anchor.elIdx],
    chain,
    ruleError: refitRuleError(chain),
    remnant: switchOnTrackRemnant(track, solution.x, solution.reversed, speed),
  }
}

/**
 * The commit: the turnout laid into the host as "Weiche auf Gleis" lays it,
 * its new route joined into the refitted track instead of becoming a track of
 * its own (Entscheidung 303) — the argument for commitSwitchConnection, or
 * { noRoom } as buildSwitchOnTrack gives it.
 */
export function buildSwitchConnect({
  track, target, anchor, solution, tracks, sw, cant, cantReason, speed, switchName, switchNumber,
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
  const refitted = refitTrackEnd(target, anchor, solution.fit, solution.at.port)
  const { track: joined, shift } = joinRouteIntoTrack(refitted, anchor, route)
  // At the track's start its old stations move by the route and by the change
  // of length of the refitted element.
  const moved = shift ? shift + refitted.elements[anchor.elIdx].length - anchor.oldLength : 0
  const portKey = ['B1', 'B2'].find(p => record[`port${p}_trackId`] === routeId)
  return {
    removeTrackIds: [...laid.removeTrackIds, target.id],
    addTracks: [...laid.addTracks.filter(tr => tr.id !== routeId), joined],
    addSwitches: [{ ...record, [`port${portKey}_trackId`]: target.id, [`port${portKey}_endpoint`]: anchor.endpoint }],
    remap: laid.remap,
    restation: moved ? [{ trackId: target.id, shift: moved }] : [],
  }
}
