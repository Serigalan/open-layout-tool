import {
  transformPlanePoint, transformGridBearing, utmToWgs84, crsName,
} from './coordinateUtils'
import { resolveEndBearing } from './elementUtils'
import { portsOf, newSwitchFields, LINK_KIND } from './switchModel'

/**
 * Links — the node where one track ends and the next begins.
 *
 * A track carries one projected plane (`track.epsg`) and a line does not stop
 * where the plane does. Where the survey changes coordinate system the chain
 * has to be cut: the elements of one system cannot be stationed in the other's
 * grid, because a bearing is grid-relative and a node is a pair of grid
 * coordinates (ROADMAP decision 30, and why the MDB import builds one chain per
 * Lagesystem). The two chains are still one line. What joins them can only be a
 * node, never a stretch of track — a stretch would have to lie in one of the
 * two planes, and there is no reason it should be one rather than the other.
 *
 * That node is a switch record of kind `link` (switchModel): two ports, no
 * routes, no elements, no form. OSRD has the same object and calls it `link`,
 * which is what the export writes.
 *
 * **Finding them.** The two chains end at the same surveyed point, stated twice
 * — once in each system. Transformed into one plane the two statements do not
 * land on top of each other: they differ by whatever the transformation between
 * the two frames gets wrong. Measured over the 115 boundary points of the test
 * database (DHDN `EA0` against DB_REF `ER0`), that is 7 mm to 13 cm with the
 * BeTA2007 grid loaded, and 0.79 m to 1.04 m when the grid is missing and DHDN
 * falls back on its 7-parameter Helmert (see coordinateUtils). JOINT_TOL is set
 * above the second of those: a joint the app cannot find is worse than one it
 * offers and the user rejects, and the list says how far apart each pair is.
 *
 * Distance alone would also pair two ends that merely pass close by, so the
 * tangents have to agree as well: a line runs through the node, so the two
 * tracks leave it in opposite directions.
 */

/** Two track ends are the same node below this [m] — see the note above. */
export const JOINT_TOL = 1.5

/** …and only when the line runs through: their tangents oppose within this [°]. */
export const BEARING_TOL = 2

/** Half-diagonal of the diamond a link is drawn as [m]. */
const LINK_BODY_HALF = 2

const bearingDelta = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

/**
 * One end of a track: the node it sits on, and the bearing pointing from that
 * node **into** the track. Both ends are described the same way, which is what
 * makes the test for a through line one comparison rather than four cases: the
 * line runs through where the two outward bearings oppose each other.
 *
 * Returns null for a track with no usable elements at that end.
 */
export function trackEndAt(track, endpoint) {
  const els = track?.elements ?? []
  if (!els.length) return null
  const el = endpoint === 'END' ? els[els.length - 1] : els[0]
  const node = endpoint === 'END' ? el?.endNode : el?.startNode
  if (!node) return null
  const outward = endpoint === 'END'
    ? (resolveEndBearing(el, track.epsg) + 180) % 360
    : (el.bearing ?? 0)
  return {
    trackId: track.id, trackName: track.name ?? null, endpoint,
    epsg: Number(track.epsg), easting: node[0], northing: node[1], outward,
  }
}

/**
 * Both ends of every track, as trackEndAt describes them. A track whose plane
 * this tool has no projection for is left out rather than thrown over: the scan
 * runs over a whole project, and one unreadable track is not a reason for the
 * other thousand to go unexamined.
 */
const allTrackEnds = (tracks) => (tracks ?? [])
  .filter(track => crsName(track?.epsg) != null)
  .flatMap(track => ['BEGIN', 'END'].map(end => trackEndAt(track, end)))
  .filter(Boolean)

/** The `trackId|endpoint` keys already claimed by a port of some switch. */
export function claimedEnds(switches) {
  const claimed = new Set()
  for (const sw of switches ?? []) {
    for (const { trackKey, endKey } of portsOf(sw)) {
      if (sw[trackKey] && sw[endKey]) claimed.add(`${sw[trackKey]}|${sw[endKey]}`)
    }
  }
  return claimed
}

/**
 * How far apart two ends are [m], measured in the first one's plane, and by how
 * much their tangents miss running through [°]. Both planes are named by their
 * EPSG code, so the move between them is the one coordinateUtils makes and no
 * zone is guessed; a bearing does not survive that move on its own, which is
 * why it is carried over rather than compared as stated.
 */
export function jointFit(a, b) {
  const [be, bn] = transformPlanePoint(b.easting, b.northing, b.epsg, a.epsg)
  const bOutward = transformGridBearing(b.easting, b.northing, b.outward, b.epsg, a.epsg)
  return {
    gap: Math.hypot(be - a.easting, bn - a.northing),
    // Through means opposed: one track leaves the node the way the other came.
    bearingOff: Math.abs(bearingDelta(a.outward, bOutward) - 180),
  }
}

// Ends are grouped into cells of about a metre before they are compared: the
// database this was written for holds 1 184 tracks, so 2 368 ends, and every
// comparison costs two coordinate transformations. A cell and its eight
// neighbours cover everything within JOINT_TOL of a point in it.
const CELL = 2e-5     // degrees — about 1.4 m of latitude, 0.9 m of longitude at 50°N
const cellKey = (x, y) => `${x}|${y}`

