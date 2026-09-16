import { describe, it, expect } from 'vitest'
import { recalcAbsLengths, rebuildCoords } from '../storage'
import {
  computeStraightValuesUtm, computeCurvedValuesUtm, arcCoordsFromRadiusUtm,
  endPointStraightUtm, endPointCurvedUtm,
} from '../utils/elementUtils'
import { computeClothoidUtm } from '../utils/clothoidUtils'
import { SAGITTA_ELEMENT, SAGITTA_TRACK } from '../utils/mapConstants'
import { utmToWgs84 } from '../utils/coordinateUtils'
import {
  SWITCH_TYPES, computeSwitchGeometryUtm, switchRouteVaries, switchStraightLength,
} from '../utils/switchUtils'
import { dehydrateProjects, hydrateProjects } from '../utils/persistenceUtils'
import { expectValidTrack, expectNodesJoin, expectTangentsContinuous } from './chainInvariants'

/**
 * The audit of "create element" and "connect element": the chains those forms
 * commit, built here from the very calls their handleCommit makes, checked
 * against the invariant checklist. A form is React and its commit writes to the
 * store, so what is reproduced is the element data it writes — which is the part
 * the invariants are about.
 */

const EPSG = 25832
const START = { easting: 500000, northing: 5600000, zone: EPSG }
const toWgs = (utm) => utmToWgs84(utm.easting, utm.northing, utm.zone)

/** A track the way a create form saves one. */
const trackOf = (elements) => ({ id: 't1', epsg: EPSG, elements: recalcAbsLengths(elements) })

// ── The elements each form commits ──────────────────────────────────────────

/** CreateElementPanel/LineForm: one straight from two picked points. */
function lineFormElement(startUtm, endUtm) {
  const v = computeStraightValuesUtm(startUtm, endUtm)
  return {
    elementType: 0,
    startNode: v.startNode, endNode: v.endNode,
    bearing: v.bearing, length: v.length, absLength: v.length, speed: 100,
    geometry: { type: 'LineString', coordinates: [toWgs(startUtm), toWgs(endUtm)] },
  }
}

/** CreateElementPanel/CurvedLineForm: one arc through a fitted radius. */
function curvedLineFormElement(startUtm, endUtm, signedR) {
  const v = computeCurvedValuesUtm(startUtm, endUtm, signedR)
  const renderCoords  = arcCoordsFromRadiusUtm(startUtm, endUtm, signedR, SAGITTA_TRACK)
  const elementCoords = arcCoordsFromRadiusUtm(startUtm, endUtm, signedR, SAGITTA_ELEMENT)
  return {
    elementType: 1,
    startNode: v.startNode, endNode: v.endNode,
    bearing: v.bearing, endBearing: v.endBearing, length: v.length, absLength: v.length,
    radius: v.radius, cant: 80, speed: 100,
    geometry: { type: 'LineString', coordinates: elementCoords },
    renderCoords,
  }
}

/** The transition both connect forms put in front of what they append. */
function transitionElement(startUtm, bearing, length, r1, r2, transitionType = 'clothoid') {
  const cl  = computeClothoidUtm(startUtm, bearing, length, r1, r2, SAGITTA_ELEMENT, transitionType)
  const clR = computeClothoidUtm(startUtm, bearing, length, r1, r2, SAGITTA_TRACK, transitionType)
  return {
    element: {
      elementType: 2, transitionType,
      startNode: [startUtm.easting, startUtm.northing],
      endNode:   [cl.endUtm.easting, cl.endUtm.northing],
      bearing, endBearing: cl.endBearing, length, absLength: length, speed: 100,
      r1, r2,
      geometry: { type: 'LineString', coordinates: cl.coords },
      renderCoords: clR.coords,
    },
    endUtm: cl.endUtm,
    endBearing: cl.endBearing,
  }
}

/** ConnectElementPanel/ConnectStraightForm: a straight onto an end. */
function connectStraightElement(startUtm, bearing, length) {
  const endUtm = endPointStraightUtm(startUtm, bearing, length)
  const v = computeStraightValuesUtm(startUtm, endUtm)
  return {
    element: {
      elementType: 0,
      startNode: v.startNode, endNode: v.endNode,
      bearing: v.bearing, length: v.length, absLength: v.length, speed: 100,
      geometry: { type: 'LineString', coordinates: [toWgs(startUtm), toWgs(endUtm)] },
    },
    endUtm,
  }
}

