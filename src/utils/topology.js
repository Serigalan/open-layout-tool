import { utmToWgs84, crsName } from './coordinateUtils'
import { portsOf, isLinkSwitch } from './switchModel'
import { trackEndAt } from './trackLinkUtils'
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
 *   open         connected to nothing
 *
 * An end is connected or it is free, with nothing in between (ROADMAP
 * decision 86): one that merely comes close to a switch or to another end is
 * open, and so is one of three ends on one node without a switch, or one in
 * another plane without a link. Open ends are what the topology view draws
 * red (decision 80).
 */

/** Two ends in one plane closer than this [m] are one node. */
const JOINT_EXACT = 0.01

const OPEN_STATES = ['open']
export const isOpenState = (state) => OPEN_STATES.includes(state)

// Ends are hashed into cells of about a metre and a half, so a project of a
// thousand tracks compares each end with a handful of others rather than with
// every one.
const CELL = 2e-5     // degrees — about 1.4 m of latitude, 0.9 m of longitude at 50°N
const cellKey = (x, y) => `${x}|${y}`

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

  // The other ends an undecided end could meet.
  const cells = new Map()
  for (const end of ends) {
    end.cx = Math.round(end.lngLat[0] / CELL)
    end.cy = Math.round(end.lngLat[1] / CELL)
    const key = cellKey(end.cx, end.cy)
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push(end)
  }
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
    // Joined when exactly one other end lies on its node, free, in its plane.
    // An end on a switch's port end without being in the port is not joined
    // to it, and it spoils a joint the way a third end does.
    let partners = 0
    let crowded = false
    for (const other of around(end)) {
      if (other.trackId === end.trackId || other.epsg !== end.epsg) continue
      if (Math.hypot(end.easting - other.easting, end.northing - other.northing) > JOINT_EXACT) continue
      if (portHeld.has(endKey(other.trackId, other.endpoint))) crowded = true
      else partners += 1
    }
    end.state = partners === 1 && !crowded ? 'joint' : 'open'
  }

  return ends.map(({ cx: _x, cy: _y, ...end }) => end)
}

/** The ends a buffer stop or a boundary may be put on: the open ones. */
export const freeEnds = (ends) => ends.filter(e => isOpenState(e.state))
