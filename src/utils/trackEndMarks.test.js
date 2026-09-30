import { describe, it, expect } from 'vitest'
import {
  newBufferStop, newBoundary, bufferStopStations, bufferStopFits, remapEndMarks, flipEndMarks,
  pruneEndMarks, defaultBrakeLength, BUFFER_STOP_LENGTH, BUFFER_STOP_TYPES,
} from './trackEndMarks'
import { bufferStopShape, bufferStopFeatures } from './bufferStopGeometry'
import { classifyTrackEnds, freeEnds, switchNodes } from './topology'
import { endPointStraightUtm, endPointCurvedUtm } from './elementUtils'
import { utmToWgs84 } from './coordinateUtils'
import { newSwitchFields, LINK_KIND } from './switchModel'

/**
 * Buffer stops and boundaries sit on track ends (trackEndMarks), and the
 * topology says which ends are connected to anything (topology). These are the
 * rules both keep.
 */

const UTM = 25832
const E0 = 500000, N0 = 5600000

function straight(id, easting, northing, bearing, length, epsg = UTM) {
  const start = { easting, northing, zone: epsg }
  const end   = endPointStraightUtm(start, bearing, length)
  return {
    id, name: id, epsg,
    elements: [{
      elementType: 0, length, bearing, endBearing: bearing,
      startNode: [start.easting, start.northing],
      endNode:   [end.easting, end.northing],
      absLength: length,
      geometry: { type: 'LineString', coordinates: [
        utmToWgs84(start.easting, start.northing, epsg),
        utmToWgs84(end.easting, end.northing, epsg),
      ] },
    }],
  }
}

const turnout = (a, b1, b2) => ({
  ...newSwitchFields(), name: 'W1',
  portA_trackId: a[0], portA_endpoint: a[1],
  portB1_trackId: b1[0], portB1_endpoint: b1[1],
  portB2_trackId: b2[0], portB2_endpoint: b2[1],
})

describe('buffer stop stations', () => {
  it('puts the face 2.20 m plus the brake length before the end', () => {
    const st = bufferStopStations(100, { endpoint: 'END', brakeLength: 6 })
    expect(st.face).toBeCloseTo(100 - 6 - BUFFER_STOP_LENGTH)
    expect(st.body).toEqual([st.face, 94])
    expect(st.brake).toEqual([94, 100])
  })

  it('mirrors at BEGIN', () => {
    const st = bufferStopStations(100, { endpoint: 'BEGIN', brakeLength: 4 })
    expect(st.face).toBeCloseTo(4 + BUFFER_STOP_LENGTH)
    expect(st.body[0]).toBe(4)
    expect(st.brake).toEqual([0, 4])
  })

  it('clamps to a track that has since become too short', () => {
    const st = bufferStopStations(3, { endpoint: 'END', brakeLength: 10 })
    expect(st.face).toBe(0)
    expect(st.brake).toEqual([0, 3])
  })

  it('a type proposes its own number as brake length', () => {
    expect(BUFFER_STOP_TYPES.map(defaultBrakeLength)).toEqual([4, 6, 8, 10])
    expect(newBufferStop('t', 'END', 8)).toMatchObject({ kind: 'buffer_stop', type: 8, brakeLength: 8 })
  })

  it('fits only where the track is long enough for stop and brake length', () => {
    expect(bufferStopFits(12.2, 10)).toBe(true)
    expect(bufferStopFits(12.1, 10)).toBe(false)
    expect(bufferStopFits(50, -1)).toBe(false)
    expect(bufferStopFits(50, NaN)).toBe(false)
  })
})

