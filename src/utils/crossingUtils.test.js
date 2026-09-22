import { describe, it, expect } from 'vitest'
import {
  CROSSING_TYPES, crossingAngle, crossingEndDistance, computeCrossingGeometryUtm,
  crossingRoutesFromTracks, rebuildSwitchSymbol, switchTypeByLabel,
} from './switchUtils'
import { newSwitchFields, switchElementMark, portsOf } from './switchModel'
import { planSwitchDeletion, keptRoutes, switchParts } from './switchDelete'
import { switchDesignation, switchNumberOf } from './identifierUtils'
import { switchesToPorts } from './alignmentCodec'
import { wgs84ToUTM, utmToWgs84 } from './coordinateUtils'
import {
  computeStraightValuesUtm, computeCurvedValuesUtm, endPointStraightUtm, endPointCurvedUtm,
} from './elementUtils'
import { recalcAbsLengths, rebuildCoords } from '../storage'
import { placeSwitchOnTrack } from './switchPlacement'
import { splitElementAt, splitTrackAtJoint, carveSwitchRoute } from './trackSplitUtils'
import { expectValidTrack } from '../test/chainInvariants'

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
  // In the order the catalogue states them: the Regelformen of A01 first, the
  // Sonderbauformen of A02 after — Kr 1:14 and Kr 1:18.5 among them since
  // 2026-09-22.
  it('holds eleven plain crossings and the four crossing switches', () => {
    expect(CROSSING_TYPES.map(f => f.label)).toEqual([
      'Kr 1:7.5', 'Kr 1:9',
      'EKW 1:9 – 190', 'EKW 1:9 – 500',
      'DKW 1:9 – 190', 'DKW 1:9 – 500',
      'Kr 1:2.9', 'Kr 1:3.224', 'Kr 1:3.683', 'Kr 1:4.444',
      'Kr 1:5.5', 'Kr 1:6.6', 'Kr 1:6.964', 'Kr 1:14', 'Kr 1:18.5',
    ])
  })

  it('states the tangent of the forms that were delivered as tangents', () => {
    // `lt` is the measure itself — the distance from the crossing point to each
    // of the four ends. The end distance follows from it, c = 2·lt·sin(α/2),
    // and it reproduces the delivered c to half a millimetre, which is what
    // says the table and the construction mean the same thing.
    for (const [label, lt, c] of [['Kr 1:2.9', 6.9040, 2.2815],
      ['Kr 1:3.224', 7.9200, 2.3731], ['Kr 1:3.683', 9.4480, 2.4976],
      ['Kr 1:4.444', 10.9035, 2.4082], ['Kr 1:5.5', 10.7000, 1.9226],
      ['Kr 1:6.6', 12.2390, 1.8387], ['Kr 1:6.964', 12.6900, 1.8083],
      ['Kr 1:7.5', 13.2510, 1.7552], ['Kr 1:9', 16.6155, 1.8377]]) {
      const form = CROSSING_TYPES.find(f => f.label === label)
      expect(crossingEndDistance(form), label).toBeCloseTo(lt, 9)
      expect(2 * lt * Math.sin(crossingAngle(form) / 2), label).toBeCloseTo(c, 2)
    }
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
  it('a crossing: the tangent the form states, along each leg', () => {
    // Measured, not derived. Carried with an assumed end distance of 1.85 m
    // these two reached 16.727 m and 13.967 m — 11 cm and 71 cm too far.
    expect(crossingEndDistance(kr9)).toBe(16.6155)
    expect(crossingEndDistance(kr75)).toBe(13.2510)
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

  it('a crossing: the two ends on a side lie the delivered c apart', () => {
    // c = 2·lt·sin(α/2) — the body's own construction reproduces the measure
    // the table states beside the tangent.
    for (const [type, c] of [[kr9, 1.8377], [kr75, 1.7552]]) {
      const g = computeCrossingGeometryUtm(CENTRE, BEARING, type, alphaOf(type))
      expect(dist(g.portA, g.portB), type.label).toBeCloseTo(c, 3)
      expect(dist(g.portC, g.portD), type.label).toBeCloseTo(c, 3)
    }
  })

  it('body: the two wedges between the legs at the acute angle, closed', () => {
    const g = computeCrossingGeometryUtm(CENTRE, BEARING, kr9, alphaOf(kr9))
    expect(g.fillCoords).toHaveLength(2)
    for (const ring of g.fillCoords) {
      expect(ring).toHaveLength(4)
      expect(ring[0]).toEqual(ring[3])
    }
    // Each wedge runs from the crossing point out to the two ends on a side.
    const wedges = g.fillCoords.map(r => r.map(c => wgs84ToUTM(c, EPSG)))
    const at = (w, i) => [wedges[w][i].easting, wedges[w][i].northing]
    expect(dist(at(0, 0), g.portA)).toBeLessThan(1e-6)
    expect(dist(at(0, 1), g.portB)).toBeLessThan(1e-6)
    expect(dist(at(0, 2), [CENTRE.easting, CENTRE.northing])).toBeLessThan(1e-6)
    expect(dist(at(1, 0), g.portC)).toBeLessThan(1e-6)
    expect(dist(at(1, 1), g.portD)).toBeLessThan(1e-6)
    expect(dist(at(1, 2), [CENTRE.easting, CENTRE.northing])).toBeLessThan(1e-6)
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

describe('rebuildSwitchSymbol — the wedges come back', () => {
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
    expect(rebuilt.fillCoords).toHaveLength(2)
    // Each wedge runs from the crossing point out to the two ends on a side.
    const wedges = rebuilt.fillCoords.map(r => r.map(c => wgs84ToUTM(c, EPSG)))
    const at = (w, i) => [wedges[w][i].easting, wedges[w][i].northing]
    expect(dist(at(0, 0), g.portA)).toBeLessThan(1e-6)
    expect(dist(at(0, 1), g.portB)).toBeLessThan(1e-6)
    expect(dist(at(0, 2), [g.centreUtm.easting, g.centreUtm.northing])).toBeLessThan(1e-6)
    expect(dist(at(1, 0), g.portC)).toBeLessThan(1e-6)
    expect(dist(at(1, 1), g.portD)).toBeLessThan(1e-6)
    expect(dist(at(1, 2), [g.centreUtm.easting, g.centreUtm.northing])).toBeLessThan(1e-6)
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

describe('the designation of a crossing', () => {
  it('names a crossing for what it is, not a switch', () => {
    expect(switchDesignation(8, 'crossing')).toBe('crossing.008')
    expect(switchDesignation(8, 'single_slip')).toBe('crossing.008')
    expect(switchDesignation(8, 'double_slip')).toBe('crossing.008')
    expect(switchDesignation(8)).toBe('switch.008')
    expect(switchDesignation(8, 'turnout')).toBe('switch.008')
  })

  it('reads the number back out of either prefix', () => {
    expect(switchNumberOf({ name: 'crossing.008' })).toBe(8)
    expect(switchNumberOf({ name: 'switch.008' })).toBe(8)
    expect(switchNumberOf({ number: 8 })).toBe(8)
  })
})

describe('the OSRD export of a crossing', () => {
  it('names the ports and the type the OSRD node types do', () => {
    const sw = {
      ...newSwitchFields('double_slip'), name: 'crossing.001', number: 1,
      portA_trackId: 'a', portA_endpoint: 'END',
      portB_trackId: 'b', portB_endpoint: 'END',
      portC_trackId: 'c', portC_endpoint: 'BEGIN',
      portD_trackId: 'd', portD_endpoint: 'BEGIN',
    }
    const [out] = switchesToPorts([sw], { a: {}, b: {}, c: {}, d: {} })
    expect(out.id).toBe(sw.switchId)
    expect(out.ports).toEqual({
      A1: { track: 'a', endpoint: 'END' },
      A2: { track: 'b', endpoint: 'END' },
      B1: { track: 'c', endpoint: 'BEGIN' },
      B2: { track: 'd', endpoint: 'BEGIN' },
    })
    expect(out.switch_type).toBe('double_slip_switch')
    expect(out.extensions).toEqual({ sncf: { label: 'crossing.001' } })
    expect(out.group_change_delay).toBe(0)
  })

  it('a plain crossing is a crossing, not a switch type', () => {
    const sw = { ...newSwitchFields('crossing'), name: 'crossing.002', number: 2 }
    const [out] = switchesToPorts([sw], {})
    expect(out.switch_type).toBe('crossing')
    expect(out.ports).toEqual({})
  })
})

// ── AP 3.3 — the crossing laid into a track ─────────────────────────────────

/**
 * The commit CrossingOnTrackForm makes, built the way the form builds it: the
 * host track parted at the crossing point, its halves carrying the main legs
 * as carved, marked elements, the cross route as two tracks of its own — the
 * same port shape the end-anchored crossing commits, so everything that reads
 * a crossing back (the symbol, the deletion, the OSRD codec) reads this one the
 * same way.
 */
const HOST_START   = { easting: 480000, northing: 5620000, zone: EPSG }
const HOST_BEARING = 30

const toWgs = (u) => utmToWgs84(u.easting, u.northing, u.zone)

function straightElement(startUtm, bearing, length) {
  const endUtm = endPointStraightUtm(startUtm, bearing, length)
  const v = computeStraightValuesUtm(startUtm, endUtm)
  return {
    elementType: 0,
    startNode: v.startNode, endNode: v.endNode,
    bearing: v.bearing, length: v.length, absLength: v.length,
    geometry: { type: 'LineString', coordinates: [toWgs(startUtm), toWgs(endUtm)] },
  }
}

function arcElement(startUtm, bearing, signedR, length) {
  const endUtm = endPointCurvedUtm(startUtm, bearing, length, signedR)
  const v = computeCurvedValuesUtm(startUtm, endUtm, signedR)
  return {
    elementType: 1,
    startNode: v.startNode, endNode: v.endNode,
    bearing: v.bearing, endBearing: v.endBearing,
    length: v.length, absLength: v.length, radius: signedR,
    geometry: { type: 'LineString', coordinates: [toWgs(startUtm), toWgs(endUtm)] },
  }
}

const trackOf = (id, elements) => {
  const els = recalcAbsLengths(elements)
  return { id, epsg: EPSG, elements: els, coordinates: rebuildCoords(els) }
}

/** A host line of two 60 m straights — the body spans their joint or not. */
function hostTrack() {
  const mid = endPointStraightUtm(HOST_START, HOST_BEARING, 60)
  return trackOf('host', [
    straightElement(HOST_START, HOST_BEARING, 60),
    straightElement(mid, HOST_BEARING, 60),
  ])
}

/**
 * The form's commit as a function: placement both ways, the part at the point,
 * the carved legs, the cross route — `crossBeyond` appends ordinary track past
 * the cross legs' ports, the line a deletion decides by.
 */
function commitCrossingOnTrack(host, station, type, crossAngleDeg, crossBeyond = 0) {
  const t = crossingEndDistance(type)
  const ahead = placeSwitchOnTrack(host, station, false, t)
  if (ahead.error) return { error: ahead.error }
  const back = placeSwitchOnTrack(host, station, true, t)
  if (back.error) return { error: back.error }
  const straight = [...ahead.pieces, ...back.pieces].every(p => p.r1 == null && p.r2 == null)
  if (!straight) return { error: 'crossing_on_track_straight_only' }

  const g = computeCrossingGeometryUtm(ahead.toeUtm, ahead.bearing, type, crossAngleDeg)
  const identity = { ...newSwitchFields(type.kind), name: 'crossing.001', label: type.label }
  const mainMark = switchElementMark(identity, 'main')
  const split = ahead.joint != null
    ? splitTrackAtJoint(host, ahead.joint, ahead.bearing, new Set())
    : splitElementAt(host, ahead.elIdx, ahead.toeUtm, ahead.bearing, new Set())
  const carvedAhead  = carveSwitchRoute(split.ahead, split.aheadEndpoint, g.portC_utm, mainMark, t)
  const carvedBehind = carveSwitchRoute(split.behind, split.behindEndpoint, g.portA_utm, mainMark, t)
  if (!carvedAhead || !carvedBehind) return { error: 'carve' }

  const marked = (el, route) => ({ ...el, ...switchElementMark(identity, route) })
  const legBEls = [marked(straightElement(g.portB_utm, (g.crossBearing + 180) % 360, t), 'cross')]
  const legDEls = [marked(straightElement(g.centreUtm, g.crossBearing, t), 'cross')]
  if (crossBeyond > 0) {
    legBEls.unshift(straightElement(
      endPointStraightUtm(g.portB_utm, (g.crossBearing + 180) % 360, crossBeyond),
      g.crossBearing, crossBeyond))
    legDEls.push(straightElement(g.portD_utm, g.crossBearing, crossBeyond))
  }
  const legB = trackOf('b', legBEls)
  const legD = trackOf('d', legDEls)

  const sw = {
    ...identity, number: 1,
    portA_trackId: carvedBehind.id, portA_endpoint: split.behindEndpoint,
    portB_trackId: 'b', portB_endpoint: 'END',
    portC_trackId: carvedAhead.id, portC_endpoint: split.aheadEndpoint,
    portD_trackId: 'd', portD_endpoint: 'BEGIN',
    fillCoords: g.fillCoords,
  }
  const tracks = [
    ...split.tracks.map(tr => (
      tr.id === carvedAhead.id ? carvedAhead : tr.id === carvedBehind.id ? carvedBehind : tr)),
    legB, legD,
  ]
  return { sw, tracks, g }
}

describe('the crossing laid into a track (AP 3.3)', () => {
  const alpha = crossingAngle(kr9) * 180 / Math.PI

  it('places both halves and refuses what does not fit', () => {
    const host = hostTrack()
    expect(commitCrossingOnTrack(host, 50, kr9, alpha).error).toBeUndefined()
    expect(commitCrossingOnTrack(host, 60, kr9, alpha).error).toBeUndefined()
    // The body needs its end distance on each side of the point.
    expect(commitCrossingOnTrack(host, 10, kr9, alpha).error).toBe('switch_on_track_no_room')
    expect(commitCrossingOnTrack(host, 110, kr9, alpha).error).toBe('switch_on_track_no_room')
    // Curved track under the body: the placement walks it — the straight-only
    // guard is what refuses it, not the placement.
    const arcHost = trackOf('arc', [arcElement(HOST_START, HOST_BEARING, 500, 120)])
    const place = placeSwitchOnTrack(arcHost, 50, false, crossingEndDistance(kr9))
    expect(place.error).toBeUndefined()
    expect(place.pieces.some(p => p.r1 != null)).toBe(true)
    expect(commitCrossingOnTrack(arcHost, 50, kr9, alpha).error).toBe('crossing_on_track_straight_only')
  })

  it('reads back as a crossing: point, bearings, legs — on the parted halves', () => {
    const { sw, tracks } = commitCrossingOnTrack(hostTrack(), 50, kr9, alpha)
    for (const tr of tracks) expectValidTrack(tr)
    // Every port carries the crossing's own elements, its leg the end
    // distance long.
    const { ports, byPort } = switchParts(sw, tracks)
    for (const p of ports) {
      expect(p.mine.length, `port ${p.port}`).toBeGreaterThan(0)
      expect(p.mine.reduce((s, el) => s + el.length, 0), `leg at port ${p.port}`)
        .toBeCloseTo(crossingEndDistance(kr9), 3)
    }
    const byId = Object.fromEntries(tracks.map(tr => [tr.id, tr]))
    const routes = crossingRoutesFromTracks(sw, byId)
    expect(routes).not.toBeNull()
    // The crossing point is where the click put it: station 50 along the host.
    const expected = endPointStraightUtm(HOST_START, HOST_BEARING, 50)
    expect(routes.centre.easting).toBeCloseTo(expected.easting, 6)
    expect(routes.centre.northing).toBeCloseTo(expected.northing, 6)
    expect(routes.mainBearing).toBeCloseTo(HOST_BEARING, 6)
    expect(routes.crossBearing).toBeCloseTo((HOST_BEARING + alpha) % 360, 6)
    expect(routes.main.reduce((s, r) => s + r.length, 0)).toBeCloseTo(crossingEndDistance(kr9), 3)
    expect(routes.cross.reduce((s, r) => s + r.length, 0)).toBeCloseTo(crossingEndDistance(kr9), 3)
    // The symbol rebuilds from the tracks alone.
    expect(rebuildSwitchSymbol(sw, byId).fillCoords).toHaveLength(2)
    expect(byPort.A.trackId).not.toBe(byPort.C.trackId)
  })

  it('places on a joint between two elements the same way', () => {
    const { sw, tracks } = commitCrossingOnTrack(hostTrack(), 60, kr9, alpha)
    const byId = Object.fromEntries(tracks.map(tr => [tr.id, tr]))
    const routes = crossingRoutesFromTracks(sw, byId)
    expect(routes).not.toBeNull()
    const expected = endPointStraightUtm(HOST_START, HOST_BEARING, 60)
    expect(routes.centre.easting).toBeCloseTo(expected.easting, 6)
    expect(routes.centre.northing).toBeCloseTo(expected.northing, 6)
  })

  it('deleting it: both routes carry a line — both stay, unmarked', () => {
    const { sw, tracks } = commitCrossingOnTrack(hostTrack(), 50, kr9, alpha, 20)
    const plan = planSwitchDeletion(sw, tracks)
    expect(plan.reason).toBe('crossing_both')
    expect(plan.removeTrackIds).toEqual([])
    expect(plan.removedElements).toBe(0)
    expect(plan.updateTracks.map(tr => tr.id).sort())
      .toEqual([sw.portA_trackId, 'b', sw.portC_trackId, 'd'].sort())
    for (const tr of plan.updateTracks) {
      expect(tr.elements.some(el => el.switchBranch)).toBe(false)
    }
  })

  it('deleting it: bare cross legs go, the main line runs on', () => {
    const { sw, tracks } = commitCrossingOnTrack(hostTrack(), 50, kr9, alpha)
    const plan = planSwitchDeletion(sw, tracks)
    expect(plan.reason).toBe('crossing_one')
    expect(plan.removeTrackIds.sort()).toEqual(['b', 'd'].sort())
    // The main legs stay as ordinary track — the line runs on through the point.
    expect(plan.updateTracks.map(tr => tr.id).sort())
      .toEqual([sw.portA_trackId, sw.portC_trackId].sort())
    for (const tr of plan.updateTracks) {
      expect(tr.elements.some(el => el.switchBranch)).toBe(false)
    }
  })
})
