import { utmToWgs84, crsName } from './coordinateUtils'
import { portsOf, isLinkSwitch } from './switchModel'
import { trackEndAt, JOINT_TOL } from './trackLinkUtils'
import { endKey, BUFFER_STOP, BOUNDARY } from './trackEndMarks'

/**
 * The topology of a project: which track ends are connected to what, and which
 * are open.
 *
 * Every end is in one of these states:
 *
 *   switch       held by a port of a switch or crossing
 *   link         held by a port of a link (a change of coordinate system)
 *   joint        meets exactly one other free end on the same node, in the
 *                same plane — two tracks laid end to end
 *   buffer_stop  carries a buffer stop
 *   boundary     marked as the boundary of the planning area
 *   near         open, but within JOINT_TOL of a switch or another end — it
 *                looks connected on the map and is not
 *   open         nothing at all
 *
 * The last two are what the topology view draws red (ROADMAP decision 80).
 * `near` is the more telling of the two: an end at a switch that is not in its
 * port, three ends on one node without a switch, two ends in different planes
 * without a link.
 */

/** Two ends in one plane closer than this [m] are one node. */
export const JOINT_EXACT = 0.01

export const OPEN_STATES = ['open', 'near']
export const isOpenState = (state) => OPEN_STATES.includes(state)

// Ends and switch nodes are hashed into cells of about a metre and a half, so
// a project of a thousand tracks compares each end with a handful of others
// rather than with every one.
const CELL = 2e-5     // degrees — about 1.4 m of latitude, 0.9 m of longitude at 50°N
const cellKey = (x, y) => `${x}|${y}`

/** Metres between two WGS84 points, flat-earth — good for the metre or so it is asked about. */
function metresApart([lng1, lat1], [lng2, lat2]) {
  const k = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180)
  return Math.hypot((lng2 - lng1) * 111320 * k, (lat2 - lat1) * 110574)
}

/** Distance of two ends: exact in a shared plane, flat-earth across two. */
const endDistance = (a, b) => (a.epsg === b.epsg
  ? Math.hypot(a.easting - b.easting, a.northing - b.northing)
  : metresApart(a.lngLat, b.lngLat))

/**
 * Where each switch sits, as one point: the mean of the ends its ports hold. A
 * turnout's three ports meet at its toe, so that is where its node is; a
 * crossing's four ends lie around its centre.
 *
 * Returns [{ switchId, name, kind, link, lngLat }] for every switch with at
 * least one port on a track that exists.
 */
export function switchNodes(tracks, switches) {
  const byId = new Map((tracks ?? []).map(t => [t.id, t]))
  const nodes = []
  for (const sw of switches ?? []) {
    const points = []
    for (const { trackKey, endKey: ek } of portsOf(sw)) {
      const track = byId.get(sw[trackKey])
      const end = track && crsName(track.epsg) != null && trackEndAt(track, sw[ek])
      if (end) points.push(utmToWgs84(end.easting, end.northing, end.epsg))
    }
    if (!points.length) continue
    const lngLat = [
      points.reduce((s, p) => s + p[0], 0) / points.length,
      points.reduce((s, p) => s + p[1], 0) / points.length,
    ]
    nodes.push({ switchId: sw.switchId, name: sw.name ?? null, kind: sw.kind, link: isLinkSwitch(sw), lngLat })
  }
  return nodes
}

/**
 * Both ends of every track, each with its state (see above), its node in its
 * own plane and in WGS84, and the bearing pointing into the track:
 *
 *   { trackId, trackName, endpoint, epsg, easting, northing, lngLat, outward,
 *     state, markId? }
 *
 * A track whose plane this tool has no projection for is left out.
 */
export function classifyTrackEnds(tracks, switches, endMarks = []) {
  const portHeld = new Map()   // endKey → link?
  for (const sw of switches ?? []) {
    for (const { trackKey, endKey: ek } of portsOf(sw)) {
      if (sw[trackKey] && sw[ek]) portHeld.set(endKey(sw[trackKey], sw[ek]), isLinkSwitch(sw))
    }
  }
  const marks = new Map((endMarks ?? []).map(m => [endKey(m.trackId, m.endpoint), m]))

  const ends = []
  for (const track of tracks ?? []) {
    if (crsName(track?.epsg) == null) continue
    for (const endpoint of ['BEGIN', 'END']) {
      const end = trackEndAt(track, endpoint)
      if (!end) continue
      end.lngLat = utmToWgs84(end.easting, end.northing, end.epsg)
      const key = endKey(track.id, endpoint)
      const mark = marks.get(key)
      if (portHeld.has(key)) end.state = portHeld.get(key) ? 'link' : 'switch'
      else if (mark?.kind === BUFFER_STOP) { end.state = 'buffer_stop'; end.markId = mark.id }
      else if (mark?.kind === BOUNDARY)    { end.state = 'boundary'; end.markId = mark.id }
      else end.state = null   // decided below, from what lies around it
      ends.push(end)
    }
  }

  // Everything an undecided end could be meant to meet: every other end, and
  // every switch node.
  const cells = new Map()
  const put = (item) => {
    const x = Math.round(item.lngLat[0] / CELL), y = Math.round(item.lngLat[1] / CELL)
    item.cx = x; item.cy = y
    const key = cellKey(x, y)
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push(item)
  }
  ends.forEach(put)
  const nodes = switchNodes(tracks, switches).map(n => ({ ...n, isNode: true }))
  nodes.forEach(put)

  const around = (end) => {
    const found = []
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of cells.get(cellKey(end.cx + dx, end.cy + dy)) ?? []) {
          if (other !== end) found.push(other)
        }
      }
    }
    return found
  }

  for (const end of ends) {
    if (end.state) continue
    let exact = 0
    let near = false
    for (const other of around(end)) {
      if (other.isNode) {
        if (metresApart(end.lngLat, other.lngLat) <= JOINT_TOL) near = true
        continue
      }
      if (other.trackId === end.trackId) continue
      const d = endDistance(end, other)
      if (d > JOINT_TOL) continue
      // A plain joint is two free ends on one node in one plane; an end that
      // sits on a switch's port end without being in the port is not joined
      // to it, and neither is one in another plane without a link.
      if (d <= JOINT_EXACT && other.epsg === end.epsg && !portHeld.has(endKey(other.trackId, other.endpoint))) exact += 1
      else near = true
    }
    end.state = exact === 1 && !near ? 'joint' : (exact > 0 || near ? 'near' : 'open')
  }

  return ends.map(({ cx: _x, cy: _y, ...end }) => end)
}

/**
 * The ends a buffer stop or a boundary may be put on: open ones, near ones
 * included — being near something is not being connected to it.
 */
export const freeEnds = (ends) => ends.filter(e => isOpenState(e.state))