describe('buffer stop shape', () => {
  it('stands across the track at its face, on a straight', () => {
    const tr = straight('t', E0, N0, 90, 100)   // due east
    const shape = bufferStopShape(tr, { endpoint: 'END', brakeLength: 4 })
    const faceE = E0 + 100 - 4 - BUFFER_STOP_LENGTH
    const [a, b] = shape.face
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const want = utmToWgs84(faceE, N0, UTM)
    expect(mid[0]).toBeCloseTo(want[0], 7)
    expect(mid[1]).toBeCloseTo(want[1], 7)
    // Across: both ends at the face's easting, north and south of the axis.
    expect(a[0]).toBeCloseTo(b[0], 6)
    expect(shape.body.length).toBeGreaterThanOrEqual(2)
    expect(shape.brake.length).toBeGreaterThanOrEqual(2)
  })

  it('follows a curve', () => {
    const start = { easting: E0, northing: N0, zone: UTM }
    const R = 300, L = 80
    const end = endPointCurvedUtm(start, 0, L, R)
    const tr = {
      id: 'c', epsg: UTM,
      elements: [{
        elementType: 1, length: L, bearing: 0, radius: R,
        startNode: [E0, N0], endNode: [end.easting, end.northing],
        geometry: { type: 'LineString', coordinates: [utmToWgs84(E0, N0, UTM), utmToWgs84(end.easting, end.northing, UTM)] },
      }],
    }
    const shape = bufferStopShape(tr, { endpoint: 'END', brakeLength: 0 })
    const last = shape.body[shape.body.length - 1]
    const want = utmToWgs84(end.easting, end.northing, UTM)
    expect(last[0]).toBeCloseTo(want[0], 7)
    expect(last[1]).toBeCloseTo(want[1], 7)
    expect(shape.brake).toBeNull()
  })

  it('makes features only for buffer stops on tracks that exist', () => {
    const tr = straight('t', E0, N0, 90, 100)
    const feats = bufferStopFeatures([tr], [
      newBufferStop('t', 'END', 4), newBoundary('t', 'BEGIN'), newBufferStop('gone', 'END', 4),
    ])
    expect(feats.map(f => f.properties.part).sort()).toEqual(['body', 'brake', 'face'])
  })
})

describe('end marks follow their end', () => {
  const marks = [
    { id: 'm1', kind: 'buffer_stop', trackId: 't', endpoint: 'BEGIN' },
    { id: 'm2', kind: 'buffer_stop', trackId: 't', endpoint: 'END' },
  ]

  it('a split sends BEGIN to the first half and END to the second', () => {
    const out = remapEndMarks(marks, [{ oldId: 't', newId: ['h', 'k'] }])
    expect(out.map(m => [m.trackId, m.endpoint])).toEqual([['h', 'BEGIN'], ['k', 'END']])
  })

  it('a join folded in backwards swaps the end', () => {
    const out = remapEndMarks(marks, [{ oldId: 't', newId: 'j', flip: true }])
    expect(out.map(m => [m.trackId, m.endpoint])).toEqual([['j', 'END'], ['j', 'BEGIN']])
  })

  it('an end a splice consumes loses its mark instead of moving', () => {
    const out = remapEndMarks(marks, [{ oldId: 't', newId: 'j' }], [{ trackId: 't', endpoint: 'END' }])
    expect(out.map(m => m.id)).toEqual(['m1'])
  })

  it('reversing a track swaps its marks', () => {
    expect(flipEndMarks(marks, 't').map(m => m.endpoint)).toEqual(['END', 'BEGIN'])
    expect(flipEndMarks(marks, 'x')).toEqual(marks)
  })

  it('goes when its track goes, when a switch takes the end, and one per end', () => {
    const tracks = [{ id: 't' }, { id: 'u' }, { id: 'v' }]
    const sw = turnout(['u', 'END'], ['x', 'BEGIN'], ['y', 'BEGIN'])
    const all = [
      ...marks,
      { id: 'm3', kind: 'boundary', trackId: 'u', endpoint: 'END' },     // taken by the switch
      { id: 'm4', kind: 'boundary', trackId: 'gone', endpoint: 'END' },  // no track
      { id: 'm5', kind: 'boundary', trackId: 't', endpoint: 'END' },     // second on one end
      { id: 'm6', kind: 'boundary', trackId: 'v', endpoint: 'BEGIN' },
    ]
    expect(pruneEndMarks(all, tracks, [sw]).map(m => m.id)).toEqual(['m1', 'm2', 'm6'])
    // Nothing to drop: the same array back.
    expect(pruneEndMarks(marks, tracks, [])).toBe(marks)
  })
})