/**
 * Every place where exactly two track ends meet — the joints a link belongs at.
 *
 * Ends already claimed by a switch port are left out: what meets there meets
 * through that switch. So is a meeting of three or more ends, which is a
 * junction and wants a turnout, not a link — the count is reported so the
 * caller can say the app found one and left it alone.
 *
 * Each joint is
 *   { a, b, gap, bearingOff, crsChange }
 * with `a` and `b` the two ends (trackEndAt), `gap` how far apart the two
 * statements of the node are [m], `bearingOff` how far the line is from running
 * straight through [°], and `crsChange` whether the two lie in different planes
 * — the case that has no alternative, because joining the tracks is not one.
 * Joints come sorted with the plane changes first and the closest pair first.
 */
export function findTrackJoints(tracks, switches, { tol = JOINT_TOL, bearingTol = BEARING_TOL } = {}) {
  const claimed = claimedEnds(switches)
  const ends = allTrackEnds(tracks).filter(e => !claimed.has(`${e.trackId}|${e.endpoint}`))

  const cells = new Map()
  for (const end of ends) {
    const [lng, lat] = utmToWgs84(end.easting, end.northing, end.epsg)
    end.cx = Math.round(lng / CELL)
    end.cy = Math.round(lat / CELL)
    const key = cellKey(end.cx, end.cy)
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push(end)
  }

  // Which ends meet which. A group of three or more is a junction rather than a
  // joint, so the matches are collected first and only then counted — a pair
  // that looked like a joint on its own is not one once a third end turns up on
  // the same node.
  const meets = new Map(ends.map(end => [end, new Set()]))
  for (const end of ends) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of cells.get(cellKey(end.cx + dx, end.cy + dy)) ?? []) {
          // Each unordered pair once, and never a track against itself: a track
          // whose two ends meet is a closed loop, which is not a joint.
          if (other === end || other.trackId === end.trackId) continue
          if (`${other.trackId}|${other.endpoint}` <= `${end.trackId}|${end.endpoint}`) continue
          const fit = jointFit(end, other)
          if (fit.gap > tol || fit.bearingOff > bearingTol) continue
          meets.get(end).add(other)
          meets.get(other).add(end)
        }
      }
    }
  }

  const joints = []
  const seen = new Set()
  let fanned = 0
  for (const end of ends) {
    if (seen.has(end) || meets.get(end).size === 0) continue
    // Everything that meets this end, and everything that meets those.
    const group = new Set([end])
    const queue = [end]
    while (queue.length) {
      for (const other of meets.get(queue.shift())) {
        if (group.has(other)) continue
        group.add(other)
        queue.push(other)
      }
    }
    for (const member of group) seen.add(member)
    if (group.size !== 2) { fanned += 1; continue }
    const [a, b] = [...group]
    joints.push({
      a: withoutCell(a), b: withoutCell(b),
      ...jointFit(a, b),
      crsChange: a.epsg !== b.epsg,
    })
  }

  joints.sort((x, y) => (Number(y.crsChange) - Number(x.crsChange)) || (x.gap - y.gap))
  return { joints, fanned }
}

const withoutCell = ({ cx: _x, cy: _y, fit: _f, ...end }) => end

/**
 * The record for a joint. It carries its two ports and its name and nothing
 * else — no geometry: the symbol is derived from the tracks (linkSymbol), the
 * way every switch's is, so it can never disagree with them.
 */
export function linkRecord(joint, name) {
  return {
    ...newSwitchFields(LINK_KIND),
    ...(name ? { name } : {}),
    portA_trackId: joint.a.trackId, portA_endpoint: joint.a.endpoint,
    portB_trackId: joint.b.trackId, portB_endpoint: joint.b.endpoint,
  }
}

/**
 * How a link is drawn: a small diamond on the node, one diagonal along the
 * line and one across it. It is a symbol, not an extent — a link has none —
 * and it is there so the node can be seen and picked at all: a link marks no
 * element, so without a body of its own nothing on the map would answer for it.
 *
 * Drawn in port A's plane, which is the one the record's first end lies in.
 * Returns the record with `fillCoords` and `bodyCentre` set, or without them
 * where the ports name no track that has elements.
 */
export function linkSymbol(sw, trackById) {
  const track = trackById?.[sw?.portA_trackId]
  const end   = track ? trackEndAt(track, sw.portA_endpoint) : null
  if (!end) return sw
  const rad = end.outward * Math.PI / 180
  const along = [Math.sin(rad), Math.cos(rad)]
  const across = [along[1], -along[0]]
  const corner = ([de, dn], sign) => utmToWgs84(
    end.easting + sign * LINK_BODY_HALF * de,
    end.northing + sign * LINK_BODY_HALF * dn,
    end.epsg)
  const ring = [
    corner(along, 1), corner(across, 1), corner(along, -1), corner(across, -1),
  ]
  return {
    ...sw,
    fillCoords: [...ring, ring[0]],
    bodyCentre: utmToWgs84(end.easting, end.northing, end.epsg),
  }
}
