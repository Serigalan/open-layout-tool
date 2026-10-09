import { describe, it, expect } from 'vitest'
import {
  exact, round3, round4, buildCoords, totalLength, horizontalElements, startAnchor, endAnchor,
  kindForOsrdType, switchesToPorts, endMarksToBufferStops, bufferStopsToEndMarks,
} from './alignmentCodec'
import { straightFrom, arcFrom, transitionElement } from './elementFactory'
import { BUFFER_STOP, BOUNDARY, BUFFER_STOP_LENGTH, DEFAULT_BUFFER_STOP_TYPE } from './trackEndMarks'

// A track in EPSG 25832: 100 m straight due east (bearing 90°), a 60 m clothoid
// into R 500 to the right, 80 m of that arc.
const EPSG = 25832
const O = { easting: 500000, northing: 5700000, zone: EPSG }
function sampleTrack() {
  const s = straightFrom(O, 90, 100, { speed: 80 })
  const tr = transitionElement({ easting: s.endNode[0], northing: s.endNode[1], zone: EPSG }, 90, 60, null, 500, { speed: 80 })
  const a = arcFrom(tr.endUtm, tr.endBearing, 80, 500, { cant: 60, speed: 80 })
  return { id: 't1', epsg: 25832, elements: [s, tr.element, a] }
}

describe('number trimming', () => {
  it('exact only drops float noise, round3/round4 round, null stays null', () => {
    expect(exact(0.1 + 0.2)).toBe(0.3)
    expect(exact(1.23456789012)).toBe(1.23456789)
    expect(round3(1.23456)).toBe(1.235)
    expect(round4(1.23456)).toBe(1.2346)
    expect(exact(null)).toBe(null)
    expect(round3(undefined)).toBe(null)
  })
})

describe('the track as a chain', () => {
  it('sums the element lengths', () => {
    expect(totalLength(sampleTrack())).toBeCloseTo(240, 9)
    expect(totalLength({})).toBe(0)
  })

  it('joins the element polylines without repeating the joints', () => {
    const t = sampleTrack()
    const n = t.elements.reduce((sum, el) => sum + el.geometry.coordinates.length, 0)
    const coords = buildCoords(t)
    expect(coords).toHaveLength(n - (t.elements.length - 1))
    expect(coords[0]).toEqual(t.elements[0].geometry.coordinates[0])
    expect(coords.at(-1)).toEqual(t.elements[2].geometry.coordinates.at(-1))
  })

  it('states type, station and the design scalars of each element', () => {
    const [s, c, a] = horizontalElements(sampleTrack())
    expect(s).toMatchObject({ type: 'straight', station_start_m: 0, length_m: 100, design_speed_kmh: 80 })
    expect(s).not.toHaveProperty('radius_m')
    expect(s).not.toHaveProperty('cant_start_mm')   // a cant of 0 is left out
    expect(c).toMatchObject({ type: 'clothoid', station_start_m: 100, radius_start_m: null, radius_end_m: 500 })
    // The transition ramps its cant from the straight's 0 up to the arc's 60.
    expect(c).not.toHaveProperty('cant_start_mm')
    expect(c.cant_end_mm).toBe(60)
    expect(a).toMatchObject({ type: 'curve', station_start_m: 160, radius_m: 500, cant_start_mm: 60, cant_end_mm: 60 })
  })

  it('names a Bloss transition as such', () => {
    const tr = transitionElement(O, 0, 50, null, 300, { transitionType: 'bloss' })
    expect(horizontalElements({ elements: [tr.element] })[0].type).toBe('bloss')
  })

  it('states a kink at the end of a straight as a signed gon deflection', () => {
    const s = straightFrom(O, 90, 50)
    const kinked = { ...s, endBearing: 99 }        // 9° to the right = 10 gon
    expect(horizontalElements({ elements: [kinked] })[0].kink_gon).toBeCloseTo(10, 9)
    const left = { ...s, endBearing: 81 }
    expect(horizontalElements({ elements: [left] })[0].kink_gon).toBeCloseTo(-10, 9)
    expect(horizontalElements({ elements: [s] })[0]).not.toHaveProperty('kink_gon')
  })

  it('anchors the start and end with gon bearings', () => {
    const t = sampleTrack()
    const start = startAnchor(t)
    expect(start).toMatchObject({ epsg: 25832, easting: O.easting, northing: O.northing })
    expect(start.bearing_gon).toBeCloseTo(100, 9)
    const end = endAnchor(t)
    const last = t.elements[2]
    expect(end.easting).toBeCloseTo(last.endNode[0], 6)
    expect(end.northing).toBeCloseTo(last.endNode[1], 6)
    expect(end.bearing_gon).toBeCloseTo(last.endBearing * 10 / 9, 6)
  })
})