describe('topology', () => {
  // Three tracks meeting at a turnout's toe, a fourth laid on end to the
  // switch's B2 track, a fifth ending 50 cm short of the toe.
  const a  = straight('a', E0, N0, 90, 100)
  const [toeE, toeN] = a.elements[0].endNode
  const b1 = straight('b1', toeE, toeN, 80, 60)
  const b2 = straight('b2', toeE, toeN, 90, 60)
  const [jE, jN] = b2.elements[0].endNode
  const c  = straight('c', jE, jN, 90, 40)
  const d  = straight('d', toeE - 0.5, toeN - 20, 0, 19.5)
  const sw = turnout(['a', 'END'], ['b1', 'BEGIN'], ['b2', 'BEGIN'])

  const stateOf = (ends, trackId, endpoint) => ends.find(e => e.trackId === trackId && e.endpoint === endpoint)?.state

  it('says what each end is connected to', () => {
    const ends = classifyTrackEnds([a, b1, b2, c, d], [sw], [newBufferStop('c', 'END', 4)])
    expect(stateOf(ends, 'a', 'END')).toBe('switch')
    expect(stateOf(ends, 'b1', 'BEGIN')).toBe('switch')
    expect(stateOf(ends, 'b2', 'END')).toBe('joint')
    expect(stateOf(ends, 'c', 'BEGIN')).toBe('joint')
    expect(stateOf(ends, 'c', 'END')).toBe('buffer_stop')
    expect(stateOf(ends, 'a', 'BEGIN')).toBe('open')
    expect(stateOf(ends, 'b1', 'END')).toBe('open')
    // Half a metre from the toe, and not in the switch's ports.
    expect(stateOf(ends, 'd', 'END')).toBe('near')
    expect(stateOf(ends, 'd', 'BEGIN')).toBe('open')
  })

  it('offers only the open ends for a mark', () => {
    const ends = classifyTrackEnds([a, b1, b2, c, d], [sw], [newBoundary('a', 'BEGIN')])
    expect(stateOf(ends, 'a', 'BEGIN')).toBe('boundary')
    expect(freeEnds(ends).map(e => `${e.trackId}|${e.endpoint}`).sort())
      .toEqual(['b1|END', 'c|END', 'd|BEGIN', 'd|END'])
  })

  it('three ends on one node without a switch are not a joint', () => {
    const p = straight('p', E0, N0, 90, 50)
    const [e, n] = p.elements[0].endNode
    const q = straight('q', e, n, 90, 50)
    const r = straight('r', e, n, 60, 50)
    const ends = classifyTrackEnds([p, q, r], [], [])
    expect(stateOf(ends, 'p', 'END')).toBe('near')
    expect(stateOf(ends, 'q', 'BEGIN')).toBe('near')
  })

  it('sets a turnout on its toe and tells a link apart', () => {
    const link = { ...newSwitchFields(LINK_KIND), portA_trackId: 'b2', portA_endpoint: 'END', portB_trackId: 'c', portB_endpoint: 'BEGIN' }
    const nodes = switchNodes([a, b1, b2, c], [sw, link])
    const toe = utmToWgs84(toeE, toeN, UTM)
    expect(nodes[0].lngLat[0]).toBeCloseTo(toe[0], 9)
    expect(nodes[0].link).toBe(false)
    expect(nodes[1].link).toBe(true)
    const ends = classifyTrackEnds([a, b1, b2, c], [sw, link], [])
    expect(stateOf(ends, 'c', 'BEGIN')).toBe('link')
  })
})

describe('buffer stops on the plan', () => {
  it('draws the body filled and the face across, true to scale', async () => {
    const { buildPlan } = await import('./planModel')
    const tr = straight('t', 0, 0, 90, 100)   // due east from the origin
    const plan = (endMarks) => buildPlan({
      tracks: [tr], endMarks, show: { labels: false, trackNames: false, mainPoints: false },
      sheets: [{ center: { e: 50, n: 0 }, rotDeg: 0, index: 0, count: 1 }],
      paperKey: '297x840', scaleDen: 1000, reserve: 0,
    }).sheets[0].items.find(i => i.type === 'group').items
    const without = plan([])
    const withStop = plan([newBufferStop('t', 'END', 4)])
    const added = withStop.filter(i => !without.some(w => JSON.stringify(w) === JSON.stringify(i)))
    const body = added.find(i => i.fill)
    const bar = added.find(i => !i.fill)
    expect(body).toBeTruthy()
    expect(bar).toBeTruthy()
    // 2.20 m of body is 2.2 mm at 1:1000, 3.5 m of bar is 3.5 mm.
    const xs = body.d.filter(c => c[0] !== 'Z').map(c => c[1])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2.2, 3)
    const [, [, x1, y1], [, x2, y2]] = [null, ...bar.d]
    expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo(3.5, 3)
  })
})

