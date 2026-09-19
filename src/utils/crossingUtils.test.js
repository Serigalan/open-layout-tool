import { describe, it, expect } from 'vitest'
import {
  CROSSING_TYPES, crossingAngle, crossingEndDistance, computeCrossingGeometryUtm,
  crossingRoutesFromTracks, rebuildSwitchSymbol, switchTypeByLabel,
} from './switchUtils'
import { newSwitchFields, switchElementMark, portsOf } from './switchModel'
import { planSwitchDeletion, keptRoutes } from './switchDelete'
import { wgs84ToUTM } from './coordinateUtils'
import { computeStraightValuesUtm } from './elementUtils'

/**
 * AP 3.2 — crossings and crossing switches. The dimensions are the ones the
 * client supplied (2026-09-18): a crossing's two ends on a side lie 1.85 m
 * apart; a crossing switch's four ends are the tangent points of connecting
 * curves tangential to both legs, R·tan(α/2) from the crossing point.
 */

const EPSG  = 25832
const CENTRE = { easting: 500000, northing: 5700000, zone: EPSG }
const BEARING = 30
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])

const kr9   = CROSSING_TYPES.find(f => f.label === 'Kr 1:9')
const kr75  = CROSSING_TYPES.find(f => f.label === 'Kr 1:7.5')
const ekw190 = CROSSING_TYPES.find(f => f.label === 'EKW 1:9 – 190')
const ekw500 = CROSSING_TYPES.find(f => f.label === 'EKW 1:9 – 500')
const dkw190 = CROSSING_TYPES.find(f => f.label === 'DKW 1:9 – 190')
const dkw500 = CROSSING_TYPES.find(f => f.label === 'DKW 1:9 – 500')

describe('the crossing form table', () => {
  it('holds the six forms the dimensions name', () => {
    expect(CROSSING_TYPES.map(f => f.label)).toEqual([
      'Kr 1:9', 'Kr 1:7.5',
      'EKW 1:9 – 190', 'EKW 1:9 – 500',
      'DKW 1:9 – 190', 'DKW 1:9 – 500',
    ])
  })

  it('states the kinds the record discriminates on', () => {
    expect(new Set(CROSSING_TYPES.map(f => f.kind))).toEqual(
      new Set(['crossing', 'single_slip', 'double_slip']))
  })

  it('resolves by label next to the turnout tables', () => {
    expect(switchTypeByLabel('Kr 1:9')).toBe(kr9)
    expect(switchTypeByLabel('300 – 1:9')?.R).toBe(300)
  })
})

describe('crossingEndDistance — where the four ends lie', () => {
  it('a crossing: half the end distance beyond the crossing point, on its leg', () => {
    // The two ends on a side are 1.85 m apart; each sits half of that beyond
    // the point, measured along its leg.
    expect(crossingEndDistance(kr9)).toBeCloseTo(16.727, 2)
    expect(crossingEndDistance(kr75)).toBeCloseTo(13.967, 2)
  })

  it('a crossing switch: the tangent points of its connecting curves', () => {
    expect(crossingEndDistance(ekw190)).toBeCloseTo(190 * Math.tan(crossingAngle(ekw190) / 2), 9)
    expect(crossingEndDistance(ekw500)).toBeCloseTo(500 * Math.tan(crossingAngle(ekw500) / 2), 9)
    expect(crossingEndDistance(ekw190)).toBeCloseTo(10.523, 2)
    expect(crossingEndDistance(ekw500)).toBeCloseTo(27.693, 2)
  })
})

