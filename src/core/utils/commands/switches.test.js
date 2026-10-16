import { describe, it, expect } from 'vitest'
import { trackOf } from './tracks'
import {
  nearestStop, switchOnTrackPlacement, switchOnTrackRemnant, switchOnTrackRouteEnd, switchOnTrackStops, switchOnTrackToeValid,
} from './switches'
import { arcFrom, straightFrom } from '../elementFactory'
import { SWITCH_TYPES, switchStraightLength } from '../switch/catalogue'

const EPSG = 25832
const START = { easting: 500000, northing: 5600000, zone: EPSG }
const FORM = SWITCH_TYPES.find(f => f.label === '760 – 1:14')

/** A straight track of two 100 m elements at design speed `speed`. */
function twoStraights(speed) {
  const a = straightFrom(START, 30, 100)
  const b = straightFrom({ easting: a.endNode[0], northing: a.endNode[1], zone: EPSG }, 30, 100)
  return trackOf([{ ...a, speed }, { ...b, speed }], EPSG, { name: 'line.001' }, 'host')
}
/** The dialog's settings; `speed` is the diverging track's (l_min 15 m at 100 km/h). */
const argsOf = (track, reversed = false, speed = 100) => ({
  track, reversed, sw: FORM, side: 'left', speed, straightLen: switchStraightLength(FORM),
})

describe('switch on track — the piece before the toe (LP.EL.01)', () => {
  const track = twoStraights(100)

  it('is none where the toe sits on a node, else the piece of the element behind it', () => {
    expect(switchOnTrackRemnant(track, 100, false, 100)).toMatchObject({ length: 0, short: false })
    expect(switchOnTrackRemnant(track, 100, true, 100)).toMatchObject({ length: 0, short: false })
    expect(switchOnTrackRemnant(track, 110, false, 100)).toMatchObject({ elIdx: 1, length: 10, lMin: 15, short: true })
    expect(switchOnTrackRemnant(track, 120, false, 100)).toMatchObject({ elIdx: 1, length: 20, short: false })
  })

  it('opening against the track, the piece behind the toe is the one towards the element end', () => {
    expect(switchOnTrackRemnant(track, 90, true, 100)).toMatchObject({ elIdx: 0, length: 10, short: true })
    expect(switchOnTrackRemnant(track, 80, true, 100)).toMatchObject({ elIdx: 0, length: 20, short: false })
    // With the track, the same toe leaves 80 m before it.
    expect(switchOnTrackRemnant(track, 80, false, 100)).toMatchObject({ length: 80, short: false })
  })

  it('is not checked where the diverging track runs below 40 km/h', () => {
    expect(switchOnTrackRemnant(track, 110, false, 30)).toMatchObject({ length: 10, lMin: null, short: false })
  })

  it('also measures the piece ahead of the toe up to the next node (Entscheidung 301)', () => {
    expect(switchOnTrackRemnant(track, 190, false, 100)).toMatchObject({ elIdx: 1, length: 90, ahead: 10, shortAhead: true })
    expect(switchOnTrackRemnant(track, 180, false, 100)).toMatchObject({ ahead: 20, shortAhead: false })
    // Opening against the track, ahead is towards the element's start.
    expect(switchOnTrackRemnant(track, 10, true, 100)).toMatchObject({ elIdx: 0, length: 90, ahead: 10, shortAhead: true })
    expect(switchOnTrackRemnant(track, 100, false, 100)).toMatchObject({ ahead: 0, shortAhead: false })
    expect(switchOnTrackRemnant(track, 190, false, 30)).toMatchObject({ ahead: 10, shortAhead: false })
  })

  it('takes the speed of the diverging track, not the element\'s (Entscheidung 219)', () => {
    // 10 m are short at 100 km/h, enough at 60 (l_min 6 m) — on either element.
    expect(switchOnTrackRemnant(track, 110, false, 60)).toMatchObject({ lMin: 6, short: false })
    expect(switchOnTrackRemnant(twoStraights(null), 110, false, 100)).toMatchObject({ lMin: 15, short: true })
  })
})

