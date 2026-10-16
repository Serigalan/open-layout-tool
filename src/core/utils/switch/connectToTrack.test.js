import { describe, it, expect } from 'vitest'
import { trackOf } from '../commands/tracks'
import { arcFrom, straightFrom, transitionElement } from '../geometry/elementFactory'
import { switchRouteBearingAt, switchRoutePointUtm } from './route'
import { trackLength } from '../track/heightUtils'
import {
  connectionAnchor, connectionRoots, fitConnectingElement, joinRouteIntoTrack, refitTrackEnd,
} from './connectToTrack'
import { expectValidTrack } from '../../test/chainInvariants'

const EPSG = 25832
const START = { easting: 500000, northing: 5600000, zone: EPSG }
const at = (node) => ({ easting: node[0], northing: node[1], zone: EPSG })

/** A straight of 100 m and then `last` from its end, as one track. */
function trackEndingIn(last) {
  const a = straightFrom(START, 30, 100, { speed: 80 })
  return trackOf([a, last(at(a.endNode), 30)], EPSG, { name: 'target.001' }, 'target')
}

describe('the connecting element at an open end', () => {
  it('is the last element at the end, read from its start', () => {
    const track = trackEndingIn((p, b) => arcFrom(p, b, 50, 800, { speed: 80, cant: 20 }))
    const { anchor } = connectionAnchor(track, 'END')
    expect(anchor).toMatchObject({ elIdx: 1, kind: 'arc', r1: 800, oldLength: 50 })
    expect(anchor.bearing).toBeCloseTo(30, 6)
    expect(anchor.fixedUtm.easting).toBeCloseTo(track.elements[0].endNode[0], 9)
  })

  it('is the first element at the start, read backwards from its end', () => {
    const track = trackEndingIn((p, b) => arcFrom(p, b, 50, 800))
    const { anchor } = connectionAnchor(track, 'BEGIN')
    expect(anchor).toMatchObject({ elIdx: 0, kind: 'straight' })
    expect(anchor.bearing).toBeCloseTo(210, 6)
    expect(anchor.fixedUtm.easting).toBeCloseTo(track.elements[0].endNode[0], 9)
  })

  it('refuses an end another track meets', () => {
    const track = trackEndingIn((p, b) => straightFrom(p, b, 50))
    const end = at(track.elements[1].endNode)
    const other = trackOf([straightFrom(end, 30, 40)], EPSG, {}, 'other')
    expect(connectionAnchor(track, 'END', { tracks: [track, other] }).error).toBe('connect_end_not_open')
  })

  it('refuses an element of a turnout', () => {
    const track = trackEndingIn((p, b) => ({ ...straightFrom(p, b, 50), switchId: 'sw', switchBranch: 'main' }))
    expect(connectionAnchor(track, 'END').error).toBe('connect_end_in_switch')
  })
})

describe('refitting the element to a port', () => {
  const fixed = START

  it('an arc is fixed by the chord and the tangent', () => {
    const route = { length: 60, r1: -450, r2: -450 }
    const port = switchRoutePointUtm(fixed, 10, route)
    const fit = fitConnectingElement({ kind: 'arc', fixedUtm: fixed, bearing: 10 }, port, switchRouteBearingAt(10, route))
    expect(fit.route.length).toBeCloseTo(60, 9)
    expect(fit.route.r1).toBeCloseTo(-450, 6)
    expect(Math.abs(fit.miss)).toBeLessThan(1e-9)
  })

  it('a straight is one where the port lies on the tangent', () => {
    const port = switchRoutePointUtm(fixed, 10, { length: 25, r1: null, r2: null })
    const fit = fitConnectingElement({ kind: 'straight', fixedUtm: fixed, bearing: 10 }, port, 10)
    expect(fit.route).toMatchObject({ r1: null, r2: null })
    expect(fit.route.length).toBeCloseTo(25, 6)
  })

  it('a transition keeps its radius at the fixed node', () => {
    const route = { length: 80, r1: 1200, r2: 500 }
    const port = switchRoutePointUtm(fixed, 10, route)
    const fit = fitConnectingElement({ kind: 'transition', fixedUtm: fixed, bearing: 10, r1: 1200 }, port,
      switchRouteBearingAt(10, route))
    expect(fit.route.length).toBeCloseTo(80, 6)
    expect(fit.route.r2).toBeCloseTo(500, 3)
    expect(fit.route.r1).toBe(1200)
  })

  it('reaches no port behind the node', () => {
    const port = switchRoutePointUtm(fixed, 190, { length: 25, r1: null, r2: null })
    expect(fitConnectingElement({ kind: 'arc', fixedUtm: fixed, bearing: 10 }, port, 10)).toBeNull()
  })
})

