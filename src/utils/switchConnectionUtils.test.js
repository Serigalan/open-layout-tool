import { describe, it, expect } from 'vitest'
import {
  SWITCH_TYPES, CONNECTION_SPEEDS, solveSwitchConnection, computeSwitchConnections,
  buildConnectionElements,
} from './switchConnectionUtils'
import {
  switchArcLength, switchStraightLength, switchBranchLength, branchRadius,
} from './switchUtils'
import {
  arcCoordsFromRadiusUtm, computeCurvedValuesUtm, endPointCurvedUtm, endPointStraightUtm,
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
const FORM  = SWITCH_TYPES.find(f => f.label === '500 – 1:12')   // speed 60, minl 6
const SPEED = FORM.speed


/**
 * A stem as the dialog hands one over: the element's start node and tangent, the
 * route it describes, and the station the pick sits at. The tests pick at the
 * element's start unless they say otherwise, so `startUtm` is the pick.
 */
const stem = (point, bearing, radius, cant = 0, extra = {}) => ({
  startUtm: point,
  bearing,
  route: { length: extra.length ?? 2000, r1: radius ?? null, r2: (extra.r2 ?? radius) ?? null },
  along: extra.along ?? 0,
  cantStart: cant,
  cantEnd: extra.cantEnd ?? cant,
})

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
  const g1 = stem(ORIGIN, 0, null)
  const g2 = stem(P(ORIGIN.easting - GAP, ORIGIN.northing), 0, null)

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
    expect(res.TP2.easting).toBeCloseTo(g2.startUtm.easting, 6)
    expect(res.TP1.easting).toBeCloseTo(g1.startUtm.easting, 9)
    expect(res.bearing2).toBeCloseTo(180, 9)           // from TP2 back towards B2A
  })

  it('the branches are the form’s own radius, turned to the side track 2 is on', () => {
    const res = solveSwitchConnection(g1, g2, SPEED)
    expect(res.signedR1).toBe(-FORM.R)                 // track 2 to the left
    expect(res.signedR2).toBe(FORM.R)
    expect(res.L1).toBeCloseTo(switchArcLength(FORM.R, FORM.ratio), 12)   // one arc, no end piece
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
    // Wider than GAP: converging tracks close some of the gap over the length of
    // the connection, and the forms are their full built length (AP 3.1).
    const skew = stem(P(ORIGIN.easting - 7, ORIGIN.northing), 1.5, null)
    const res = solveSwitchConnection(g1, skew, SPEED)
    expect(res.valid).toBe(true)
    expect(res.delta).toBeCloseTo(-1.5 * Math.PI / 180, 9)   // bearing grows clockwise
    expect(res.signedRg).toBeCloseTo(-res.Lg / res.delta, 6)
  })

  it('refuses tracks too close for any form the speed offers', () => {
    // 2 m apart: even the flattest fallback form (1:14) needs more than that for
    // its two branch arcs alone, so no middle element is left.
    const tight = stem(P(ORIGIN.easting - 2.0, ORIGIN.northing), 0, null)
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

  const g1 = stem(ORIGIN, 0, R1, CANT)
  const g2 = stem(p2,      0, R2, CANT)

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
    expect(res.cant1Start).toBe(CANT)
    expect(res.cant1End).toBe(CANT)
    expect(res.cant2Start).toBe(CANT)
    expect(res.cant2End).toBe(CANT)
    expect(res.cantMid).toBe(CANT)
    // The check that used to read a bare 0 there now reads the real value: the
    // branch curving against the cant is the one that binds.
    expect(res.branchCantDef).toBeGreaterThan(0)
  })

  it('refuses two tracks whose cant differs — that needs a ramp, not an arc', () => {
    const res = solveSwitchConnection(g1, stem(p2, 0, R2, CANT + 5), SPEED)
    expect(res.valid).toBe(false)
    expect(res.reason).toBe('cant_mismatch')
  })

  it('refuses a cant a turnout may not carry (AP 1.1)', () => {
    const res = solveSwitchConnection(stem(ORIGIN, 0, R1, 120), stem(p2, 0, R2, 120), SPEED)
    expect(res.valid).toBe(false)
    expect(res.reason).toBe('cant_over')
  })

  it('refuses where the bent branch is too sharp for the speed', () => {
    // The same curve without any cant: the drawn-in branch runs out of deficiency.
    const res = solveSwitchConnection(stem(ORIGIN, 0, R1, 0), stem(p2, 0, R2, 0), SPEED)
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
    const backwards = stem(p2, 180, -R2, -CANT)
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
    const g1 = stem(ORIGIN, 0, null)
    const g2 = stem(p2, 0, R2)
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
    const { branch1, midEl, branch2 } = buildConnectionElements(res, SPEED)
    const elements = recalcAbsLengths([...branch1, midEl, ...branch2])
    return { id: 't', epsg: EPSG, elements }
  }

  it('join and run tangentially on two straights', () => {
    const track = asTrack(solveSwitchConnection(
      stem(ORIGIN, 0, null), stem(P(ORIGIN.easting - 4.5, ORIGIN.northing), 0, null), SPEED))
    expectValidTrack(track)
    expect(track.elements.map(el => el.elementType)).toEqual([1, 0, 1])
    expect(track.elements.every(el => el.cant === undefined)).toBe(true)
  })

  it('join and run tangentially in a curve, carrying the cant', () => {
    const R1 = 1000
    const res = solveSwitchConnection(
      stem(ORIGIN, 0, R1, 40), stem(P(ORIGIN.easting - 4.5, ORIGIN.northing), 0, R1 + 4.5, 40), SPEED)
    expect(res.valid).toBe(true)
    const track = asTrack(res)
    expectValidTrack(track)
    expect(track.elements.map(el => el.cant)).toEqual([40, 40, 40])
  })

  it('the through length a turnout of the connection needs comes back with it', () => {
    const res = solveSwitchConnection(
      stem(ORIGIN, 0, null), stem(P(ORIGIN.easting - 4.5, ORIGIN.northing), 0, null), SPEED)
    expect(res.throughLength).toBeCloseTo(switchStraightLength(FORM), 12)
  })
})