/** ConnectElementPanel/ConnectCurvedForm: an arc onto an end. */
function connectCurvedElement(startUtm, bearing, arcLen, signedR) {
  const endUtm = endPointCurvedUtm(startUtm, bearing, arcLen, signedR)
  const v = computeCurvedValuesUtm(startUtm, endUtm, signedR)
  const fallback = [toWgs(startUtm), toWgs(endUtm)]
  return {
    element: {
      elementType: 1,
      startNode: v.startNode, endNode: v.endNode,
      bearing, endBearing: v.endBearing, length: arcLen, absLength: arcLen,
      radius: signedR, cant: 80, speed: 100,
      geometry: { type: 'LineString', coordinates: arcCoordsFromRadiusUtm(startUtm, endUtm, signedR, SAGITTA_ELEMENT) ?? fallback },
      renderCoords: arcCoordsFromRadiusUtm(startUtm, endUtm, signedR, SAGITTA_TRACK) ?? fallback,
    },
    endUtm,
  }
}

// ── The audit ───────────────────────────────────────────────────────────────

describe('create element', () => {
  it('LineForm commits a valid one-element track', () => {
    expectValidTrack(trackOf([lineFormElement(START, endPointStraightUtm(START, 42, 300))]))
  })

  it('CurvedLineForm commits a valid one-element track, either hand', () => {
    for (const signedR of [600, -600]) {
      const end = endPointCurvedUtm(START, 42, 250, signedR)
      expectValidTrack(trackOf([curvedLineFormElement(START, end, signedR)]))
    }
  })
})

describe('connect element — straight onto a curve, over a transition', () => {
  const R = -600
  const arc = curvedLineFormElement(START, endPointCurvedUtm(START, 20, 250, R), R)

  it('commits a chain that joins, runs tangentially and adds up', () => {
    const arcEnd = { easting: arc.endNode[0], northing: arc.endNode[1], zone: EPSG }
    const tr = transitionElement(arcEnd, arc.endBearing, 90, R, null)
    const straight = connectStraightElement(tr.endUtm, tr.endBearing, 400)
    expectValidTrack(trackOf([arc, tr.element, straight.element]))
  })

  it('the same with a Bloss transition', () => {
    const arcEnd = { easting: arc.endNode[0], northing: arc.endNode[1], zone: EPSG }
    const tr = transitionElement(arcEnd, arc.endBearing, 90, R, null, 'bloss')
    const straight = connectStraightElement(tr.endUtm, tr.endBearing, 400)
    expectValidTrack(trackOf([arc, tr.element, straight.element]))
  })
})

describe('connect element — arc onto a straight, over a transition', () => {
  it('commits a chain that joins, runs tangentially and adds up', () => {
    const straight = lineFormElement(START, endPointStraightUtm(START, 20, 300))
    const straightEnd = { easting: straight.endNode[0], northing: straight.endNode[1], zone: EPSG }
    const R = 800
    const tr = transitionElement(straightEnd, straight.bearing, 80, null, R)
    const arc = connectCurvedElement(tr.endUtm, tr.endBearing, 220, R)
    expectValidTrack(trackOf([straight, tr.element, arc.element]))
  })

  it('a reverse curve through the transition keeps its tangent', () => {
    const arc1 = curvedLineFormElement(START, endPointCurvedUtm(START, 20, 200, 700), 700)
    const arc1End = { easting: arc1.endNode[0], northing: arc1.endNode[1], zone: EPSG }
    const tr = transitionElement(arc1End, arc1.endBearing, 120, 700, -700)
    const arc2 = connectCurvedElement(tr.endUtm, tr.endBearing, 200, -700)
    expectValidTrack(trackOf([arc1, tr.element, arc2.element]))
  })
})

