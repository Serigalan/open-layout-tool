import { describe, it, expect } from 'vitest'
import { trackOf } from './tracks'
import { nearestStop, switchOnTrackRemnant, switchOnTrackStops, switchOnTrackToeValid } from './switches'
import { straightFrom } from '../elementFactory'
import { SWITCH_TYPES, switchStraightLength } from '../switch/catalogue'

const EPSG = 25832
const START = { easting: 500000, northing: 5600000, zone: EPSG }
const FORM = SWITCH_TYPES.find(f => f.label === '760 – 1:14')

/** A straight track of two 100 m elements at design speed `speed` (l_min 15 m at 100 km/h). */
function twoStraights(speed) {
  const a = straightFrom(START, 30, 100)
  const b = straightFrom({ easting: a.endNode[0], northing: a.endNode[1], zone: EPSG }, 30, 100)
  return trackOf([{ ...a, speed }, { ...b, speed }], EPSG, { name: 'line.001' }, 'host')
}
const argsOf = (track, reversed = false) => ({
  track, reversed, sw: FORM, side: 'left', straightLen: switchStraightLength(FORM),
})

describe('switch on track — the piece before the toe (LP.EL.01)', () => {
  const track = twoStraights(100)

  it('is none where the toe sits on a node, else the piece of the element behind it', () => {
    expect(switchOnTrackRemnant(track, 100, false)).toMatchObject({ length: 0, short: false })
    expect(switchOnTrackRemnant(track, 100, true)).toMatchObject({ length: 0, short: false })
    expect(switchOnTrackRemnant(track, 110, false)).toMatchObject({ elIdx: 1, length: 10, lMin: 15, short: true })
    expect(switchOnTrackRemnant(track, 120, false)).toMatchObject({ elIdx: 1, length: 20, short: false })
  })

  it('opening against the track, the piece behind the toe is the one towards the element end', () => {
    expect(switchOnTrackRemnant(track, 90, true)).toMatchObject({ elIdx: 0, length: 10, short: true })
    expect(switchOnTrackRemnant(track, 80, true)).toMatchObject({ elIdx: 0, length: 20, short: false })
    // With the track, the same toe leaves 80 m before it.
    expect(switchOnTrackRemnant(track, 80, false)).toMatchObject({ length: 80, short: false })
  })

  it('is not checked without a design speed of 40 km/h or more', () => {
    const r = switchOnTrackRemnant(twoStraights(null), 110, false)
    expect(r).toMatchObject({ length: 10, lMin: null, short: false })
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

  it('every whole metre where the element has no speed to check', () => {
    const { stops } = switchOnTrackStops(argsOf(twoStraights(null)), 1)
    expect(stops.slice(0, 3)).toEqual([100, 101, 102])
  })

  it('snaps a station to the nearest stop', () => {
    expect(nearestStop([100, 115, 116], 104)).toBe(100)
    expect(nearestStop([100, 115, 116], 110)).toBe(115)
    expect(nearestStop([], 110)).toBeNull()
  })
})