describe('buffer stops in RailJSON', () => {
  it('go out at their face and come back to the same end', async () => {
    const { buildInfra } = await import('./exchangeExport')
    const { parseOsrdRailJson } = await import('./osrdImport')
    const tr = straight('t', E0, N0, 90, 100)
    const marks = [newBufferStop('t', 'END', 8, 6.5), newBufferStop('t', 'BEGIN', 4), newBoundary('t', 'END')]
    const infra = buildInfra([tr], [], [], {}, marks)
    expect(infra.buffer_stops).toHaveLength(2)
    expect(infra.buffer_stops[0]).toMatchObject({ track: 't', position: 100 - 6.5 - BUFFER_STOP_LENGTH })
    const { endMarks } = parseOsrdRailJson(infra)
    expect(endMarks.map(m => [m.endpoint, m.type, m.brakeLength]).sort())
      .toEqual([['BEGIN', 4, 4], ['END', 8, 6.5]])
    expect(endMarks.map(m => m.id).sort()).toEqual(marks.slice(0, 2).map(m => m.id).sort())
  })

  it('takes a stop from another program for the nearer end, when it stands close to it', async () => {
    const { bufferStopsToEndMarks } = await import('./alignmentCodec')
    const tr = straight('t', E0, N0, 90, 200)
    const marks = bufferStopsToEndMarks([
      { id: 'a', track: 't', position: 200 },       // at the end: no brake length
      { id: 'b', track: 't', position: 10 },        // 10 m in from BEGIN
      { id: 'c', track: 't', position: 100 },       // mid-track: not an end's
      { id: 'd', track: 'gone', position: 0 },
    ], { t: tr })
    expect(marks.map(m => [m.id, m.endpoint, m.brakeLength])).toEqual([['a', 'END', 0], ['b', 'BEGIN', 7.8]])
  })

  it('hands foreign stops back that it did not take', async () => {
    const { endMarksToBufferStops } = await import('./alignmentCodec')
    const tr = straight('t', E0, N0, 90, 100)
    const m = newBufferStop('t', 'END', 4)
    const out = endMarksToBufferStops([m], { t: tr }, [{ id: m.id, track: 't', position: 1 }, { id: 'x', track: 't', position: 50 }])
    expect(out.map(b => b.id)).toEqual([m.id, 'x'])
  })
})

describe('buffer stops from the MDB', () => {
  it('put the node of form „Prellbock" on the track end it stands at', async () => {
    const { parseMdbPayload, buildAllTracksFromMdb, mdbBufferStops, matchMdbBufferStops } = await import('./mdbImport')
    const fixture = (await import('../test/fixtures/mdb_thueringen.json')).default
    const payload = parseMdbPayload(fixture)
    const stops = mdbBufferStops(payload)
    expect(stops).toHaveLength(1)
    expect(stops[0].lngLat).not.toBeNull()
    const { tracks } = buildAllTracksFromMdb(payload)
    const ids = tracks.map((tr, i) => ({ ...tr, id: tr.id ?? `t${i}` }))
    const { marks, missed } = matchMdbBufferStops(stops, ids, [])
    expect(missed).toBe(0)
    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({ kind: 'buffer_stop', brakeLength: 0 })
    // The chain begins at the node the stop is at.
    expect(marks[0].endpoint).toBe('BEGIN')
  })
})

describe('the topology view', () => {
  it('draws switches and links as nodes, and only the ends that say something', async () => {
    const { topologyGeoJSON } = await import('./topologyLayer')
    const a  = straight('a', E0, N0, 90, 100)
    const [toeE, toeN] = a.elements[0].endNode
    const b1 = straight('b1', toeE, toeN, 80, 60)
    const b2 = straight('b2', toeE, toeN, 90, 60)
    const [lE, lN] = b2.elements[0].endNode
    const c  = straight('c', lE, lN, 90, 40)
    const sw = turnout(['a', 'END'], ['b1', 'BEGIN'], ['b2', 'BEGIN'])
    const link = { ...newSwitchFields(LINK_KIND), portA_trackId: 'b2', portA_endpoint: 'END', portB_trackId: 'c', portB_endpoint: 'BEGIN' }
    const { nodes, ends } = topologyGeoJSON([a, b1, b2, c], [sw, link],
      [newBufferStop('c', 'END', 4), newBoundary('a', 'BEGIN')])
    expect(nodes.features.map(f => f.properties.link)).toEqual([false, true])
    expect(ends.features.map(f => `${f.properties.trackId}|${f.properties.endpoint}|${f.properties.state}`).sort())
      .toEqual(['a|BEGIN|boundary', 'b1|END|open', 'c|END|buffer_stop'])
    // The bar across c's end: c runs due east, so it is turned a quarter.
    const bar = ends.features.find(f => f.properties.state === 'buffer_stop')
    expect(bar.properties.rotate).toBeCloseTo(270, 6)
  })
})
