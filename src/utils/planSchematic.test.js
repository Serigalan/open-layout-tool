import { describe, it, expect } from 'vitest'
import { endPointStraightUtm } from './elementUtils'
import { utmToWgs84 } from './coordinateUtils'
import { schematicLayout, schematicNetwork } from './planSchematic'
import { buildSchematicPlan, switchNumber } from './planSchematicPlan'

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
/** A switch's triangle, told from the arrow beside its number by its size. */
const isWedge = (i) => i.type === 'path' && i.fill && i.d.length === 4 && Math.abs(i.d[1][1] - i.d[0][1]) > 2

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
    expect(texts).toEqual(expect.arrayContaining(['Musterstadt', 'MS', '1', '3', 'km 1,0']))
  })

  it('draws the siding and the crossover at 45°', () => {
    const diagonals = inner.filter(i => i.type === 'path' && i.d.length === 2
      && Math.abs(i.d[1][2] - i.d[0][2]) > 0.1 && Math.abs(i.d[1][1] - i.d[0][1]) > 0.1)
    expect(diagonals.length).toBeGreaterThan(0)
    for (const d of diagonals) {
      expect(Math.abs(d.d[1][1] - d.d[0][1])).toBeCloseTo(Math.abs(d.d[1][2] - d.d[0][2]), 3)
    }
  })

  it('keeps every track one spacing from the next', () => {
    const ys = [...new Set(inner.filter(i => i.type === 'path' && i.d.length === 2 && i.width === 0.5
      && i.d[0][2] === i.d[1][2] && Math.abs(i.d[1][1] - i.d[0][1]) > 20).map(i => i.d[0][2]))].sort((a, b) => a - b)
    expect(ys).toHaveLength(3)
    expect(ys[1] - ys[0]).toBeCloseTo(10)
    expect(ys[2] - ys[1]).toBeCloseTo(10)
  })

  it('marks each switch with a filled triangle in the angle of its branch', () => {
    const wedges = inner.filter(isWedge)
    expect(wedges).toHaveLength(3)
    for (const w of wedges) {
      const [[, x0, y0], [, x1, y1], [, x2, y2]] = w.d
      expect(Math.abs(x1 - x0)).toBeCloseTo(3)
      expect(y1).toBeCloseTo(y0)
      expect(x2).toBeCloseTo(x1)
      expect(Math.abs(y2 - y1)).toBeCloseTo(3)
    }
  })

  it('sets each switch number in the sharp angle beyond its triangle, an arrow pointing at it', () => {
    for (const w of inner.filter(isWedge)) {
      const [[, tx, ty], [, bx], [, , cy]] = w.d
      const sx = Math.sign(bx - tx)
      const sy = Math.sign(cy - ty)
      const label = inner.find(i => i.type === 'text' && /^\d+$/.test(i.parts[0].t)
        && Math.abs(i.x - tx) < 8 && Math.abs(i.y - ty) < 3 && Math.sign(i.x - tx) === sx)
      expect(label).toBeDefined()
      // Off the track on the branch side, clear of it by the same margin either way.
      const cap = 0.72 * label.size
      const near = sy > 0 ? label.y - cap - ty : ty - label.y
      expect(near).toBeCloseTo(0.75)
      expect(label.align).toBe(sx > 0 ? 'left' : 'right')
      const arrow = inner.find(i => i.type === 'path' && i.fill && i.d.length === 4 && !isWedge(i)
        && Math.abs(i.d[0][1] - (tx + sx * 3)) < 0.01 && Math.abs(i.d[0][2] - ty) < 3)
      expect(arrow).toBeDefined()
      // The arrow's point is nearest the switch and its colour the switch's.
      expect(Math.sign(arrow.d[1][1] - arrow.d[0][1])).toBe(sx)
      expect(arrow.fill).toBe(label.color)
    }
  })

  it('draws a platform as the DB symbol: a box with its edges along both sides', () => {
    const box = inner.find(i => i.type === 'path' && i.fill === '#ffffff' && i.d.length === 5)
    const [top, bottom] = [box.d[0][2], box.d[2][2]].sort((a, b) => a - b)
    expect(bottom - top).toBeCloseTo(6)
    const edges = inner.filter(i => i.type === 'path' && i.width === 0.25 && i.d.length === 2
      && i.d[0][1] === box.d[0][1] && i.d[0][2] > top && i.d[0][2] < bottom).map(i => i.d[0][2]).sort((a, b) => a - b)
    expect(edges).toEqual([top + 1, bottom - 1].map(v => expect.closeTo(v)))
  })

  it('sets kilometre posts in the gap beside the reference', () => {
    expect(inner.some(i => i.type === 'text' && i.bold && i.parts[0].t === '1,0')).toBe(true)
  })
})

describe('planning status in the schematic plan', () => {
  const withStatus = tracks.map(tr => (tr.id === 'X' ? { ...tr, status: 'new' } : tr.id === 'S' ? { ...tr, status: 'removal' } : tr))
  const inner = buildSchematicPlan({
    tracks: withStatus, switches, platforms, paperKey: '297x840', scaleDen: 10000,
    titleBlock: { title: 'Test', rows: [], legend: '' },
  }).sheets[0].items.find(i => i.type === 'group').items
  const colours = (pred) => inner.filter(pred).map(i => i.fill ?? i.stroke)

  it('draws a new crossover and its switches in red', () => {
    const diag = inner.filter(i => i.type === 'path' && i.d.length === 2
      && Math.abs(i.d[1][2] - i.d[0][2]) > 0.1 && Math.abs(i.d[1][1] - i.d[0][1]) > 0.1)
    expect(diag.map(i => i.stroke)).toEqual(expect.arrayContaining(['#ff0000', '#e6b400']))
    expect(colours(isWedge).sort())
      .toEqual(['#e6b400', '#ff0000', '#ff0000'])
  })

  it('lets a switch state its own status over what its tracks say', () => {
    const own = switches.map(sw => (sw.name === 'W1' ? { ...sw, status: 'existing' } : sw))
    const items = buildSchematicPlan({
      tracks: withStatus, switches: own, platforms, paperKey: '297x840', scaleDen: 10000,
    }).sheets[0].items.find(i => i.type === 'group').items
    expect(items.filter(isWedge).map(i => i.fill).sort())
      .toEqual(['#000000', '#e6b400', '#ff0000'])
  })
})

describe('switch number', () => {
  it('keeps the number of a name alone, without leading zeros', () => {
    expect(switchNumber('switch.003')).toBe('3')
    expect(switchNumber('W 301')).toBe('301')
    expect(switchNumber('W12a')).toBe('12a')
    expect(switchNumber('Weiche Nord')).toBe('Weiche Nord')
    expect(switchNumber(null)).toBe('')
  })
})
