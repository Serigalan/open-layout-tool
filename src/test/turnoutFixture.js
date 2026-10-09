/**
 * A turnout to test heights and sleepers on, with its geometry worked out
 * independently of the code under test.
 *
 * WA at (1000, 1000): the main route runs straight east, the branch leaves it
 * on R 500 to the left (north). WA–WE is 30 m on either track, and the form
 * TEST puts its ldS 10 m behind WE — 40 m from WA on the main route.
 */
import { endPointCurvedUtm, endPointStraightUtm } from '../utils/elementUtils'

export const R = 500
const START = { easting: 1000, northing: 1000, zone: 5684 }
const node = (p) => [p.easting, p.northing]
const WE = endPointStraightUtm(START, 90, 30)

export const mainTrack = (cant = 0, heights = null) => ({
  id: 'm', epsg: 5684, trackType: 1,
  elements: [
    { elementType: 0, startNode: node(START), endNode: node(WE),
      bearing: 90, length: 30, speed: 80, cant, switchId: 's1', switchRoute: 'main' },
    { elementType: 0, startNode: node(WE), endNode: node(endPointStraightUtm(WE, 90, 30)),
      bearing: 90, length: 30, speed: 80, cant },
  ],
  ...(heights ? { heights } : {}),
})

const branchEnd = endPointCurvedUtm(START, 90, 30, -R)
const turned = (L) => 90 - (L / R) * 180 / Math.PI
export const branchTrack = (heights = null) => ({
  id: 'b', epsg: 5684, trackType: 1,
  elements: [
    { elementType: 1, startNode: node(START), endNode: node(branchEnd), bearing: 90, endBearing: turned(30),
      radius: -R, length: 30, speed: 80, switchId: 's1', switchRoute: 'branch' },
    { elementType: 1, startNode: node(branchEnd), endNode: node(endPointCurvedUtm(branchEnd, turned(30), 30, -R)),
      bearing: turned(30), endBearing: turned(60), radius: -R, length: 30, speed: 80 },
  ],
  ...(heights ? { heights } : {}),
})

export const turnout = (over = {}) => ({
  switchId: 's1', kind: 'turnout', label: 'TEST',
  portA_trackId: 'a', portA_endpoint: 'END',
  portB1_trackId: 'b', portB1_endpoint: 'BEGIN',
  portB2_trackId: 'm', portB2_endpoint: 'BEGIN',
  ...over,
})

export const formOf = (label) => (label === 'TEST' ? { lds: 10 } : null)

// Seen from WA (x east, y north), the main axis is y = 0 and the branch the
// circle about (0, 500): the points as far from both lie on the parabola
// y = x² / 2000 — the bisector. A sleeper square to it at x crosses the main
// axis at x · (1 + x² / 2·10⁶) and the circle where solved in `sleeperAtX`.
const arc = (x) => (x / 2) * Math.sqrt(1 + (x / 1000) ** 2) + 500 * Math.asinh(x / 1000)
const bisect = (f, target, hi) => {
  let lo = 0
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(m) < target) lo = m; else hi = m }
  return (lo + hi) / 2
}
/** x of the bisector point a distance s along it from WA. */
export const xAtArc = (s) => bisect(arc, s, 2 * s + 1)
/** x of the bisector point whose sleeper crosses the main route m from WA. */
export const xAtMain = (m) => bisect(x => x * (1 + x * x / 2e6), m, m)

/**
 * The sleeper laid at bisector x: its distance from WA along the main route
 * (`main`) and along the branch (`branch`), and where it meets the branch
 * (`q` [x, y] from WA — y is how far the branch lies to the left).
 */
export function sleeperAtX(x) {
  const y = x * x / 2000
  const k = x / 1000, n = Math.hypot(1, k)
  const dir = [-k / n, 1 / n]
  // |M + t·dir − C| = R, C = (0, R): the root nearest to M.
  const mc = [x, y - R]
  const b = 2 * (mc[0] * dir[0] + mc[1] * dir[1]), c = mc[0] ** 2 + mc[1] ** 2 - R * R
  const t = (-b - Math.sqrt(b * b - 4 * c)) / 2
  const q = [x + t * dir[0], y + t * dir[1]]
  return { main: x * (1 + x * x / 2e6), branch: R * Math.atan2(q[0], R - q[1]), q }
}

/** The ldS sleeper of the TEST form: through the main route 40 m from WA. */
export const LDS = sleeperAtX(xAtMain(40))
