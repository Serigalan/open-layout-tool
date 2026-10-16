import { describe, it, expect } from 'vitest'
import { trackOf } from './tracks'
import {
  switchOnTrackPlacement, switchOnTrackRemnant, switchOnTrackRouteEnd, switchOnTrackSlider, switchOnTrackToeValid,
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

describe('switch on track — what the slider runs over', () => {
  const track = twoStraights(100)
  const room = 200 - switchStraightLength(FORM)

  it('the stretches where the turnout lies and keeps l_min on both sides of WA (Entscheidungen 301, 309)', () => {
    const { intervals } = switchOnTrackSlider(argsOf(track))
    expect(intervals).toHaveLength(3)
    const [a, node, b] = intervals
    expect(a[0]).toBeCloseTo(15, 2)
    expect(a[1]).toBeCloseTo(85, 2)
    // The element change itself: no piece on either side.
    expect(node[0]).toBeCloseTo(100, 2)
    expect(node[1]).toBeCloseTo(100, 2)
    expect(b[0]).toBeCloseTo(115, 2)
    expect(b[1]).toBeLessThanOrEqual(room + 1e-2)
    for (const [x, y] of intervals) {
      expect(switchOnTrackToeValid(argsOf(track), x)).toBe(true)
      expect(switchOnTrackToeValid(argsOf(track), y)).toBe(true)
    }
  })

  it('every stretch where the diverging track has no speed to check', () => {
    const { intervals } = switchOnTrackSlider(argsOf(track, false, 30))
    expect(intervals).toHaveLength(1)
    expect(intervals[0][0]).toBeLessThan(1)
  })

  it('runs 50 m either side of the clicked station (Entscheidung 313)', () => {
    const { intervals } = switchOnTrackSlider(argsOf(track), 120)
    expect(intervals[0][0]).toBeGreaterThanOrEqual(70)
    expect(intervals.at(-1)[1]).toBeLessThanOrEqual(170)
    expect(intervals.some(([a, b]) => a <= 100 && b >= 100)).toBe(true)
    // The element change itself, off the metre grid of the window, is still a place to stand.
    const off = switchOnTrackSlider(argsOf(track), 120.37).intervals
    expect(off.some(([a, b]) => a <= 100 + 1e-9 && b >= 100 - 1e-9)).toBe(true)
    // Near the track's begin the window ends there.
    expect(switchOnTrackSlider(argsOf(track), 20).intervals.at(-1)[1]).toBeLessThanOrEqual(70)
  })

  it('snaps where WA or WE fall on an element change (Entscheidung 310)', () => {
    const L = switchStraightLength(FORM)
    const { snaps } = switchOnTrackSlider(argsOf(track))
    for (const s of [0, 100, 200, 100 - L, 200 - L]) expect(snaps).toContain(Math.round(s * 1e4) / 1e4)
    // Opening against the track, WE lies behind WA in the track's direction.
    expect(switchOnTrackSlider(argsOf(track, true)).snaps).toContain(Math.round((100 + L) * 1e4) / 1e4)
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
