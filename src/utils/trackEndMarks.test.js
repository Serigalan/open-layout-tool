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
