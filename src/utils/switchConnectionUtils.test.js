import { describe, it, expect } from 'vitest'
import {
  SWITCH_TYPES, solveSwitchConnection, computeSwitchConnections, buildConnectionElements,
} from './switchConnectionUtils'
import { switchArcLength, switchStraightLength, branchRadius } from './switchUtils'
import {
  arcCoordsFromRadiusUtm, bearingAfterUtm, computeCurvedValuesUtm, endPointCurvedUtm,
  endPointStraightUtm,
} from './elementUtils'
import { SAGITTA_ELEMENT, SAGITTA_TRACK } from './mapConstants'
import { newSwitchFields, switchElementMark } from './switchModel'
import { splitElementAt, carveSwitchRoute } from './trackSplitUtils'
import { planSwitchDeletion } from './switchDelete'
import { recalcAbsLengths } from '../storage'
import { expectValidTrack, expectSwitchRoutesCarved } from '../test/chainInvariants'

/**
 * AP 2.1 — the switch connection in a curve.
 *
 * The construction is checked against what it has to be, not against what it
 * was: both toes lie on their tracks, both ends meet their track tangentially,
 * and the three elements join. On two straights those conditions have a closed
 * form, which is what the first block asserts to the millimetre; in a curve they
 * are what the solver is solving, which is what the rest asserts.
 */

const EPSG  = 25832
const P     = (e, n) => ({ easting: e, northing: n, zone: EPSG })
const ORIGIN = P(500000, 5600000)
const FORM  = SWITCH_TYPES[2]          // 500 – 1:12, speed 60, minl 6
const SPEED = FORM.speed

/** Centre of a track's arc at a point: 90° right of the bearing for a positive radius. */
function centreOf(point, bearing, radius) {
  const rad = bearing * Math.PI / 180
  const sg  = radius >= 0 ? 1 : -1
  return {
    easting:  point.easting  + sg * Math.abs(radius) * Math.cos(rad),
    northing: point.northing - sg * Math.abs(radius) * Math.sin(rad),
  }
}

const distTo = (p, c) => Math.hypot(p.easting - c.easting, p.northing - c.northing)
const bearingDelta = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

/** Bearing of a track's tangent at a point on its arc, in the running direction. */
function tangentAt(point, centre, radius) {
  const aE = point.easting - centre.easting, aN = point.northing - centre.northing
  // Tangent is the radius turned 90°, the way the running direction goes.
  const tE = radius >= 0 ? aN : -aN
  const tN = radius >= 0 ? -aE : aE
  return (Math.atan2(tE, tN) * 180 / Math.PI + 360) % 360
}

// ── two straights: the closed-form case, to the millimetre ──────────────────

