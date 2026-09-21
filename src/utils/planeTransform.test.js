import { describe, it, expect } from 'vitest'
import { transformElement, transformTrackToPlane } from './planeTransform'
import { transformPlanePoint } from './coordinateUtils'
import {
  endPointStraightUtm, endPointCurvedUtm, computeCurvedValuesUtm,
} from './elementUtils'
import { computeClothoidUtm } from './clothoidUtils'

/**
 * Carrying an alignment into another plane. The one thing that must hold is
 * that an element still runs from its start node to its end node — so every
 * test here walks the moved element from its own start with its own bearing,
 * length and radii, and asks where it comes out.
 */

const FROM = 5678        // DHDN / GK zone 4
const SAME = 5684        // DB_REF / GK zone 4 — datum only
const ZONE = 5683        // DB_REF / GK zone 3 — datum and a 2.59 gon turn of grid north
const START = { easting: 4461843.4865, northing: 5334777.1542, zone: FROM }

/** Where an element actually ends, walked from its own start node. */
function walk(el, epsg) {
  const start = { easting: el.startNode[0], northing: el.startNode[1], zone: epsg }
  if (el.elementType === 2 && el.r1 !== undefined) {
    return computeClothoidUtm(start, el.bearing, el.length, el.r1, el.r2 ?? null, 1, el.transitionType).endUtm
  }
  if (el.radius) return endPointCurvedUtm(start, el.bearing, el.length, el.radius)
  return endPointStraightUtm(start, el.bearing, el.length)
}

const missBy = (el, epsg) => {
  const end = walk(el, epsg)
  return Math.hypot(end.easting - el.endNode[0], end.northing - el.endNode[1])
}

const straight = (start, bearing, length) => {
  const end = endPointStraightUtm(start, bearing, length)
  return {
    el: {
      elementType: 0, bearing, length, endBearing: bearing,
      startNode: [start.easting, start.northing], endNode: [end.easting, end.northing],
    },
    end,
  }
}

const arc = (start, bearing, length, radius) => {
  const end = endPointCurvedUtm(start, bearing, length, radius)
  const v = computeCurvedValuesUtm(start, end, radius)
  return {
    el: {
      elementType: 1, bearing, length, radius, endBearing: v.endBearing,
      startNode: [start.easting, start.northing], endNode: [v.endNode[0], v.endNode[1]],
    },
    end: { easting: v.endNode[0], northing: v.endNode[1], zone: start.zone },
  }
}

const transition = (start, bearing, length, r1, r2) => {
  const cl = computeClothoidUtm(start, bearing, length, r1, r2, 1, 'clothoid')
  return {
    el: {
      elementType: 2, transitionType: 'clothoid', bearing, length, r1, r2,
      endBearing: cl.endBearing,
      startNode: [start.easting, start.northing], endNode: [cl.endUtm.easting, cl.endUtm.northing],
    },
    end: cl.endUtm,
  }
}

/** A chain of the three kinds, each starting where the last one ended. */
function chain() {
  const a = straight(START, 40, 500)
  const b = arc(a.end, 40, 300, 1200)
  const c = transition(b.end, b.el.endBearing, 120, 1200, null)
  return [a.el, b.el, c.el]
}

describe('one element in another plane', () => {
  for (const [name, make] of [
    ['a straight',   () => straight(START, 40, 500).el],
    ['an arc',       () => arc(START, 40, 300, 1200).el],
    ['a transition', () => transition(START, 40, 120, 1200, null).el],
  ]) {
    describe(name, () => {
      for (const [where, target] of [['with the datum alone', SAME], ['across a zone as well', ZONE]]) {
        it(`still runs from its start node to its end node, ${where}`, () => {
          const moved = transformElement(make(), FROM, target)
          expect(missBy(moved, target)).toBeLessThan(1e-4)
        })
      }

      it('puts both nodes exactly where the transformation puts them', () => {
        const el = make()
        const moved = transformElement(el, FROM, ZONE)
        expect(moved.startNode).toEqual(transformPlanePoint(el.startNode[0], el.startNode[1], FROM, ZONE))
        expect(moved.endNode).toEqual(transformPlanePoint(el.endNode[0], el.endNode[1], FROM, ZONE))
      })

      it('scales its length and its radii by the one ratio its chord changed by', () => {
        const el = make()
        const moved = transformElement(el, FROM, ZONE)
        const k = moved.length / el.length
        // A zone this far off its central meridian stretches the plane.
        expect(k).toBeGreaterThan(1.0002)
        if (el.radius != null) expect(moved.radius / el.radius).toBeCloseTo(k, 9)
        if (el.r1 != null) expect(moved.r1 / el.r1).toBeCloseTo(k, 9)
      })

      it('turns through the same angle it turned through before', () => {
        const el = make()
        const moved = transformElement(el, FROM, ZONE)
        const turn = (a, b) => ((b - a + 540) % 360) - 180
        expect(turn(moved.bearing, moved.endBearing)).toBeCloseTo(turn(el.bearing, el.endBearing), 9)
      })
    })
  }

  it('keeps the sign of a radius — the side it bends to does not change', () => {
    const left = transformElement(arc(START, 40, 300, -1200).el, FROM, ZONE)
    expect(left.radius).toBeLessThan(0)
  })

  it('has nothing to say about an element without nodes', () => {
    expect(transformElement({ bearing: 0, length: 10 }, FROM, ZONE)).toBe(null)
  })
})

