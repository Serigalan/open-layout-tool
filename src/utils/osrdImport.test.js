import { describe, it, expect } from 'vitest'
import { buildInfra } from './exchangeExport'
import { parseOsrdRailJson } from './osrdImport'
import {
  SWITCH_TYPES, computeSwitchGeometryUtm, switchArcLength, switchStraightLength, switchRouteVaries,
  CROSSING_TYPES, crossingAngle, computeCrossingGeometryUtm, crossingElements,
} from './switchUtils'
import { newSwitchFields } from './switchModel'
import { recalcAbsLengths } from '../storage'

/**
 * AP 3.1 — a turnout written out and read back in. The import identifies the
 * form from the branch it finds, and a form that ends in a straight piece is
 * two elements there: recognising only the arc would hand back a turnout six
 * metres too short.
 */

const EPSG  = 25832
const START = { easting: 500000, northing: 5600000, zone: EPSG }
const BEARING = 30

/** The elements of one route of a turnout, as a dialog commits them. */
const routeElements = (segments) => recalcAbsLengths(segments.map(seg => ({
  ...(switchRouteVaries(seg)
    ? { elementType: 2, transitionType: 'clothoid', r1: seg.r1, r2: seg.r2 }
    : { elementType: seg.r1 ? 1 : 0, ...(seg.r1 ? { radius: seg.r1 } : {}) }),
  startNode: [seg.startUtm.easting, seg.startUtm.northing],
  endNode:   [seg.endUtm.easting, seg.endUtm.northing],
  bearing: seg.bearing, endBearing: seg.endBearing, length: seg.length,
  geometry: { type: 'LineString', coordinates: seg.coords },
})))

/** A turnout of `form` on a straight, as the two tracks and the record of it. */
function turnout(form) {
  const g = computeSwitchGeometryUtm(START, BEARING, form, 'right', false)
  const branch  = { id: 'branch', epsg: EPSG, elements: routeElements(g.branchSegments) }
  const through = { id: 'through', epsg: EPSG, elements: routeElements(g.stemSegments) }
  const sw = {
    ...newSwitchFields(),
    name: 'switch.001', label: form.label,
    portA_trackId: null,       portA_endpoint: null,
    portB1_trackId: 'branch',  portB1_endpoint: 'BEGIN',
    portB2_trackId: 'through', portB2_endpoint: 'BEGIN',
  }
  return { tracks: [branch, through], switches: [sw] }
}

/** Write the turnout to an exchange file and read it back. */
const roundTrip = (form) => {
  const { tracks, switches } = turnout(form)
  return parseOsrdRailJson(buildInfra(tracks, switches, [], {}))
}

describe('a turnout whose branch is one arc', () => {
  const form = SWITCH_TYPES.find(f => f.label === '300 – 1:9')

  it('comes back as that form', () => {
    const { switches, errors } = roundTrip(form)
    expect(errors).toEqual([])
    expect(switches).toHaveLength(1)
    expect(switches[0].label).toBe('300 – 1:9')
  })

  it('marks the one element its branch is', () => {
    const { tracks } = roundTrip(form)
    const branch = tracks.find(t => t.id === 'branch')
    expect(branch.elements).toHaveLength(1)
    expect(branch.elements[0].switchRoute).toBe('branch')
  })
})

