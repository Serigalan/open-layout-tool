// The network the schematic tests draw: two tracks, a crossover, a siding.
import { endPointStraightUtm } from '../utils/elementUtils'
import { utmToWgs84 } from '../utils/coordinateUtils'

const EPSG = 25832
const E0 = 500000, N0 = 5600000

/** A straight track from (x, y) metres off the origin, heading `bearing`. */
export function straight(id, x, y, bearing, length) {
  const start = { easting: E0 + x, northing: N0 + y, zone: EPSG }
  const end = endPointStraightUtm(start, bearing, length)
  return {
    id, name: id, epsg: EPSG,
    elements: [{
      elementType: 0, length, bearing, endBearing: bearing, absLength: length,
      startNode: [start.easting, start.northing],
      endNode: [end.easting, end.northing],
      geometry: { type: 'LineString', coordinates: [
        utmToWgs84(start.easting, start.northing, EPSG), utmToWgs84(end.easting, end.northing, EPSG),
      ] },
    }],
  }
}

const turnout = (name, a, b1, b2) => ({
  switchId: name, kind: 'turnout', formVersion: 1, name,
  portA_trackId: a[0], portA_endpoint: a[1],
  portB1_trackId: b1[0], portB1_endpoint: b1[1],
  portB2_trackId: b2[0], portB2_endpoint: b2[1],
})

// Two tracks running east 4.5 m apart, a crossover between them near the
// west end, and a siding leaving track 2 to the north.
const bearingTo = (dx, dy) => Math.atan2(dx, dy) * 180 / Math.PI
export const tracks = [
  straight('1a', 0, 0, 90, 400),
  straight('1b', 400, 0, 90, 1600),
  straight('2a', 0, 4.5, 90, 460),
  straight('2b', 460, 4.5, 90, 740),
  straight('2c', 1200, 4.5, 90, 700),
  straight('X', 400, 0, bearingTo(60, 4.5), Math.hypot(60, 4.5)),
  straight('S', 1200, 4.5, bearingTo(600, 4.5), Math.hypot(600, 4.5)),
]
export const switches = [
  turnout('W1', ['1a', 'END'], ['X', 'BEGIN'], ['1b', 'BEGIN']),
  turnout('W2', ['2b', 'BEGIN'], ['X', 'END'], ['2a', 'END']),
  turnout('W3', ['2b', 'END'], ['S', 'BEGIN'], ['2c', 'BEGIN']),
]
/** A switch's triangle, told from the arrow beside its number by its size. */
export const isWedge = (i) => i.type === 'path' && i.fill && i.d.length === 4 && Math.abs(i.d[1][1] - i.d[0][1]) > 2

export const platforms = [{
  id: 'p1', trackId: '1b', startStation: 400, endStation: 600, side: 'right',
  stationName: 'Musterstadt', code: 'MS',
}]