describe('what the move would cost if the bearing were simply kept', () => {
  it('is a fraction of a millimetre within a zone and tens of metres across one', () => {
    const el = straight(START, 40, 500).el
    const kept = (target) => {
      const [se, sn] = transformPlanePoint(el.startNode[0], el.startNode[1], FROM, target)
      const [ee, en] = transformPlanePoint(el.endNode[0], el.endNode[1], FROM, target)
      return missBy({ ...el, startNode: [se, sn], endNode: [ee, en] }, target)
    }
    // Within a zone only the datum moves, and it moves both nodes nearly
    // alike, so what is left is small — but it is not nothing, and over the
    // kilometre-long elements of a real database it reaches two centimetres.
    expect(kept(SAME)).toBeGreaterThan(1e-4)
    // Across a zone grid north turns by 2.59 gon, and half a kilometre of
    // track swings by tens of metres.
    expect(kept(ZONE)).toBeGreaterThan(10)
    expect(transformElement(el, FROM, ZONE)).toBeTruthy()
  })
})

describe('a whole track in another plane', () => {
  const track = { id: 't', name: 'A', epsg: FROM, elements: chain() }

  it('moves every element onto its own nodes', () => {
    const { track: moved } = transformTrackToPlane(track, ZONE)
    expect(moved.epsg).toBe(ZONE)
    for (const el of moved.elements) expect(missBy(el, ZONE)).toBeLessThan(1e-4)
  })

  it('leaves the joints as tight as it found them', () => {
    const { tangentGap } = transformTrackToPlane(track, ZONE)
    expect(tangentGap).toBeLessThan(1e-3)
  })

  it('restations the elements along the track it is now', () => {
    const { track: moved } = transformTrackToPlane(track, ZONE)
    let station = 0
    for (const el of moved.elements) {
      station += el.length
      expect(el.absLength).toBeCloseTo(station, 6)
    }
  })

  it('says how far the plane stretched', () => {
    const { scale } = transformTrackToPlane(track, ZONE)
    expect(scale.min).toBeGreaterThan(1.0002)
    expect(scale.max).toBeLessThan(1.001)
  })

  it('comes back where it started', () => {
    const there = transformTrackToPlane(track, ZONE)
    const back = transformTrackToPlane(there.track, FROM)
    back.track.elements.forEach((el, i) => {
      const was = track.elements[i]
      expect(Math.hypot(el.startNode[0] - was.startNode[0], el.startNode[1] - was.startNode[1]))
        .toBeLessThan(1e-3)
      expect(el.length).toBeCloseTo(was.length, 5)
      expect(el.radius ?? 0).toBeCloseTo(was.radius ?? 0, 3)
    })
  })

  it('does nothing at all when the plane is already the right one', () => {
    const res = transformTrackToPlane(track, FROM)
    expect(res.track).toBe(track)
    expect(res.scale).toEqual({ min: 1, max: 1 })
  })

  it('carries the heights along the track, not across it', () => {
    const withHeights = { ...track, heights: [
      { station: 0, z: 500 }, { station: 400, z: 505, rv: 4000 }, { station: 900, z: 510 },
    ] }
    const { track: moved, scale } = transformTrackToPlane(withHeights, ZONE)
    expect(moved.heights[0].station).toBe(0)
    expect(moved.heights[1].station).toBeGreaterThan(400)
    expect(moved.heights[1].station / 400).toBeCloseTo(scale.min, 4)
    // The height itself is metres above a datum, not plane metres.
    expect(moved.heights[1].z).toBe(505)
    expect(moved.heights[1].rv).toBeGreaterThan(4000)
  })
})

/**
 * An element a micrometre long is in the source data, and its chord says
 * nothing after the move — what is left of it is rounding. Read off that chord
 * it comes out turned by a sixteenth of a degree against both its neighbours,
 * where a zone change turns everything else by 2.33°.
 */
describe('an element too short to state a direction', () => {
  it('turns with its neighbours instead of with its own chord', () => {
    const a = straight(START, 40, 500)
    const tiny = straight(a.end, 40, 1e-6)
    const b = straight(tiny.end, 40, 500)
    const { track: moved } = transformTrackToPlane(
      { id: 't', epsg: FROM, elements: [a.el, tiny.el, b.el] }, ZONE)
    const [mA, mTiny, mB] = moved.elements
    expect(mTiny.bearing).toBeCloseTo(mA.bearing, 3)
    expect(mTiny.bearing).toBeCloseTo(mB.bearing, 3)
    // And it is still turned: it did not keep the old grid's bearing.
    expect(Math.abs(mTiny.bearing - tiny.el.bearing)).toBeGreaterThan(2)
  })
})
