import { describe, it, expect } from 'vitest'
import {
  buildTopologyGraph, topologyClusters, selectionHighlight, switchTrackIds, TOPOLOGY_TRACK_COLORS,
} from './topologyGraph'
import { newBufferStop } from './trackEndMarks'
import { newSwitchFields } from './switchModel'
import { endPointStraightUtm } from './elementUtils'
import { utmToWgs84 } from './coordinateUtils'

/**
 * The diagram of the topological connections (AP 9.6): the graph the tracks
 * make, its clusters, and a layout that keeps them apart.
 */

const UTM = 25832
const E0 = 500000, N0 = 5600000

function straight(id, easting, northing, bearing, length) {
  const start = { easting, northing, zone: UTM }
  const end   = endPointStraightUtm(start, bearing, length)
  return {
    id, name: id, epsg: UTM,
    elements: [{
      elementType: 0, length, bearing, endBearing: bearing,
      startNode: [start.easting, start.northing],
      endNode:   [end.easting, end.northing],
      geometry: { type: 'LineString', coordinates: [
        utmToWgs84(start.easting, start.northing, UTM),
        utmToWgs84(end.easting, end.northing, UTM),
      ] },
    }],
  }
}

const turnout = (name, a, b1, b2) => ({
  ...newSwitchFields(), name,
  portA_trackId: a[0], portA_endpoint: a[1],
  portB1_trackId: b1[0], portB1_endpoint: b1[1],
  portB2_trackId: b2[0], portB2_endpoint: b2[1],
})

// A loop through a station: W1 parts into a main track and a siding, W2 joins
// them again. A joint on the way out, a buffer stop at the far end, and one
// track far off that is connected to nothing.
function station() {
  const a  = straight('a', E0, N0, 90, 200)
  const [e1, n1] = a.elements[0].endNode
  const main = straight('main', e1, n1, 90, 300)
  const side = { ...straight('side', e1, n1, 90, 300), name: 'side' }
  const [e2, n2] = main.elements[0].endNode
  // The siding is the same geometry here — what matters is where it ends.
  const b  = straight('b', e2, n2, 90, 150)
  const [e3, n3] = b.elements[0].endNode
  const c  = straight('c', e3, n3, 90, 100)
  const far = straight('far', E0, N0 + 5000, 90, 80)
  const w1 = turnout('W1', ['a', 'END'], ['side', 'BEGIN'], ['main', 'BEGIN'])
  const w2 = turnout('W2', ['b', 'BEGIN'], ['side', 'END'], ['main', 'END'])
  return { tracks: [a, main, side, b, c, far], switches: [w1, w2], marks: [newBufferStop('c', 'END', 4)] }
}

describe('the topology graph', () => {
  it('has a node per switch, per joint and per free end, and a track per edge', () => {
    const { tracks, switches, marks } = station()
    const { nodes, edges } = buildTopologyGraph(tracks, switches, marks)
    const kinds = [...nodes.values()].map(n => n.kind).sort()
    // W1, W2; the joint b|c; free ends a|BEGIN, c|END (buffer stop), far × 2.
    expect(kinds).toEqual(['end', 'end', 'end', 'end', 'joint', 'switch', 'switch'])
    expect(edges).toHaveLength(6)
    const byTrack = Object.fromEntries(edges.map(e => [e.trackId, e]))
    expect(byTrack.main.from).toBe(byTrack.side.from)   // both leave W1
    expect(byTrack.b.to).toBe(byTrack.c.from)           // the joint
    expect(nodes.get(byTrack.c.to).state).toBe('buffer_stop')
  })

  it('falls into one network and the track connected to nothing', () => {
    const { tracks, switches, marks } = station()
    const { clusters, loose } = topologyClusters(buildTopologyGraph(tracks, switches, marks))
    expect(clusters).toHaveLength(1)
    expect(clusters[0].edges.map(e => e.trackId).sort()).toEqual(['a', 'b', 'c', 'main', 'side'])
    expect(loose.map(e => e.trackId)).toEqual(['far'])
  })

  it('names the tracks a switch connects', () => {
    const { switches } = station()
    expect(switchTrackIds(switches[0])).toEqual(['a', 'side', 'main'])
  })

  it('highlights a switch with its tracks, each in its own colour, and a track with its switches', () => {
    const { switches } = station()
    const [w1, w2] = switches
    const bySwitch = selectionHighlight({ kind: 'switch', id: w1.switchId }, switches)
    expect(bySwitch.trackIds).toEqual(['a', 'side', 'main'])
    expect(bySwitch.switchIds).toEqual([w1.switchId])
    expect(Object.keys(bySwitch.colors)).toEqual(['a', 'side', 'main'])
    expect(new Set(Object.values(bySwitch.colors)).size).toBe(3)
    expect(Object.values(bySwitch.colors).every(c => TOPOLOGY_TRACK_COLORS.includes(c))).toBe(true)
    const byTrack = selectionHighlight({ kind: 'track', id: 'main' }, switches)
    expect(byTrack.trackIds).toEqual(['main'])
    expect(byTrack.switchIds).toEqual([w1.switchId, w2.switchId])
    expect(byTrack.colors).toEqual({ main: TOPOLOGY_TRACK_COLORS[0] })
    expect(selectionHighlight({ kind: 'track', id: 'c' }, switches).switchIds).toEqual([])
    expect(selectionHighlight(null, switches)).toEqual({ trackIds: [], switchIds: [], colors: {} })
  })
})