describe('computeCrossingGeometryUtm', () => {
  const alphaOf = (type) => crossingAngle(type) * 180 / Math.PI

  it('places all four ports at the end distance, on their legs', () => {
    for (const type of CROSSING_TYPES) {
      const g = computeCrossingGeometryUtm(CENTRE, BEARING, type, alphaOf(type))
      const t = crossingEndDistance(type)
      for (const port of ['A', 'B', 'C', 'D']) {
        expect(dist([CENTRE.easting, CENTRE.northing], g['port' + port]),
          `${type.label} port ${port}`).toBeCloseTo(t, 6)
      }
    }
  })

  it('cross route at the crossing angle, on the side stated', () => {
    const g = computeCrossingGeometryUtm(CENTRE, BEARING, kr9, alphaOf(kr9))
    expect(g.crossBearing).toBeCloseTo(BEARING + alphaOf(kr9), 9)
    const left = computeCrossingGeometryUtm(CENTRE, BEARING, kr9, -alphaOf(kr9))
    expect(left.crossBearing).toBeCloseTo(BEARING - alphaOf(kr9), 9)
  })

  it('a crossing: the two ends on a side lie 1.85 m apart', () => {
    for (const type of [kr9, kr75]) {
      const g = computeCrossingGeometryUtm(CENTRE, BEARING, type, alphaOf(type))
      expect(dist(g.portA, g.portB), type.label).toBeCloseTo(1.85, 6)
      expect(dist(g.portC, g.portD), type.label).toBeCloseTo(1.85, 6)
    }
  })

  it('body: the diamond the four ports span, closed', () => {
    const g = computeCrossingGeometryUtm(CENTRE, BEARING, kr9, alphaOf(kr9))
    expect(g.fillCoords).toHaveLength(5)
    expect(g.fillCoords[0]).toEqual(g.fillCoords[4])
  })

  it('a crossing has no slip routes; an EKW one; a DKW two', () => {
    const none = computeCrossingGeometryUtm(CENTRE, BEARING, kr9, alphaOf(kr9))
    expect(none.slip1Coords).toBeNull()
    expect(none.slip2Coords).toBeNull()
    const one = computeCrossingGeometryUtm(CENTRE, BEARING, ekw190, alphaOf(ekw190))
    expect(one.slip1Coords).not.toBeNull()
    expect(one.slip2Coords).toBeNull()
    const two = computeCrossingGeometryUtm(CENTRE, BEARING, dkw500, alphaOf(dkw500))
    expect(two.slip1Coords).not.toBeNull()
    expect(two.slip2Coords).not.toBeNull()
  })

  it('slip curves run from port to port, tangential to both legs', () => {
    for (const type of [ekw190, ekw500, dkw190, dkw500]) {
      const g = computeCrossingGeometryUtm(CENTRE, BEARING, type, alphaOf(type))
      // The curve's ends are the ports it joins, and its length is the arc
      // the angle states: R·α.
      const start = wgs84ToUTM(g.slip1Coords[0], EPSG)
      const end   = wgs84ToUTM(g.slip1Coords[g.slip1Coords.length - 1], EPSG)
      expect(dist([start.easting, start.northing], g.portA), type.label).toBeLessThan(1e-6)
      expect(dist([end.easting, end.northing], g.portD), type.label).toBeLessThan(1e-6)
      expect(g.slip1Route.length).toBeCloseTo(type.R * crossingAngle(type), 6)
      // Tangential: the arc's centre is R from both legs' tangent lines at the
      // ports — verified by the ends meeting exactly, which a non-tangential
      // arc of that length and start cannot do.
    }
  })

  it('mirrors for a cross route on the left', () => {
    for (const type of [ekw190, dkw190]) {
      const right = computeCrossingGeometryUtm(CENTRE, BEARING, type, alphaOf(type))
      const left  = computeCrossingGeometryUtm(CENTRE, BEARING, type, -alphaOf(type))
      // The ports lie at the same distances; the cross ports are mirrored
      // across the main leg.
      expect(dist([CENTRE.easting, CENTRE.northing], left.portD))
        .toBeCloseTo(dist([CENTRE.easting, CENTRE.northing], right.portD), 6)
      expect(left.slip1Route.r1).toBe(-right.slip1Route.r1)
    }
  })
})

// ── The record and its tracks ───────────────────────────────────────────────