describe('two straight tracks', () => {
  const GAP = 4.5
  const g1 = { pointUtm: ORIGIN, bearing: 0, radius: null, cant: 0 }
  const g2 = { pointUtm: P(ORIGIN.easting - GAP, ORIGIN.northing), bearing: 0, radius: null, cant: 0 }

  it('builds the classical crossover: two form arcs and a straight between them', () => {
    const res = solveSwitchConnection(g1, g2, SPEED)
    expect(res.valid).toBe(true)
    expect(res.switchType.label).toBe(FORM.label)

    const w = Math.atan(1 / FORM.ratio)
    // Each branch arc offsets sideways by R(1 − cos w); the straight covers the rest.
    const perArc = FORM.R * (1 - Math.cos(w))
    const expectedLg = (GAP - 2 * perArc) / Math.sin(w)
    expect(res.Lg).toBeCloseTo(expectedLg, 6)
    expect(res.signedRg).toBeNull()                    // parallel tracks: a straight
    expect(res.delta).toBeCloseTo(0, 12)

    // Construction length along track 1.
    expect(res.laenge).toBeCloseTo(2 * FORM.R * Math.sin(w) + expectedLg * Math.cos(w), 6)
    expect(res.gap).toBeCloseTo(GAP, 9)
  })

  it('lands on track 2, running the way track 2 runs', () => {
    const res = solveSwitchConnection(g1, g2, SPEED)
    expect(res.TP2.easting).toBeCloseTo(g2.pointUtm.easting, 6)
    expect(res.TP1.easting).toBeCloseTo(g1.pointUtm.easting, 9)
    expect(res.bearing2).toBeCloseTo(180, 9)           // from TP2 back towards B2A
  })

  it('the branches are the form’s own radius, turned to the side track 2 is on', () => {
    const res = solveSwitchConnection(g1, g2, SPEED)
    expect(res.signedR1).toBe(-FORM.R)                 // track 2 to the left
    expect(res.signedR2).toBe(FORM.R)
    expect(res.L1).toBeCloseTo(switchArcLength(FORM.R, FORM.ratio), 12)
  })

  it('slides with the shift and keeps the same shape', () => {
    const a = solveSwitchConnection(g1, g2, SPEED, 0)
    const b = solveSwitchConnection(g1, g2, SPEED, 37)
    expect(b.valid).toBe(true)
    expect(b.Lg).toBeCloseTo(a.Lg, 9)
    expect(b.TP1.northing - a.TP1.northing).toBeCloseTo(37, 9)
    expect(b.TP2.northing - a.TP2.northing).toBeCloseTo(37, 6)
  })

  it('converging tracks give a middle arc that turns by the angle between them', () => {
    const skew = { ...g2, bearing: 1.5 }
    const res = solveSwitchConnection(g1, skew, SPEED)
    expect(res.valid).toBe(true)
    expect(res.delta).toBeCloseTo(-1.5 * Math.PI / 180, 9)   // bearing grows clockwise
    expect(res.signedRg).toBeCloseTo(-res.Lg / res.delta, 6)
  })

  it('refuses tracks too close for any form the speed offers', () => {
    // 2 m apart: even the flattest fallback form (1:14) needs more than that for
    // its two branch arcs alone, so no middle element is left.
    const tight = { ...g2, pointUtm: P(ORIGIN.easting - 2.0, ORIGIN.northing) }
    const res = solveSwitchConnection(g1, tight, SPEED)
    expect(res.valid).toBe(false)
    expect(res.reason).toBe('too_short')
  })
})

// ── two curves: what AP 2.1 adds ────────────────────────────────────────────

