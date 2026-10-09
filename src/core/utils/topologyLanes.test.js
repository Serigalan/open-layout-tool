import { describe, it, expect } from 'vitest'
import { buildTopologyGraph, topologyClusters } from './topologyGraph'
import { layoutClusterLanes } from './topologyLanes'
import { newSwitchFields } from './switchModel'
import { endPointStraightUtm } from './elementUtils'
import { utmToWgs84 } from './coordinateUtils'
import { hydrateProjects } from './persistenceUtils'
import { hasPekBestand, loadPekBestand } from '../test/pekFixture'

/**
 * The topology diagram by lines (AP 9.8): every line through the network on a
 * row of its own, crossovers short diagonals between the rows.
 */

const UTM = 25832
const E0 = 500000, N0 = 5600000

/** A straight track from one point to another, in metres east and north of (E0, N0). */
function segment(id, [e1, n1], [e2, n2]) {
  const start = { easting: E0 + e1, northing: N0 + n1, zone: UTM }
  const bearing = Math.atan2(e2 - e1, n2 - n1) * 180 / Math.PI
  const length = Math.hypot(e2 - e1, n2 - n1)
  const end = endPointStraightUtm(start, bearing, length)
  return {
    id, name: id, epsg: UTM,
    elements: [{
      elementType: 0, length, bearing, endBearing: bearing,
      startNode: [start.easting, start.northing],
      endNode: [end.easting, end.northing],
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

const layoutOf = (tracks, switches) => {
  const graph = buildTopologyGraph(tracks, switches, [])
  const [cluster] = topologyClusters(graph).clusters
  const switchNode = (name) => [...graph.nodes.values()].find(n => n.name === name).id
  return { cluster, switchNode, ...layoutClusterLanes(cluster) }
}

// Two tracks side by side, the second `off` metres north of the first (south
// where negative), with a crossover from the first to the second (W1 → W2)
// and one back (W3 → W4).
function doubleTrack(off) {
  const tracks = [
    segment('t1a', [-300, 0], [300, 0]), segment('t1b', [300, 0], [800, 0]), segment('t1c', [800, 0], [1000, 0]),
    segment('t2a', [0, off], [400, off]), segment('t2b', [400, off], [700, off]), segment('t2c', [700, off], [1000, off]),
    segment('x1', [300, 0], [400, off]), segment('x2', [700, off], [800, 0]),
  ]
  const switches = [
    turnout('W1', ['t1a', 'END'], ['x1', 'BEGIN'], ['t1b', 'BEGIN']),
    turnout('W2', ['t2b', 'BEGIN'], ['x1', 'END'], ['t2a', 'END']),
    turnout('W3', ['t2b', 'END'], ['x2', 'BEGIN'], ['t2c', 'BEGIN']),
    turnout('W4', ['t1c', 'BEGIN'], ['x2', 'END'], ['t1b', 'END']),
  ]
  return layoutOf(tracks, switches)
}

describe('the topology diagram by lines', () => {
  for (const [off, row] of [[-4.5, -1], [4.5, 1]]) {
    it(`lays a second track ${off < 0 ? 'south' : 'north'} of the first on the row ${off < 0 ? 'below' : 'above'}, crossovers between`, () => {
      const { cluster, switchNode, pos, routes } = doubleTrack(off)
      const edge = Object.fromEntries(cluster.edges.map(e => [e.trackId, e]))
      // The longer track is the main row, the other one beside it.
      for (const id of ['t1a', 't1b', 't1c']) expect(routes.get(id).every(p => p.y === 0)).toBe(true)
      for (const id of ['t2a', 't2b', 't2c']) expect(routes.get(id).every(p => p.y === row)).toBe(true)
      // A crossover: one short diagonal from its switch to the other.
      for (const id of ['x1', 'x2']) {
        const route = routes.get(id)
        expect(route).toHaveLength(2)
        expect(Math.abs(route[1].x - route[0].x)).toBe(2)
        expect(route).toEqual(expect.arrayContaining([pos.get(edge[id].from), pos.get(edge[id].to)]))
      }
      // In the order they come along the line.
      const xs = ['W1', 'W2', 'W3', 'W4'].map(name => pos.get(switchNode(name)).x)
      expect([...xs].sort((a, b) => a - b)).toEqual(xs)
      expect(new Set(xs).size).toBe(4)
    })
  }

  it('lays a siding that leaves the line and joins it again beside it', () => {
    // A passing loop: W1 parts it from the line, W2 joins them again.
    const tracks = [
      segment('a', [0, 0], [200, 0]), segment('main', [200, 0], [500, 0]), segment('b', [500, 0], [700, 0]),
      segment('side', [200, 0], [500, -5]),
    ]
    const switches = [
      turnout('W1', ['a', 'END'], ['side', 'BEGIN'], ['main', 'BEGIN']),
      turnout('W2', ['b', 'BEGIN'], ['side', 'END'], ['main', 'END']),
    ]
    const { switchNode, pos, routes, labels } = layoutOf(tracks, switches)
    for (const id of ['a', 'main', 'b']) expect(routes.get(id).every(p => p.y === 0)).toBe(true)
    const side = routes.get('side')
    expect(side[0]).toEqual(pos.get(switchNode('W1')))
    expect(side.at(-1)).toEqual(pos.get(switchNode('W2')))
    // Out to the row below — it lies south — and back.
    expect(side.slice(1, -1).every(p => p.y === -1)).toBe(true)
    expect(labels.get('side').y).toBe(-1)
  })
})

describe.skipIf(!hasPekBestand)('the Bestand of Halle–Könnern', () => {
  it('draws every crossover short and every network on a few rows', () => {
    const [project] = hydrateProjects([loadPekBestand()])
    const { clusters } = topologyClusters(buildTopologyGraph(project.tracks, project.switches, []))
    expect(clusters).toHaveLength(2)
    for (const cluster of clusters) {
      const { pos, routes } = layoutClusterLanes(cluster)
      const ys = [...pos.values()].map(p => p.y)
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(8)
      const spots = [...pos.values()].map(p => `${p.x},${p.y}`)
      expect(new Set(spots).size).toBe(spots.length)
      for (const e of cluster.edges) {
        const route = routes.get(e.trackId)
        if (!route) continue
        expect([route[0], route.at(-1)]).toEqual(expect.arrayContaining([pos.get(e.from), pos.get(e.to)]))
        // Before AP 9.8 the crossovers ran across up to 95 columns.
        if (/W$/.test(e.name ?? '')) {
          expect(Math.abs(route.at(-1).x - route[0].x)).toBeLessThanOrEqual(3)
          expect(Math.abs(route.at(-1).y - route[0].y)).toBeLessThanOrEqual(2)
        }
      }
    }
  })
})