describe('crossingRoutesFromTracks — the legs read back', () => {
  it('reads both legs from the ports and finds the crossing point', () => {
    const type = kr9
    const g = computeCrossingGeometryUtm(CENTRE, BEARING, type, crossingAngle(type) * 180 / Math.PI)
    const identity = { ...newSwitchFields(type.kind), label: type.label }
    const straight = (fromUtm, toUtm, route) => {
      const v = computeStraightValuesUtm(fromUtm, toUtm)
      return {
        elementType: 0, startNode: v.startNode, endNode: v.endNode,
        bearing: v.bearing, length: v.length, absLength: v.length,
        ...switchElementMark(identity, route),
      }
    }
    const legA = { id: 'a', epsg: EPSG, elements: [straight(g.portA_utm, g.centreUtm, 'main')] }
    const legC = { id: 'c', epsg: EPSG, elements: [straight(g.centreUtm, g.portC_utm, 'main')] }
    const legB = { id: 'b', epsg: EPSG, elements: [straight(g.portB_utm, g.centreUtm, 'cross')] }
    const legD = { id: 'd', epsg: EPSG, elements: [straight(g.centreUtm, g.portD_utm, 'cross')] }
    const sw = {
      ...identity,
      portA_trackId: 'a', portA_endpoint: 'END',
      portB_trackId: 'b', portB_endpoint: 'END',
      portC_trackId: 'c', portC_endpoint: 'BEGIN',
      portD_trackId: 'd', portD_endpoint: 'BEGIN',
    }
    const byId = { a: legA, b: legB, c: legC, d: legD }
    const routes = crossingRoutesFromTracks(sw, byId)
    expect(routes).not.toBeNull()
    expect(routes.type.label).toBe('Kr 1:9')
    expect(routes.centre.easting).toBeCloseTo(CENTRE.easting, 6)
    expect(routes.centre.northing).toBeCloseTo(CENTRE.northing, 6)
    expect(routes.mainBearing).toBeCloseTo(BEARING, 6)
    expect(routes.crossBearing).toBeCloseTo(g.crossBearing, 6)
    // Both legs run the form's half length.
    expect(routes.main[0].length).toBeCloseTo(crossingEndDistance(type), 6)
    expect(routes.cross[0].length).toBeCloseTo(crossingEndDistance(type), 6)
  })

  it('returns null where the legs do not meet in one point', () => {
    const identity = { ...newSwitchFields('crossing'), label: 'Kr 1:9' }
    const els = (e) => [{
      elementType: 0, startNode: [e, 0], endNode: [e, 100],
      bearing: 0, length: 100, absLength: 100,
      ...switchElementMark(identity, 'main'),
    }]
    const sw = {
      ...identity,
      portA_trackId: 'a', portA_endpoint: 'END',
      portB_trackId: 'b', portB_endpoint: 'END',
      portC_trackId: 'c', portC_endpoint: 'BEGIN',
      portD_trackId: 'd', portD_endpoint: 'BEGIN',
    }
    expect(crossingRoutesFromTracks(sw, {
      a: { id: 'a', epsg: EPSG, elements: els(0) },
      b: { id: 'b', epsg: EPSG, elements: els(5) },
      c: { id: 'c', epsg: EPSG, elements: els(0) },
      d: { id: 'd', epsg: EPSG, elements: els(5) },
    })).toBeNull()
  })
})