describe('two tracks in a curve', () => {
  const R1 = 1000, GAP = 4.5
  const CENTRE = centreOf(ORIGIN, 0, R1)
  const R2 = R1 + GAP                       // track 2 concentric, outside the curve
  const p2 = P(ORIGIN.easting - GAP, ORIGIN.northing)
  const CANT = 40

  const g1 = { pointUtm: ORIGIN, bearing: 0, radius: R1,  cant: CANT }
  const g2 = { pointUtm: p2,     bearing: 0, radius: R2,  cant: CANT }

  it('closes: both toes on their tracks, both ends tangential to them', () => {
    const res = solveSwitchConnection(g1, g2, SPEED)
    expect(res.valid).toBe(true)

    // TP1 is the pick itself (shift 0) and TP2 has to sit on track 2's arc.
    expect(distTo(res.TP1, CENTRE)).toBeCloseTo(R1, 6)
    expect(distTo(res.TP2, CENTRE)).toBeCloseTo(R2, 5)

    // …and leave along track 2, not across it.
    const want = tangentAt(res.TP2, CENTRE, R2)
    expect(bearingDelta((res.bearing2 + 180) % 360, want)).toBeLessThan(1e-6)

    // The spacing of two concentric tracks is the difference of their radii.
    expect(res.gap).toBeCloseTo(GAP, 9)
  })

  it('bends both turnouts into their own track — one opens out, one draws in', () => {
    const res = solveSwitchConnection(g1, g2, SPEED)
    // κ_branch = κ_stem + κ_form, per branchRadius, on each track's own curvature.
    expect(res.signedR1).toBeCloseTo(branchRadius(-FORM.R, R1), 9)
    expect(res.signedR2).toBeCloseTo(-branchRadius(-FORM.R, -R2), 9)
    // The inner track's turnout opens away from the centre, the outer one draws in.
    expect(Math.abs(res.signedR2)).toBeLessThan(Math.abs(res.signedR1))
  })

  it('carries the cant of the tracks it joins', () => {
    const res = solveSwitchConnection(g1, g2, SPEED)
    expect(res.cant1).toBe(CANT)
    expect(res.cant2).toBe(CANT)
    expect(res.cantMid).toBe(CANT)
    // The check that used to read a bare 0 there now reads the real value: the
    // branch curving against the cant is the one that binds.
    expect(res.branchCantDef).toBeGreaterThan(0)
  })

  it('refuses two tracks whose cant differs — that needs a ramp, not an arc', () => {
    const res = solveSwitchConnection(g1, { ...g2, cant: CANT + 5 }, SPEED)
    expect(res.valid).toBe(false)
    expect(res.reason).toBe('cant_mismatch')
  })

  it('refuses a cant a turnout may not carry (AP 1.1)', () => {
    const res = solveSwitchConnection({ ...g1, cant: 120 }, { ...g2, cant: 120 }, SPEED)
    expect(res.valid).toBe(false)
    expect(res.reason).toBe('cant_over')
  })

  it('refuses where the bent branch is too sharp for the speed', () => {
    // The same curve without any cant: the drawn-in branch runs out of deficiency.
    const res = solveSwitchConnection({ ...g1, cant: 0 }, { ...g2, cant: 0 }, SPEED)
    expect(res.valid).toBe(false)
    expect(res.reason).toBe('branch_too_sharp')
  })

  it('slides along the curve with the shift', () => {
    const a = solveSwitchConnection(g1, g2, SPEED, 0)
    const b = solveSwitchConnection(g1, g2, SPEED, 60)
    expect(b.valid).toBe(true)
    expect(distTo(b.TP1, CENTRE)).toBeCloseTo(R1, 6)
    expect(distTo(b.TP2, CENTRE)).toBeCloseTo(R2, 5)
    // The toe moved 60 m along the arc, not 60 m along the tangent.
    const sweep = 60 / R1
    expect(Math.hypot(b.TP1.easting - a.TP1.easting, b.TP1.northing - a.TP1.northing))
      .toBeCloseTo(2 * R1 * Math.sin(sweep / 2), 6)
  })

  it('works the other way round too — from the outer track to the inner one', () => {
    const res = solveSwitchConnection(g2, g1, SPEED)
    expect(res.valid).toBe(true)
    expect(distTo(res.TP1, CENTRE)).toBeCloseTo(R2, 6)
    expect(distTo(res.TP2, CENTRE)).toBeCloseTo(R1, 5)
  })

  it('takes a track digitised against the other', () => {
    const backwards = { ...g2, bearing: 180, radius: -R2, cant: -CANT }
    const res = solveSwitchConnection(g1, backwards, SPEED)
    expect(res.valid).toBe(true)
    expect(distTo(res.TP2, CENTRE)).toBeCloseTo(R2, 5)
  })
})

// ── a straight against a curve falls out of the same construction ───────────

describe('one straight track and one curved', () => {
  it('closes on the curve it has to meet', () => {
    const R2 = 4000
    const p2 = P(ORIGIN.easting - 4.5, ORIGIN.northing)
    const centre = centreOf(p2, 0, R2)
    const g1 = { pointUtm: ORIGIN, bearing: 0, radius: null, cant: 0 }
    const g2 = { pointUtm: p2, bearing: 0, radius: R2, cant: 0 }
    const res = solveSwitchConnection(g1, g2, SPEED)
    expect(res.valid).toBe(true)
    expect(distTo(res.TP2, centre)).toBeCloseTo(R2, 5)
    expect(bearingDelta((res.bearing2 + 180) % 360, tangentAt(res.TP2, centre, R2)))
      .toBeLessThan(1e-6)
  })
})

// ── the elements ────────────────────────────────────────────────────────────