describe('where along the host the construction connects', () => {
  // A port sliding along a circle that the element leaving `fixed` on 10° can
  // follow exactly, arriving on the circle's tangent turned by 0.02°/m from
  // x = 12: only there does the element meet it tangentially.
  const anchor = { kind: 'arc', fixedUtm: START, bearing: 10 }
  const portAt = (x) => {
    const route = { length: 40 + x, r1: 600, r2: 600 }
    return { port: switchRoutePointUtm(START, 10, route), bearingIn: switchRouteBearingAt(10, route) + 0.02 * (x - 12) }
  }

  it('finds the station where the miss in direction vanishes', () => {
    const roots = connectionRoots(anchor, portAt, { from: 0, to: 50, step: 0.5, near: 20 })
    expect(roots).toHaveLength(1)
    expect(roots[0].x).toBeCloseTo(12, 6)
    expect(roots[0].fit.route.r1).toBeCloseTo(600, 4)
  })

  it('finds none where the miss keeps its sign', () => {
    expect(connectionRoots(anchor, portAt, { from: 20, to: 50 })).toEqual([])
  })

  it('skips stations where the construction cannot stand', () => {
    const roots = connectionRoots(anchor, x => (x < 5 ? null : portAt(x)), { from: 0, to: 50 })
    expect(roots[0].x).toBeCloseTo(12, 6)
  })
})

describe('the track refitted and joined', () => {
  /** A port 30 m beyond the track's end on its own tangent, slightly to the right. */
  function portFor(track, endpoint) {
    const { anchor } = connectionAnchor(track, endpoint)
    const route = { length: anchor.oldLength + 30, r1: 900, r2: 900 }
    const port = switchRoutePointUtm(anchor.fixedUtm, anchor.bearing, route)
    return { anchor, port, bearingIn: switchRouteBearingAt(anchor.bearing, route) }
  }

  it('at the end: the element ends on the port, the heights beyond it stay', () => {
    const base = trackEndingIn((p, b) => straightFrom(p, b, 50, { speed: 80, cant: 0 }))
    const track = { ...base, heights: [{ station: 0, z: 100 }, { station: 150, z: 101 }] }
    const { anchor, port, bearingIn } = portFor(track, 'END')
    const fit = fitConnectingElement(anchor, port, bearingIn)
    const out = refitTrackEnd(track, anchor, fit, port)
    expectValidTrack(out)
    const last = out.elements[1]
    expect(last.elementType).toBe(1)
    expect(last.radius).toBeCloseTo(900, 6)
    expect(last.speed).toBe(80)
    expect(last.endNode[0]).toBe(port.easting)
    expect(trackLength(out)).toBeCloseTo(180, 6)
    expect(out.heights.map(p => p.station)).toEqual([0, 150])
  })

  it('at the start: the element is turned back, the heights move with the length', () => {
    const base = trackEndingIn((p, b) => straightFrom(p, b, 50))
    const track = { ...base, heights: [{ station: 10, z: 100 }, { station: 150, z: 101 }] }
    const { anchor, port, bearingIn } = portFor(track, 'BEGIN')
    const fit = fitConnectingElement(anchor, port, bearingIn)
    const out = refitTrackEnd(track, anchor, fit, port)
    expectValidTrack(out)
    expect(out.elements[0].startNode[0]).toBe(port.easting)
    expect(out.elements[0].radius).toBeCloseTo(-900, 6)
    expect(out.heights.map(p => p.station)).toEqual([40, 180])
  })

  it('a transition keeps its cant ramp', () => {
    const track = trackEndingIn((p, b) => transitionElement(p, b, 60, null, 700,
      { speed: 80, cantStart: 0, cantEnd: 60 }).element)
    const { anchor } = connectionAnchor(track, 'END')
    const route = { length: 70, r1: null, r2: 600 }
    const port = switchRoutePointUtm(anchor.fixedUtm, anchor.bearing, route)
    const fit = fitConnectingElement(anchor, port, switchRouteBearingAt(anchor.bearing, route))
    const out = refitTrackEnd(track, anchor, fit, port)
    expectValidTrack(out)
    expect(out.elements[1]).toMatchObject({ elementType: 2, transitionType: 'clothoid', r1: null, cantStart: 0, cantEnd: 60 })
    expect(out.elements[1].r2).toBeCloseTo(600, 3)
  })

  it('an arc without a transition before it takes the neighbour\'s cant (Entscheidung 315)', () => {
    for (const endpoint of ['END', 'BEGIN']) {
      const base = trackEndingIn((p, b) => straightFrom(p, b, 50, { speed: 80, cant: 0 }))
      // The element at the open end carries a cant the straight beside it does not.
      const els = base.elements.map((e, i) => (i === (endpoint === 'END' ? 1 : 0) ? { ...e, cant: endpoint === 'END' ? 50 : -50 } : e))
      const track = { ...base, elements: els }
      const { anchor, port, bearingIn } = portFor(track, endpoint)
      const out = refitTrackEnd(track, anchor, fitConnectingElement(anchor, port, bearingIn), port)
      expect(out.elements[endpoint === 'END' ? 1 : 0].cant).toBe(0)
    }
    // Beside an arc the refitted one keeps its cant, stated in its own direction.
    const first = arcFrom(START, 30, 100, 900, { speed: 80, cant: 40 })
    const track = trackOf([first, straightFrom(at(first.endNode), first.endBearing, 50, { speed: 80, cant: 0 })], EPSG, {}, 'c')
    const { anchor, port, bearingIn } = portFor(track, 'END')
    const out = refitTrackEnd(track, anchor, fitConnectingElement(anchor, port, bearingIn), port)
    expect(out.elements[1].elementType).toBe(1)
    expect(out.elements[1].cant).toBe(40)
  })

  it('joins the route so that the track keeps its id, direction and the switch port is its end', () => {
    const track = trackEndingIn((p, b) => straightFrom(p, b, 50))
    for (const endpoint of ['END', 'BEGIN']) {
      const { anchor } = connectionAnchor(track, endpoint)
      const end = at(endpoint === 'END' ? track.elements[1].endNode : track.elements[0].startNode)
      const outward = endpoint === 'END' ? 30 : 210
      // The route runs from the switch's own port towards the connection.
      const tail = straightFrom(end, outward, 20)
      const route = trackOf([straightFrom(at(tail.endNode), (outward + 180) % 360, 20)], EPSG, { name: 'branch' }, 'route')
      const { track: joined, shift } = joinRouteIntoTrack(track, anchor, route)
      expectValidTrack(joined)
      expect(joined.id).toBe('target')
      expect(joined.name).toBe('target.001')
      expect(trackLength(joined)).toBeCloseTo(170, 6)
      expect(shift).toBe(endpoint === 'END' ? 0 : trackLength(route))
      expect(joined.elements[0].bearing).toBeCloseTo(30, 9)
    }
  })
})