describe('rebuildSwitchSymbol — the diamond comes back', () => {
  it('rebuilds the body from the legs alone', () => {
    const type = dkw190
    const g = computeCrossingGeometryUtm(CENTRE, BEARING, type, crossingAngle(type) * 180 / Math.PI)
    const identity = { ...newSwitchFields(type.kind), label: type.label, name: 'x.001' }
    const straight = (fromUtm, toUtm, route) => {
      const v = computeStraightValuesUtm(fromUtm, toUtm)
      return {
        elementType: 0, startNode: v.startNode, endNode: v.endNode,
        bearing: v.bearing, length: v.length, absLength: v.length,
        ...switchElementMark(identity, route),
      }
    }
    const legA = { id: 'a', epsg: EPSG, elements: [straight(g.portA_utm, g.centreUtm, 'main')] }
    const legC = { id: 'c', epsg: EPSG, elements: [straight(g.centreUtm, g.portC_utm, 'main')] }
    const legB = { id: 'b', epsg: EPSG, elements: [straight(g.portB_utm, g.centreUtm, 'cross')] }
    const legD = { id: 'd', epsg: EPSG, elements: [straight(g.centreUtm, g.portD_utm, 'cross')] }
    const sw = {
      ...identity,
      portA_trackId: 'a', portA_endpoint: 'END',
      portB_trackId: 'b', portB_endpoint: 'END',
      portC_trackId: 'c', portC_endpoint: 'BEGIN',
      portD_trackId: 'd', portD_endpoint: 'BEGIN',
    }
    const rebuilt = rebuildSwitchSymbol(sw, { a: legA, b: legB, c: legC, d: legD })
    expect(rebuilt.fillCoords).toHaveLength(5)
    // The ring's corners are the four ports.
    const corners = rebuilt.fillCoords.slice(0, 4).map(c => wgs84ToUTM(c, EPSG))
    expect(dist([corners[0].easting, corners[0].northing], g.portA)).toBeLessThan(1e-6)
    expect(dist([corners[1].easting, corners[1].northing], g.portD)).toBeLessThan(1e-6)
    expect(dist([corners[2].easting, corners[2].northing], g.portC)).toBeLessThan(1e-6)
    expect(dist([corners[3].easting, corners[3].northing], g.portB)).toBeLessThan(1e-6)
    expect(rebuilt.labelCoords.length).toBeGreaterThanOrEqual(2)
    expect(rebuilt.bodyCentre).toBeDefined()
  })
})