describe('a turnout whose branch ends in a straight piece', () => {
  const form = SWITCH_TYPES.find(f => f.label === '190 – 1:9')

  it('is written as two branch elements — the arc and its end piece', () => {
    const { tracks } = turnout(form)
    const branch = tracks.find(t => t.id === 'branch')
    expect(branch.elements).toHaveLength(2)
    expect(branch.elements[0].length).toBeCloseTo(switchArcLength(form.R, form.ratio), 9)
    expect(branch.elements[1].length).toBeCloseTo(6.092, 9)
    expect(branch.elements[1].radius).toBeUndefined()
  })

  it('comes back as that form, not as the bare arc of another', () => {
    const { switches, errors } = roundTrip(form)
    expect(errors).toEqual([])
    expect(switches[0].label).toBe('190 – 1:9')
  })

  it('marks both branch elements, so the body is drawn whole', () => {
    const { tracks } = roundTrip(form)
    const branch = tracks.find(t => t.id === 'branch')
    expect(branch.elements.map(el => el.switchRoute)).toEqual(['branch', 'branch'])
    expect(branch.elements.every(el => el.switchId === branch.elements[0].switchId)).toBe(true)
  })

  it('marks the through route, which runs the form’s whole building length', () => {
    const { tracks } = roundTrip(form)
    const through = tracks.find(t => t.id === 'through')
    expect(through.elements).toHaveLength(1)
    expect(through.elements[0].length).toBeCloseTo(switchStraightLength(form), 6)
    expect(through.elements[0].switchRoute).toBe('main')
  })

  it('places the LCS mark, which is what identifying the form is for', () => {
    const { switches } = roundTrip(form)
    expect(switches[0].lcsCoords).toHaveLength(2)
  })
})

describe('the symmetrical turnout', () => {
  const form = SWITCH_TYPES.find(f => f.label === '215 – 1:4.8')

  it('is written as two mirror arcs and comes back as that form', () => {
    const { tracks: built } = turnout(form)
    expect(built.find(t => t.id === 'through').elements.map(el => el.radius)).toEqual([-215])
    expect(built.find(t => t.id === 'branch').elements.map(el => el.radius)).toEqual([215])
    const { switches, errors, tracks } = roundTrip(form)
    expect(errors).toEqual([])
    expect(switches.map(sw => sw.label)).toEqual(['215 – 1:4.8'])
    // The mirror arc is its through route, so it is marked as one — the symbol
    // is read from it on load, and a straight would be drawn otherwise.
    expect(tracks.find(t => t.id === 'through').elements[0].switchRoute).toBe('main')
    // Not 'abw': a mirror pair of the same form, not an ordinary bent switch.
    expect(switches[0].bauform).toBe('sym')
  })
})

/**
 * AP 3.4 — a crossing switch written out and read back in. The EBKW's legs are
 * 3 cm shorter than an EKW 500's and otherwise alike in kind and angle, so it
 * is the radius its legs run on that has to tell the two apart.
 */
describe('a crossing switch through the exchange file', () => {
  const crossingRoundTrip = (label) => {
    const form = CROSSING_TYPES.find(f => f.label === label)
    const angle = crossingAngle(form) * 180 / Math.PI
    const g = computeCrossingGeometryUtm(START, BEARING, form, angle)
    const identity = { ...newSwitchFields(form.kind), name: 'crossing.001', label }
    const els = crossingElements(g, identity)
    const track = (id, el) => ({ id, epsg: EPSG, elements: recalcAbsLengths([el]) })
    const tracks = [track('a', els.A), track('b', els.B), track('c', els.C), track('d', els.D),
      ...[els.slip1, els.slip2].filter(Boolean).map((el, i) => track(`s${i + 1}`, el))]
    const sw = {
      ...identity,
      portA_trackId: 'a', portA_endpoint: 'END',
      portB_trackId: 'b', portB_endpoint: 'END',
      portC_trackId: 'c', portC_endpoint: 'BEGIN',
      portD_trackId: 'd', portD_endpoint: 'BEGIN',
    }
    return parseOsrdRailJson(buildInfra(tracks, [sw], [], {}))
  }

  for (const label of ['EKW 1:9 – 500', 'EBKW 1:9 – 500.860', 'DBKW 1:9 – 500.860']) {
    it(`comes back as the ${label}`, () => {
      const { switches, errors } = crossingRoundTrip(label)
      expect(errors).toEqual([])
      expect(switches).toHaveLength(1)
      expect(switches[0].label).toBe(label)
    })
  }
})