// ── the speed table the dropdown reads ──────────────────────────────────────

describe('computeSwitchConnections', () => {
  it('reports every speed once, however many forms it has', () => {
    const list = computeSwitchConnections(
      stem(ORIGIN, 0, null), stem(P(ORIGIN.easting - 4.5, ORIGIN.northing), 0, null))
    expect(list.map(e => e.speed)).toEqual(CONNECTION_SPEEDS)
    expect(new Set(list.map(e => e.speed)).size).toBe(list.length)
    // 40 km/h has two forms in the table and is still one entry here.
    expect(SWITCH_TYPES.filter(f => f.speed === 40).length).toBe(2)
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
    return stem(start, el.bearing, el.radius, el.cant, { length: el.length, along })
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

    const { branch1, midEl, branch2 } = buildConnectionElements(res, SPEED)
    const connElements = recalcAbsLengths([
      ...branch1.map(el => ({ ...el, ...switchElementMark(id1, 'branch') })),
      midEl,
      ...branch2.map(el => ({ ...el, ...switchElementMark(id2, 'branch') })),
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

// ── AP 2.2: the combinations of base elements the ToDo lists ────────────────

describe('the two tracks need not be the same kind of element', () => {
  const at = (p, dE) => P(p.easting + dE, p.northing)

  it('arc against arc, same sense, different radii', () => {
    const res = solveSwitchConnection(
      stem(ORIGIN, 0, 1000, 40), stem(at(ORIGIN, -4.5), 0, 1200, 40), SPEED)
    expect(res.valid).toBe(true)
    expect(res.signedR1).not.toBeCloseTo(res.signedR2, 3)   // one bent each way
  })

  it('arc against arc, opposite sense', () => {
    const res = solveSwitchConnection(
      stem(ORIGIN, 0, 3000, 0), stem(at(ORIGIN, -4.5), 0, -3000, 0), SPEED)
    expect(res.valid).toBe(true)
    // The tracks bend apart, so the element between the branches has to turn.
    expect(Math.abs(res.delta)).toBeGreaterThan(0)
  })

  it('arc against straight, either way round', () => {
    const a = solveSwitchConnection(stem(ORIGIN, 0, 2500, 0), stem(at(ORIGIN, -4.5), 0, null), SPEED)
    const b = solveSwitchConnection(stem(ORIGIN, 0, null), stem(at(ORIGIN, -4.5), 0, 2500, 0), SPEED)
    expect(a.valid).toBe(true)
    expect(b.valid).toBe(true)
  })

  it('a transition curve carries a turnout, and its branch is one too', () => {
    // Curvature runs under the first turnout, so its branch is a clothoid of the
    // stem's own parameter (switchBranchRoute) rather than an arc.
    const clothoid = stem(ORIGIN, 0, null, 0, { length: 300, r2: -2000, along: 100 })
    const res = solveSwitchConnection(clothoid, stem(at(ORIGIN, -7), 0, null), SPEED)
    expect(res.valid).toBe(true)
    expect(res.chain1[0].r1).not.toBe(res.chain1[0].r2)
    expect(res.chain2[0].r1).toBe(res.chain2[0].r2)    // track 2 is straight

    const { branch1, midEl, branch2 } = buildConnectionElements(res, SPEED)
    expect(branch1[0].elementType).toBe(2)
    expect(branch1[0].transitionType).toBe('clothoid')
    expect(midEl.elementType).toBeLessThan(2)
    expect(branch2[branch2.length - 1].elementType).toBe(1)
    expectValidTrack({ id: 't', epsg: EPSG, elements: recalcAbsLengths([...branch1, midEl, ...branch2]) })
  })

  it('…and refuses one whose cant ramps across the connection', () => {
    // The middle element can carry one cant, and here the two ends it joins do
    // not agree on it. That needs a ramp on an element this construction does
    // not build (AP 4.1).
    const ramping = stem(ORIGIN, 0, null, 0, { length: 300, r2: -2000, along: 100, cantEnd: 60 })
    const res = solveSwitchConnection(ramping, stem(at(ORIGIN, -7), 0, null, 0), SPEED)
    expect(res.valid).toBe(false)
    expect(res.reason).toBe('cant_mismatch')
  })

  it('the branch over a ramp carries the ramp, not one value', () => {
    // Where the cant does run under a turnout, the branch states both ends —
    // which is what a transition element is for (AP 1.1's rule for a turnout in
    // a cant ramp).
    const ramping = stem(ORIGIN, 0, null, 20, { length: 300, r2: -2000, along: 100, cantEnd: 60 })
    const res = solveSwitchConnection(ramping, stem(at(ORIGIN, -7), 0, null, 0), SPEED)
    expect(res.cant1Start).not.toBe(res.cant1End)
    const { branch1 } = buildConnectionElements(res, SPEED)
    expect(branch1[0].cantStart).toBe(res.cant1Start)
    expect(branch1[branch1.length - 1].cantEnd).toBe(res.cant1End)
  })
})

/**
 * AP 3.1 — a form whose branch ends in a straight piece. The connection is two
 * turnouts of one form, so the end piece is part of what it builds: the branch
 * is no longer one element, and the middle element starts where the straight
 * end stops, not where the arc does.
 */
describe('a connection built from a form with a straight end piece', () => {
  const FORM_40 = SWITCH_TYPES.find(f => f.label === '190 – 1:9')
  const g1 = stem(ORIGIN, 0, null)
  const g2 = stem(P(ORIGIN.easting - 4.5, ORIGIN.northing), 0, null)
  const res = solveSwitchConnection(g1, g2, 40)

  it('settles on the flatter of the two forms that speed offers', () => {
    expect(res.valid).toBe(true)
    expect(res.switchType.label).toBe('190 – 1:9')
  })

  it('runs the branch the form’s whole length, arc and end piece', () => {
    expect(res.L1).toBeCloseTo(switchBranchLength(FORM_40), 12)
    expect(res.L1).toBeCloseTo(switchArcLength(FORM_40.R, FORM_40.ratio) + 6.092, 12)
  })

  it('needs the form’s whole building length of through route', () => {
    expect(res.throughLength).toBeCloseTo(switchStraightLength(FORM_40), 12)
    expect(res.throughLength).toBeCloseTo(27.14, 2)      // the DB building length
  })

  it('builds the branch as two elements — the form’s arc, then its straight end', () => {
    const { branch1, midEl, branch2 } = buildConnectionElements(res, 40)
    expect(branch1).toHaveLength(2)
    expect(branch1[0].radius).toBe(res.signedR1)
    expect(branch1[0].length).toBeCloseTo(switchArcLength(FORM_40.R, FORM_40.ratio), 9)
    expect(branch1[1].elementType).toBe(0)               // the end piece, on a straight stem
    expect(branch1[1].length).toBeCloseTo(6.092, 9)
    // Turnout 2 opens against the connection, so its branch runs end piece first.
    expect(branch2).toHaveLength(2)
    expect(branch2[0].elementType).toBe(0)
    expect(branch2[1].radius).toBe(res.signedR2)
    expect(midEl.length).toBeCloseTo(res.Lg, 6)
  })

  it('gives a chain that joins, runs tangentially and adds up', () => {
    const { branch1, midEl, branch2 } = buildConnectionElements(res, 40)
    const elements = recalcAbsLengths([...branch1, midEl, ...branch2])
    expectValidTrack({ id: 'conn', epsg: EPSG, elements })
    expect(elements).toHaveLength(5)
  })

  it('falls back to the sharper form where the flatter one has no room', () => {
    const tight = solveSwitchConnection(g1, stem(P(ORIGIN.easting - 4, ORIGIN.northing), 0, null), 40)
    expect(tight.switchType.label).toBe('190 – 1:7.5')
  })
})