describe('planSwitchDeletion — the crossing kinds', () => {
  const identity = { ...newSwitchFields('crossing'), label: 'Kr 1:9' }
  const legEls = (route) => {
    const v = computeStraightValuesUtm(
      { easting: 0, northing: 0, zone: EPSG }, { easting: 0, northing: 16.727, zone: EPSG })
    return [{
      elementType: 0, startNode: v.startNode, endNode: v.endNode,
      bearing: 0, length: v.length, absLength: v.length,
      ...switchElementMark(identity, route),
    }]
  }
  const sw = {
    ...identity, switchId: identity.switchId,
    portA_trackId: 'a', portA_endpoint: 'END',
    portB_trackId: 'b', portB_endpoint: 'END',
    portC_trackId: 'c', portC_endpoint: 'BEGIN',
    portD_trackId: 'd', portD_endpoint: 'BEGIN',
  }
  const legs = () => ({
    a: { id: 'a', name: 'a', epsg: EPSG, elements: legEls('main') },
    b: { id: 'b', name: 'b', epsg: EPSG, elements: legEls('cross') },
    c: { id: 'c', name: 'c', epsg: EPSG, elements: legEls('main') },
    d: { id: 'd', name: 'd', epsg: EPSG, elements: legEls('cross') },
  })

  it('nothing beyond the legs: the crossing goes with all of them', () => {
    const plan = planSwitchDeletion(sw, Object.values(legs()))
    expect(plan.reason).toBe('all')
    expect(plan.removeTrackIds).toEqual(['a', 'b', 'c', 'd'])
    expect(plan.removedElements).toBe(4)
    expect(plan.joined).toBe(false)
  })

  it('a line on both routes: both stay, unmarked', () => {
    const tracks = legs()
    // A line runs over both routes, so it hangs beyond every port: at the
    // BEGIN end of a leg whose port sits at its END, and at the END of one
    // whose port sits at its BEGIN.
    const lineEl = () => ({ ...legEls('x')[0], switchBranch: undefined, switchId: undefined, switchRoute: undefined })
    tracks.a.elements.unshift(lineEl())
    tracks.b.elements.unshift(lineEl())
    tracks.c.elements.push(lineEl())
    tracks.d.elements.push(lineEl())
    const plan = planSwitchDeletion(sw, Object.values(tracks))
    expect(plan.reason).toBe('crossing_both')
    expect(plan.removeTrackIds).toEqual([])
    expect(plan.updateTracks.map(t => t.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    // What stays carries no mark any more.
    for (const tr of plan.updateTracks) {
      expect(tr.elements.every(el => !el.switchBranch)).toBe(true)
    }
  })

  it('keptRoutes: a crossing keeps both, a slip only where no through route stays', () => {
    const at = (...ports) => Object.fromEntries(
      ports.map(p => [p, { occupied: true }]))
    expect(keptRoutes({ kind: 'crossing' }, at('A', 'B', 'C', 'D'))).toEqual(['main', 'cross'])
    expect(keptRoutes({ kind: 'double_slip' }, at('A', 'B', 'C', 'D'))).toEqual(['main', 'cross'])
    expect(keptRoutes({ kind: 'double_slip' }, at('A', 'D'))).toEqual(['slip1'])
  })

  it('a slip kind: the curves go with the legs, or stay where they are the line', () => {
    // The slip curves hang on no port, so the plan collects them by their
    // mark. Nothing beyond the legs: everything goes, curves included.
    const slipIdentity = { ...newSwitchFields('double_slip'), label: 'DKW 1:9 – 190' }
    const slipSw = { ...sw, ...slipIdentity, switchId: slipIdentity.switchId }
    const el = (route) => {
      const v = computeStraightValuesUtm(
        { easting: 0, northing: 0, zone: EPSG }, { easting: 0, northing: 16.727, zone: EPSG })
      return {
        elementType: 0, startNode: v.startNode, endNode: v.endNode,
        bearing: 0, length: v.length, absLength: v.length,
        ...switchElementMark(slipIdentity, route),
      }
    }
    const lineEl = () => ({ ...el('x'), switchBranch: undefined, switchId: undefined, switchRoute: undefined })
    const withCurves = () => ({
      a: { id: 'a', name: 'a', epsg: EPSG, elements: [el('main')] },
      b: { id: 'b', name: 'b', epsg: EPSG, elements: [el('cross')] },
      c: { id: 'c', name: 'c', epsg: EPSG, elements: [el('main')] },
      d: { id: 'd', name: 'd', epsg: EPSG, elements: [el('cross')] },
      s1: { id: 's1', name: 's1', epsg: EPSG, elements: [el('slip1')] },
      s2: { id: 's2', name: 's2', epsg: EPSG, elements: [el('slip2')] },
    })
    const gone = planSwitchDeletion(slipSw, Object.values(withCurves()))
    expect(gone.reason).toBe('all')
    expect(gone.removeTrackIds.sort()).toEqual(['a', 'b', 'c', 'd', 's1', 's2'])
    expect(gone.removedElements).toBe(6)

    // A line runs over slip1 alone: the curve stays as ordinary track, the
    // legs it joins are dead stubs and go with the switch. The line's own
    // elements beyond ports A and D stay with their tracks, trimmed of the
    // legs — the line runs over the curve, not over the crossing point.
    const tracks = withCurves()
    tracks.a.elements.unshift(lineEl())
    tracks.d.elements.push(lineEl())
    const plan = planSwitchDeletion(slipSw, Object.values(tracks))
    expect(plan.reason).toBe('crossing_slip')
    expect(plan.removeTrackIds.sort()).toEqual(['b', 'c', 's2'])
    expect(plan.updateTracks.map(t => t.id).sort()).toEqual(['a', 'd', 's1'])
    expect(plan.removedElements).toBe(5)
    // What stays carries no mark any more — the curve unmarked, the trimmed
    // tracks never had one beyond the legs.
    for (const tr of plan.updateTracks) {
      expect(tr.elements.every(el => !el.switchBranch)).toBe(true)
    }
    expect(plan.updateTracks.find(t => t.id === 'a').elements).toHaveLength(1)
    expect(plan.updateTracks.find(t => t.id === 's1').elements).toHaveLength(1)
  })
})

describe('the record and its ports', () => {
  it('a crossing kind carries four ports, one per leg', () => {
    const sw = { ...newSwitchFields('crossing') }
    expect(portsOf(sw).map(p => p.port)).toEqual(['A', 'B', 'C', 'D'])
    expect(portsOf({ ...newSwitchFields('double_slip') }).map(p => p.port))
      .toEqual(['A', 'B', 'C', 'D'])
  })
})