describe('the three elements of a connection', () => {
  const asTrack = (res) => {
    const { arc1El, midEl, arc2El } = buildConnectionElements(res, SPEED)
    const elements = recalcAbsLengths([arc1El, midEl, arc2El])
    return { id: 't', epsg: EPSG, elements }
  }

  it('join and run tangentially on two straights', () => {
    const g1 = { pointUtm: ORIGIN, bearing: 0, radius: null, cant: 0 }
    const g2 = { pointUtm: P(ORIGIN.easting - 4.5, ORIGIN.northing), bearing: 0, radius: null, cant: 0 }
    const track = asTrack(solveSwitchConnection(g1, g2, SPEED))
    expectValidTrack(track)
    expect(track.elements.map(el => el.elementType)).toEqual([1, 0, 1])
    expect(track.elements.every(el => el.cant === undefined)).toBe(true)
  })

  it('join and run tangentially in a curve, carrying the cant', () => {
    const R1 = 1000
    const g1 = { pointUtm: ORIGIN, bearing: 0, radius: R1, cant: 40 }
    const g2 = { pointUtm: P(ORIGIN.easting - 4.5, ORIGIN.northing), bearing: 0, radius: R1 + 4.5, cant: 40 }
    const res = solveSwitchConnection(g1, g2, SPEED)
    expect(res.valid).toBe(true)
    const track = asTrack(res)
    expectValidTrack(track)
    expect(track.elements.map(el => el.cant)).toEqual([40, 40, 40])
  })

  it('the through length a turnout of the connection needs comes back with it', () => {
    const g1 = { pointUtm: ORIGIN, bearing: 0, radius: null, cant: 0 }
    const g2 = { pointUtm: P(ORIGIN.easting - 4.5, ORIGIN.northing), bearing: 0, radius: null, cant: 0 }
    const res = solveSwitchConnection(g1, g2, SPEED)
    expect(res.throughLength).toBeCloseTo(switchStraightLength(FORM.R, FORM.ratio), 12)
  })
})

// ── the speed table the dropdown reads ──────────────────────────────────────

describe('computeSwitchConnections', () => {
  it('reports one entry per primary form', () => {
    const g1 = { pointUtm: ORIGIN, bearing: 0, radius: null, cant: 0 }
    const g2 = { pointUtm: P(ORIGIN.easting - 4.5, ORIGIN.northing), bearing: 0, radius: null, cant: 0 }
    const list = computeSwitchConnections(g1, g2)
    expect(list).toHaveLength(SWITCH_TYPES.length)
    expect(list.map(e => e.speed)).toEqual(SWITCH_TYPES.map(s => s.speed))
    expect(list.some(e => e.valid)).toBe(true)
  })
})

// ── the connection as the dialog commits it ─────────────────────────────────