describe('the committed chain survives a reload unchanged', () => {
  it('dehydrate then hydrate gives back the same nodes, bearings and lengths', () => {
    const straight = lineFormElement(START, endPointStraightUtm(START, 20, 300))
    const straightEnd = { easting: straight.endNode[0], northing: straight.endNode[1], zone: EPSG }
    const tr  = transitionElement(straightEnd, straight.bearing, 80, null, 800)
    const arc = connectCurvedElement(tr.endUtm, tr.endBearing, 220, 800)
    const track = trackOf([straight, tr.element, arc.element])

    const [reloaded] = hydrateProjects(dehydrateProjects(structuredClone([{ id: 'p1', tracks: [track] }])))
    const back = reloaded.tracks[0]
    expectValidTrack(back)
    back.elements.forEach((el, i) => {
      expect(el.startNode).toEqual(track.elements[i].startNode)
      expect(el.endNode).toEqual(track.elements[i].endNode)
      expect(el.bearing).toBeCloseTo(track.elements[i].bearing, 9)
      expect(el.length).toBeCloseTo(track.elements[i].length, 9)
    })
  })
})

describe('the branch a switch dialog commits', () => {
  // SwitchOnTrackForm builds one element per piece of the branch chain. A
  // turnout laid across several elements of its host track gets several, and
  // that is the chain the invariants have to hold for.
  const form = SWITCH_TYPES[3]                     // 760 – 1:14

  const branchElements = (stem) => {
    const g = computeSwitchGeometryUtm(START, 30, form, 'right', false, null, stem)
    return {
      g,
      elements: recalcAbsLengths(g.branchSegments.map(seg => ({
        ...(switchRouteVaries(seg)
          ? { elementType: 2, transitionType: 'clothoid', r1: seg.r1, r2: seg.r2 }
          : { elementType: seg.r1 ? 1 : 0, ...(seg.r1 ? { radius: seg.r1 } : {}) }),
        startNode: [seg.startUtm.easting, seg.startUtm.northing],
        endNode:   [seg.endUtm.easting, seg.endUtm.northing],
        bearing: seg.bearing, endBearing: seg.endBearing, length: seg.length,
        geometry: { type: 'LineString', coordinates: seg.coords },
      }))),
    }
  }

  it('on a straight stem: one element, joining the toe exactly', () => {
    const { g, elements } = branchElements(null)
    expect(elements).toHaveLength(1)
    expect(elements[0].startNode).toEqual(g.portA)
    expect(elements[0].endNode).toEqual(g.portB1)
    expectNodesJoin(elements)
  })

  it('across a straight running into a clothoid and on into an arc: one element per piece', () => {
    const straightLen = switchStraightLength(form.R, form.ratio)
    const { elements } = branchElements([
      { length: straightLen * 0.3, r1: null, r2: null },
      { length: straightLen * 0.4, r1: null, r2: -900 },
      { length: straightLen * 0.6, r1: -900, r2: -900 },
    ])
    expect(elements.length).toBeGreaterThan(1)
    expectNodesJoin(elements)
    expectTangentsContinuous(elements, EPSG)
    expect(elements.some(el => el.elementType === 2)).toBe(true)
  })

  it('the branch runs the form’s own length however the stem is made up', () => {
    const straightLen = switchStraightLength(form.R, form.ratio)
    const { g, elements } = branchElements([
      { length: straightLen * 0.5, r1: null, r2: null },
      { length: straightLen * 0.9, r1: null, r2: -900 },
    ])
    const total = elements.reduce((sum, el) => sum + el.length, 0)
    expect(total).toBeCloseTo(g.arcLen, 6)
  })
})

describe('track.coordinates', () => {
  it('are taken from renderCoords where an element has them, not from the fine polyline', () => {
    // The two paths that build them — rebuildCoords on a commit and
    // buildTrackCoords on a reload — have to agree, or a track redraws at a
    // different density after a reload than it was committed at.
    const R = 600
    const arc = curvedLineFormElement(START, endPointCurvedUtm(START, 20, 250, R), R)
    const track = trackOf([arc])
    expect(rebuildCoords(track.elements)).toEqual(arc.renderCoords)

    const [reloaded] = hydrateProjects(dehydrateProjects(structuredClone([{ id: 'p1', tracks: [track] }])))
    expect(reloaded.tracks[0].coordinates).toEqual(reloaded.tracks[0].elements[0].renderCoords)
  })
})