describe('switch on track — where the slider stands', () => {
  const track = twoStraights(100)

  it('on the node behind the toe and every whole metre from l_min on, where the turnout lies', () => {
    const { stops, behind } = switchOnTrackStops(argsOf(track), 1)
    expect(behind).toBe(100)
    expect(stops[0]).toBe(100)
    expect(stops[1]).toBe(115)
    expect(stops.some(s => s > 100 && s < 115)).toBe(false)
    // The turnout needs its through length of track ahead of the toe.
    const room = 200 - switchStraightLength(FORM)
    expect(stops[stops.length - 1]).toBeLessThanOrEqual(room)
    expect(stops.every(s => switchOnTrackToeValid(argsOf(track), s))).toBe(true)
  })

  it('never on the track\'s open end', () => {
    const { stops } = switchOnTrackStops(argsOf(track), 0)
    expect(stops[0]).toBe(15)
    expect(stops).toContain(100)
  })

  it('opening against the track, measured from the element\'s end', () => {
    const { stops, behind } = switchOnTrackStops(argsOf(track, true), 0)
    expect(behind).toBe(100)
    expect(stops).toContain(100)
    expect(stops).toContain(85)
    expect(stops.some(s => s > 85 && s < 100)).toBe(false)
  })

  it('every whole metre where the diverging track has no speed to check', () => {
    const { stops } = switchOnTrackStops(argsOf(track, false, 30), 1)
    expect(stops.slice(0, 3)).toEqual([100, 101, 102])
  })

  it('stops short of l_min before the element end as well (Entscheidung 301)', () => {
    const { stops } = switchOnTrackStops(argsOf(track), 0)
    expect(stops).toContain(85)
    expect(stops.some(s => s > 85 && s < 100)).toBe(false)
  })

  it('without an element, runs over the whole track (Entscheidung 300)', () => {
    const { stops } = switchOnTrackStops(argsOf(track))
    expect(stops).toEqual([...new Set([
      ...switchOnTrackStops(argsOf(track), 0).stops, ...switchOnTrackStops(argsOf(track), 1).stops,
    ])].sort((a, b) => a - b))
    expect(stops).toContain(15)
    expect(stops).toContain(100)
    expect(stops).toContain(115)
  })

  it('snaps a station to the nearest stop', () => {
    expect(nearestStop([100, 115, 116], 104)).toBe(100)
    expect(nearestStop([100, 115, 116], 110)).toBe(115)
    expect(nearestStop([], 110)).toBeNull()
  })
})

describe('switch on track — where the new route ends, without the symbol', () => {
  /** A track of a straight and an arc of `r`, 300 m each. */
  function bentHost(r) {
    const a = straightFrom(START, 30, 300)
    const b = arcFrom({ easting: a.endNode[0], northing: a.endNode[1], zone: EPSG }, 30, 300, r)
    return trackOf([a, b], EPSG, { name: 'line.001' }, 'host')
  }
  const full = (args, x) => {
    const g = switchOnTrackPlacement({ ...args, toeStation: x }).geom
    return g.swapped ? { utm: g.swapped.straightUtm, bearing: g.swapped.mainEndBearing }
      : { utm: g.curvedUtm, bearing: g.branchEndBearing }
  }

  it('is the end the full geometry gives — on a straight, across a joint, bent either way, swapped', () => {
    for (const r of [1200, -1200, -760, 760]) {
      for (const side of ['left', 'right']) {
        for (const reversed of [false, true]) {
          const args = { track: bentHost(r), reversed, sw: FORM, side, straightLen: switchStraightLength(FORM) }
          for (const x of [150, 290, 420]) {
            const light = switchOnTrackRouteEnd(args, x)
            const want = full(args, x)
            expect(Math.hypot(light.utm.easting - want.utm.easting, light.utm.northing - want.utm.northing)).toBeLessThan(1e-9)
            expect(Math.abs(((light.bearing - want.bearing + 540) % 360) - 180)).toBeLessThan(1e-9)
          }
        }
      }
    }
  })

  it('is null where the turnout cannot lie', () => {
    expect(switchOnTrackRouteEnd(argsOf(twoStraights(100)), 195)).toBeNull()
  })
})
