import { describe, it, expect } from 'vitest'
import { endPointStraightUtm } from './elementUtils'
import { utmToWgs84 } from './coordinateUtils'
import { schematicLayout, schematicNetwork } from './planSchematic'
import { buildSchematicPlan } from './planSchematicPlan'

const EPSG = 25832
const E0 = 500000, N0 = 5600000

/** A straight track from (x, y) metres off the origin, heading `bearing`. */
function straight(id, x, y, bearing, length) {
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
const tracks = [
  straight('1a', 0, 0, 90, 400),
  straight('1b', 400, 0, 90, 1600),
  straight('2a', 0, 4.5, 90, 460),
  straight('2b', 460, 4.5, 90, 740),
  straight('2c', 1200, 4.5, 90, 700),
  straight('X', 400, 0, bearingTo(60, 4.5), Math.hypot(60, 4.5)),
  straight('S', 1200, 4.5, bearingTo(600, 4.5), Math.hypot(600, 4.5)),
]
const switches = [
  turnout('W1', ['1a', 'END'], ['X', 'BEGIN'], ['1b', 'BEGIN']),
  turnout('W2', ['2b', 'BEGIN'], ['X', 'END'], ['2a', 'END']),
  turnout('W3', ['2b', 'END'], ['S', 'BEGIN'], ['2c', 'BEGIN']),
]
const platforms = [{
  id: 'p1', trackId: '1b', startStation: 400, endStation: 600, side: 'right',
  stationName: 'Musterstadt', code: 'MS',
}]

describe('schematic network', () => {
  it('joins the tracks through the turnouts into strands', () => {
    const { strands } = schematicNetwork(tracks, switches)
    const names = strands.map(st => st.parts.map(p => p.track.id).join('+')).sort()
    expect(names).toEqual(['1a+1b', '2a+2b+2c', 'S', 'X'])
  })
})

describe('schematic layout', () => {
  const layout = schematicLayout({ tracks, switches, platforms })
  const strand = (id) => layout.strands.find(st => st.parts.some(p => p.track.id === id))

  it('lays the longest strand on lane 0 and the others outwards by side', () => {
    expect(layout.ref).toBe(strand('1a'))
    expect(strand('1a').lane).toBe(0)
    expect(strand('2a').lane).toBe(1)
    expect(strand('S').lane).toBe(2)
  })

  it('draws the crossover as a connection, not a lane', () => {
    expect(strand('X').connector).toBe(true)
    expect(strand('X').lane).toBeUndefined()
  })

  it('puts a switch where it is along the line', () => {
    const w1 = layout.nodes.find(n => n.sw.name === 'W1')
    expect(w1.x).toBeCloseTo(400, 0)
    expect(w1.lane).toBe(0)
  })

  it('places a platform on the side it stands on', () => {
    const [pf] = layout.platforms
    expect(pf.x0).toBeCloseTo(800, 0)
    expect(pf.x1).toBeCloseTo(1000, 0)
    expect(pf.up).toBe(false)
  })

  it('falls back to the chainage along the reference without a kilometrage line', () => {
    expect(layout.kmTable[0].km).toBeCloseTo(layout.kmTable[0].x)
  })

  it('leaves out what lies beyond the corridor', () => {
    const far = [...tracks, straight('F', 0, 900, 90, 1500)]
    const narrow = schematicLayout({ tracks: far, switches, corridor: 100 })
    const f = narrow.strands.find(st => st.parts[0].track.id === 'F')
    expect(f.outside).toBe(true)
    expect(f.lane).toBeUndefined()
  })
})

describe('schematic plan', () => {
  const plan = buildSchematicPlan({
    tracks, switches, platforms, paperKey: '297x840', scaleDen: 10000,
    titleBlock: { title: 'Test', rows: [['1:10 000', 'Blatt {i} / {n}']], legend: 'Legende' },
  })
  const items = plan.sheets[0].items
  const inner = items.find(i => i.type === 'group').items
  const texts = inner.filter(i => i.type === 'text').map(i => i.parts[0].t)

  it('fits the 2 km strip on one sheet at 1:10 000', () => {
    expect(plan.sheets).toHaveLength(1)
    expect(plan.fits).toBe(true)
  })

  it('names the station, the switches and the kilometres', () => {
    expect(texts).toEqual(expect.arrayContaining(['Musterstadt', 'MS', 'W1', 'W3', 'km 1,0']))
  })

  it('draws the siding and the crossover at 45°', () => {
    const diagonals = inner.filter(i => i.type === 'path' && i.d.length === 2
      && Math.abs(i.d[1][2] - i.d[0][2]) > 0.1 && Math.abs(i.d[1][1] - i.d[0][1]) > 0.1)
    expect(diagonals.length).toBeGreaterThan(0)
    for (const d of diagonals) {
      expect(Math.abs(d.d[1][1] - d.d[0][1])).toBeCloseTo(Math.abs(d.d[1][2] - d.d[0][2]), 3)
    }
  })
})