describe('a transition before the refitted arc (Entscheidung 314)', () => {
  /** A port the plain arc reaches from the track's end, 30 m beyond it. */
  function portFor(track, endpoint) {
    const { anchor } = connectionAnchor(track, endpoint)
    const route = { length: anchor.oldLength + 30, r1: 900, r2: 900 }
    const port = switchRoutePointUtm(anchor.fixedUtm, anchor.bearing, route)
    return { anchor, port, bearingIn: switchRouteBearingAt(anchor.bearing, route) }
  }

  it('runs from the neighbour\'s curvature to the arc, which still ends on the port', () => {
    for (const endpoint of ['END', 'BEGIN']) {
      const track = trackEndingIn((p, b) => straightFrom(p, b, 50, { speed: 80, cant: 0 }))
      const { anchor, port, bearingIn } = portFor(track, endpoint)
      const fit = fitConnectingElement(anchor, port, bearingIn, 25)
      expect(fit.lead).toMatchObject({ length: 25, r1: null })
      expect(fit.lead.r2).toBeCloseTo(fit.route.r1, 9)
      const out = refitTrackEnd(track, anchor, fit, port, { speedLimit: 60 })
      expectValidTrack(out)
      expect(out.elements).toHaveLength(3)
      const [lead, arc] = endpoint === 'END' ? out.elements.slice(1) : [out.elements[1], out.elements[0]]
      expect(lead.elementType).toBe(2)
      expect(arc.elementType).toBe(1)
      expect(out.elements.every(el => el.speed === 60)).toBe(true)
      const end = endpoint === 'END' ? arc.endNode : arc.startNode
      expect(Math.hypot(end[0] - port.easting, end[1] - port.northing)).toBeLessThan(1e-6)
    }
  })
})