describe('switches as RailJSON nodes', () => {
  const trackMap = { a: { id: 'a' }, b: { id: 'b' }, c: { id: 'c' }, d: { id: 'd' } }

  it('maps each kind to its OSRD type and back', () => {
    for (const [kind, type] of [['turnout', 'point_switch'], ['crossing', 'crossing'],
      ['single_slip', 'single_slip_switch'], ['double_slip', 'double_slip_switch'], ['link', 'link']]) {
      expect(kindForOsrdType(type)).toBe(kind)
      expect(switchesToPorts([{ kind, switchId: 'x' }], trackMap)[0].switch_type).toBe(type)
    }
    expect(kindForOsrdType('something_else')).toBe(null)
  })

  it('names a turnout\'s ports A/B1/B2 and a crossing\'s A1/A2/B1/B2', () => {
    const [turnout, crossing] = switchesToPorts([
      { kind: 'turnout', switchId: 'w1', name: 'W 1', portA_trackId: 'a', portA_endpoint: 'END',
        portB1_trackId: 'b', portB1_endpoint: 'BEGIN', portB2_trackId: 'c', portB2_endpoint: 'BEGIN' },
      { kind: 'crossing', switchId: 'k1', status: 'planned', portA_trackId: 'a', portA_endpoint: 'BEGIN',
        portB_trackId: 'b', portB_endpoint: 'END', portC_trackId: 'c', portC_endpoint: 'END',
        portD_trackId: 'd', portD_endpoint: 'BEGIN' },
    ], trackMap)
    expect(turnout.ports).toEqual({
      A: { track: 'a', endpoint: 'END' }, B1: { track: 'b', endpoint: 'BEGIN' }, B2: { track: 'c', endpoint: 'BEGIN' },
    })
    expect(turnout.extensions).toEqual({ sncf: { label: 'W 1' } })
    expect(Object.keys(crossing.ports).sort()).toEqual(['A1', 'A2', 'B1', 'B2'])
    expect(crossing.ports.B1).toEqual({ track: 'c', endpoint: 'END' })
    expect(crossing.extensions).toEqual({ olt: { status: 'planned' } })
  })

  it('leaves out ports on tracks that are not exported', () => {
    const [sw] = switchesToPorts([{ kind: 'turnout', switchId: 'w', portA_trackId: 'gone', portA_endpoint: 'END',
      portB1_trackId: 'b', portB1_endpoint: 'BEGIN' }], trackMap)
    expect(sw.ports).toEqual({ B1: { track: 'b', endpoint: 'BEGIN' } })
  })

  it('appends foreign switches unless a generated one has their id or label', () => {
    const out = switchesToPorts([{ kind: 'turnout', switchId: 'w1', name: 'W 1' }], trackMap, [
      { id: 'w1' }, { id: 'other', extensions: { sncf: { label: 'W 1' } } }, { id: 'kept' },
    ])
    expect(out.map(s => s.id)).toEqual(['w1', 'kept'])
  })
})

describe('buffer stops', () => {
  const track = sampleTrack()
  const trackMap = { t1: track }
  const total = totalLength(track)

  it('writes a buffer stop at its face, with type, brake length and end', () => {
    const [bs, ...rest] = endMarksToBufferStops([
      { id: 'b1', kind: BUFFER_STOP, trackId: 't1', endpoint: 'END', type: 6, brakeLength: 10 },
      { id: 'g1', kind: BOUNDARY, trackId: 't1', endpoint: 'BEGIN' },
      { id: 'b2', kind: BUFFER_STOP, trackId: 'gone', endpoint: 'END' },
    ], trackMap)
    expect(rest).toEqual([])
    expect(bs).toEqual({
      id: 'b1', track: 't1', position: round3(total - 10 - BUFFER_STOP_LENGTH),
      extensions: { olt: { type: 6, brake_length: 10, end: 'END' } },
    })
  })

  it('reads its own buffer stops back unchanged', () => {
    const marks = [
      { id: 'b1', kind: BUFFER_STOP, trackId: 't1', endpoint: 'END', type: 8, brakeLength: 12 },
      { id: 'b2', kind: BUFFER_STOP, trackId: 't1', endpoint: 'BEGIN', type: 4, brakeLength: 0 },
    ]
    expect(bufferStopsToEndMarks(endMarksToBufferStops(marks, trackMap), trackMap)).toEqual(marks)
  })

  it('takes a foreign stop near an end for that end, and leaves one mid-track', () => {
    const marks = bufferStopsToEndMarks([
      { id: 'near', track: 't1', position: total - 20 },
      { id: 'mid', track: 't1', position: total / 2 },
      { id: 'nowhere', track: 'gone', position: 1 },
    ], trackMap)
    expect(marks).toEqual([{
      id: 'near', kind: BUFFER_STOP, trackId: 't1', endpoint: 'END',
      type: DEFAULT_BUFFER_STOP_TYPE, brakeLength: Math.round((20 - BUFFER_STOP_LENGTH) * 10) / 10,
    }])
  })
})