describe('committing a connection in a curve', () => {
  const R1 = 1000, GAP = 4.5, CANT = 40
  const CENTRE = centreOf(ORIGIN, 0, R1)
  const R2 = R1 + GAP

  /** One arc track, the way a create form saves one. */
  const arcTrack = (id, name, start, bearing, radius, length, cant) => {
    const end = endPointCurvedUtm(start, bearing, length, radius)
    const v = computeCurvedValuesUtm(start, end, radius)
    const el = {
      elementType: 1,
      startNode: v.startNode, endNode: v.endNode,
      bearing: v.bearing, endBearing: v.endBearing,
      length: v.length, absLength: v.length,
      radius, cant, speed: SPEED,
      geometry: { type: 'LineString', coordinates: arcCoordsFromRadiusUtm(start, end, radius, SAGITTA_ELEMENT) },
      renderCoords: arcCoordsFromRadiusUtm(start, end, radius, SAGITTA_TRACK),
    }
    return { id, name, epsg: EPSG, elements: [el], coordinates: el.renderCoords }
  }

  /** The pick the dialog's click handler makes, at `along` metres into the element. */
  const pickAt = (track, along) => {
    const el = track.elements[0]
    const start = { easting: el.startNode[0], northing: el.startNode[1], zone: EPSG }
    return {
      pointUtm: endPointCurvedUtm(start, el.bearing, along, el.radius),
      bearing: bearingAfterUtm(el.bearing, along, el.radius),
      radius: el.radius, cant: el.cant,
    }
  }

  /** What SCurveForm.handleCommit builds, without the store or React. */
  const commit = (t1, t2, res) => {
    const names = new Set([t1.name, t2.name])
    const id1 = { ...newSwitchFields(), name: 'W 1', label: res.switchType.label }
    const id2 = { ...newSwitchFields(), name: 'W 2', label: res.switchType.label }

    const s1 = splitElementAt(t1, 0, res.TP1, res.bearing1, names)
    const s2 = splitElementAt(t2, 0, res.TP2, res.bearing2, names)
    const carve = (split, cut, mark) => {
      const carved = carveSwitchRoute(split.ahead, split.aheadEndpoint, cut, mark, res.throughLength,
        { accepts: (el) => el.elementType !== 2 })
      expect(carved, 'the through route carves').not.toBeNull()
      return split.tracks.map(tr => (tr.id === carved.id ? carved : tr))
    }
    // The switch end of each through route: the turnout's own through length
    // laid on the curvature of the track it sits in — what buildJunctionSwitch
    // reads off computeSwitchGeometryUtm as `straightUtm`. Turnout 2 opens
    // against the connection, so its stem turns the other way under it.
    const alongStem = (p, bearing, len, R) => (R
      ? endPointCurvedUtm(p, bearing, len, R)
      : endPointStraightUtm(p, bearing, len))
    const end1 = alongStem(res.TP1, res.bearing1, res.throughLength, res.stemR1)
    const end2 = alongStem(res.TP2, res.bearing2, res.throughLength,
      res.stemR2 == null ? null : -res.stemR2)

    const { arc1El, midEl, arc2El } = buildConnectionElements(res, SPEED)
    const connElements = recalcAbsLengths([
      { ...arc1El, ...switchElementMark(id1, 'branch') },
      midEl,
      { ...arc2El, ...switchElementMark(id2, 'branch') },
    ])
    const connTrack = { id: 'conn', name: 'connection.001', epsg: EPSG, elements: connElements }

    const tracks = [
      ...carve(s1, end1, switchElementMark(id1, 'main')),
      ...carve(s2, end2, switchElementMark(id2, 'main')),
      connTrack,
    ]
    const sw1 = {
      ...id1, speed: SPEED, trailing: false,
      portA_trackId: s1.behind.id, portA_endpoint: s1.behindEndpoint,
      portB1_trackId: connTrack.id, portB1_endpoint: 'BEGIN',
      portB2_trackId: s1.ahead.id, portB2_endpoint: s1.aheadEndpoint,
    }
    const sw2 = {
      ...id2, speed: SPEED, trailing: false,
      portA_trackId: s2.behind.id, portA_endpoint: s2.behindEndpoint,
      portB1_trackId: connTrack.id, portB1_endpoint: 'END',
      portB2_trackId: s2.ahead.id, portB2_endpoint: s2.aheadEndpoint,
    }
    return { tracks, switches: [sw1, sw2] }
  }

  it('gives four half-tracks and a connection that all hold together', () => {
    const t1 = arcTrack('t1', 'line.001', ORIGIN, 0, R1, 600, CANT)
    const t2 = arcTrack('t2', 'line.002', P(ORIGIN.easting - GAP, ORIGIN.northing), 0, R2, 600, CANT)
    const res = solveSwitchConnection(pickAt(t1, 150), pickAt(t2, 150), SPEED)
    expect(res.valid).toBe(true)

    const { tracks, switches } = commit(t1, t2, res)
    tracks.forEach(track => { if (track.elements.length) expectValidTrack(track) })

    // Both turnouts have their two routes as elements of their own (AP 1.3) …
    switches.forEach(sw => expectSwitchRoutesCarved(sw, tracks))
    // … and the delete rules read them back (AP 1.2).
    switches.forEach(sw => {
      const plan = planSwitchDeletion(sw, tracks)
      expect(plan.reason).toBe('through')
      expect(plan.removedElements).toBeGreaterThan(0)
    })
  })

  it('the connection track still starts and ends on the two line tracks', () => {
    const t1 = arcTrack('t1', 'line.001', ORIGIN, 0, R1, 600, CANT)
    const t2 = arcTrack('t2', 'line.002', P(ORIGIN.easting - GAP, ORIGIN.northing), 0, R2, 600, CANT)
    const res = solveSwitchConnection(pickAt(t1, 150), pickAt(t2, 150), SPEED)
    const { tracks } = commit(t1, t2, res)
    const conn = tracks.find(tr => tr.id === 'conn')
    const first = conn.elements[0], last = conn.elements[conn.elements.length - 1]
    expect(distTo(P(first.startNode[0], first.startNode[1]), CENTRE)).toBeCloseTo(R1, 5)
    expect(distTo(P(last.endNode[0], last.endNode[1]), CENTRE)).toBeCloseTo(R2, 5)
  })
})
