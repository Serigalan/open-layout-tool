import { describe, it, expect } from 'vitest'
import {
  MAX_CANT, MAX_SWITCH_CANT, MAX_SWITCH_CANT_DEF, MAX_SWITCH_CANT_EXCEPTION,
  cantExceedsLimit, cantExceptionFields, cantExceptionOf, cantLimit, clampSwitchCant,
  computeMaxSpeed, computeSwitchCant, switchCantError, switchCantLimit, worstCantOf,
  HIT_TOLERANCE, TRACKS_LAYER, elementUnderPoint,
  cantDefLevel, cantDefLimit, limitCantDef, maxSpeedFor,
  CANT_STEP, computeAutoC, computeCantDef, regelCant,
} from './mapConstants'

// The two stretches of speed LP.KB.02 gives their own deficiency limit.
const SLOW = 100      // ≤ 150 km/h
const FAST = 200      // > 150 km/h

// The numbers the whole package turns on. They are asserted by value, so a
// change to any of them has to be made here as well as there.
describe('the limits themselves', () => {
  it('holds a switch route to 100 mm, 120 by exception, and 110 mm deficiency', () => {
    expect(MAX_SWITCH_CANT).toBe(100)
    expect(MAX_SWITCH_CANT_EXCEPTION).toBe(120)
    expect(MAX_SWITCH_CANT_DEF).toBe(110)
  })

  // 160, not the 170 this carried before AP R.8: the limit is LP.KB.01's now.
  it('holds a line element to the cant DB Ril 800.0110 allows', () => {
    expect(MAX_CANT).toBe(160)
  })

  it('gives the deficiency one limit per stretch of speed, not one for all', () => {
    expect(cantDefLimit(SLOW)).toBe(130)
    expect(cantDefLimit(150)).toBe(130)      // still the lower one at 150 itself
    expect(cantDefLimit(151)).toBe(150)
    expect(cantDefLimit(FAST)).toBe(150)
    // …and a switch route stays stricter than either, so the lower governs.
    expect(MAX_SWITCH_CANT_DEF).toBeLessThan(cantDefLimit(SLOW))
  })

  it('keeps every switch limit under the line’s — a turnout is never the laxer case', () => {
    expect(MAX_SWITCH_CANT).toBeLessThan(MAX_SWITCH_CANT_EXCEPTION)
    expect(MAX_SWITCH_CANT_EXCEPTION).toBeLessThan(MAX_CANT)
    expect(MAX_SWITCH_CANT_DEF).toBeLessThan(cantDefLimit(FAST))
  })
})

describe('cantExceptionOf', () => {
  it.each([
    ['no element at all',    undefined,             ''],
    ['no field',             {},                    ''],
    ['an empty string',      { cantException: '' },                    ''],
    ['blanks only',          { cantException: '   ' },                 ''],
    ['a reason',             { cantException: 'Zwangspunkt EÜ' },      'Zwangspunkt EÜ'],
    ['a padded reason',      { cantException: '  Zwangspunkt  ' },     'Zwangspunkt'],
    ['a number, not a text', { cantException: 120 },                   ''],
  ])('reads %s as %o', (_what, el, expected) => {
    expect(cantExceptionOf(el)).toBe(expected)
  })
})

// The rule in one table: what an element may carry, and whether what it does
// carry is still inside that.
describe('cantLimit and cantExceedsLimit', () => {
  it.each([
    // element,                                                       limit, exceeds
    [{ cant: 160 },                                                     160, false],
    [{ cant: 165 },                                                     160, true],
    [{ switchBranch: true },                                            100, false],
    [{ switchBranch: true, cant: 100 },                                 100, false],
    [{ switchBranch: true, cant: 105 },                                 100, true],
    [{ switchBranch: true, cant: -105 },                                100, true],
    [{ switchBranch: true, cant: 120 },                                 100, true],
    [{ switchBranch: true, cant: 120, cantException: 'Zwangspunkt' },   120, false],
    [{ switchBranch: true, cant: -120, cantException: 'Zwangspunkt' },  120, false],
    [{ switchBranch: true, cant: 125, cantException: 'Zwangspunkt' },   120, true],
    // A reason of blanks is no reason: the limit falls straight back to 100.
    [{ switchBranch: true, cant: 120, cantException: '   ' },           100, true],
    [{ switchBranch: true, cant: 120, cantException: '' },              100, true],
    // A justification on a line element buys nothing — the rule is the switch’s.
    [{ cant: 165, cantException: 'Zwangspunkt' },                       160, true],
  ])('%o may carry %i mm', (el, limit, exceeds) => {
    expect(cantLimit(el)).toBe(limit)
    expect(cantExceedsLimit(el)).toBe(exceeds)
  })

  it('an element with u > 100 and no justification is invalid — the point of the package', () => {
    expect(cantExceedsLimit({ switchBranch: true, cant: 105 })).toBe(true)
    expect(cantExceedsLimit({ switchBranch: true, cant: 105, cantException: 'Zwangspunkt EÜ' })).toBe(false)
  })

  it('switchCantLimit answers for a value still being typed, before any element exists', () => {
    expect(switchCantLimit('')).toBe(MAX_SWITCH_CANT)
    expect(switchCantLimit('   ')).toBe(MAX_SWITCH_CANT)
    expect(switchCantLimit(undefined)).toBe(MAX_SWITCH_CANT)
    expect(switchCantLimit('Zwangspunkt')).toBe(MAX_SWITCH_CANT_EXCEPTION)
  })
})

describe('cantExceptionFields', () => {
  it.each([
    ['writes the reason where one is needed',  120, 'Zwangspunkt', { cantException: 'Zwangspunkt' }],
    ['trims it',                               120, '  Zwang  ',   { cantException: 'Zwang' }],
    ['reads the magnitude, not the sign',     -120, 'Zwang',       { cantException: 'Zwang' }],
    ['writes nothing at the plain limit',      100, 'Zwang',       {}],
    ['writes nothing below it',                 80, 'Zwang',       {}],
    ['writes nothing without a reason',        120, '',            {}],
    ['writes nothing for blanks',              120, '   ',         {}],
    ['writes nothing for a missing reason',    120, undefined,     {}],
  ])('%s', (_what, cant, reason, expected) => {
    expect(cantExceptionFields(cant, reason)).toEqual(expected)
  })
})

describe('clampSwitchCant — what a switch dialog will accept at all', () => {
  it.each([
    ['snaps onto the 5 mm design step',   97,   95],
    ['rounds up as roundCant does',       98,  100],
    ['stops at the exception ceiling',   150,  120],
    ['and does so on the other side',   -150, -120],
    ['leaves an admissible value alone', 100,  100],
    ['keeps zero',                         0,    0],
  ])('%s: %i → %i mm', (_what, typed, expected) => {
    expect(clampSwitchCant(typed)).toBe(expected)
  })

  it('never lets a value past the ceiling through, whatever is typed', () => {
    for (const typed of [121, 200, 1e6, -121, -1e6]) {
      expect(Math.abs(clampSwitchCant(typed))).toBeLessThanOrEqual(MAX_SWITCH_CANT_EXCEPTION)
    }
  })
})

describe('switchCantError — what stands between a cant and being built', () => {
  it.each([
    ['inside the plain limit',                 100, '',            null],
    ['inside it, reason offered anyway',        80, 'Zwangspunkt', null],
    ['over it with nothing written down',      105, '',            'unjustified'],
    ['over it with only blanks',               105, '   ',         'unjustified'],
    ['over it with a reason',                  120, 'Zwangspunkt', null],
    ['past the exception, reason or not',      125, 'Zwangspunkt', 'over'],
    ['past the exception with nothing',        125, '',            'over'],
    ['the magnitude decides, not the sign',   -120, '',            'unjustified'],
    ['no cant at all',               undefined, '',            null],
  ])('%s: %s mm → %s', (_what, cant, reason, expected) => {
    expect(switchCantError(cant, reason)).toBe(expected)
  })
})

describe('worstCantOf', () => {
  it('reads the one value of an arc, and both ends of a cant ramp', () => {
    expect(worstCantOf({ cant: -95 })).toBe(95)
    expect(worstCantOf({ elementType: 2, cantStart: 40, cantEnd: -130 })).toBe(130)
    expect(worstCantOf({ elementType: 2, cantStart: 0, cantEnd: 60 })).toBe(60)
    expect(worstCantOf({})).toBe(0)
  })

  // A turnout laid into a cant ramp runs on the whole ramp, not on its value at
  // the toe — so the far end has to be able to fail the check.
  it('lets a ramp exceed the switch limit at its far end', () => {
    const el = { switchBranch: true, elementType: 2, cantStart: 60, cantEnd: 130 }
    expect(cantExceedsLimit(el)).toBe(true)
    expect(cantExceedsLimit({ ...el, cantEnd: 100 })).toBe(false)
  })
})

describe('computeSwitchCant', () => {
  // v [km/h], R [m] → the cant the dialog proposes. The first three rows are
  // switch forms at their design speed: their deficiency stays under 110 mm, so
  // they come out flat, as they are built.
  it.each([
    ['190 – 1:9 at its design speed',       40,  190, 0],
    ['500 – 1:14 at its design speed',      60,  500, 0],
    ['760 – 1:18,5 at its design speed',    80,  760, 0],
    ['just over the deficiency limit',      70,  500, 5],
    ['a curve that needs more than 100',   100,  500, MAX_SWITCH_CANT],
    ['a curve that needs far more',        120,  300, MAX_SWITCH_CANT],
    ['the sign follows the curve',         100, -500, -MAX_SWITCH_CANT],
    ['a straight has no cant to compute',   80,    0, 0],
  ])('%s: v=%i R=%i → %i mm', (_what, speed, radius, expected) => {
    expect(computeSwitchCant(speed, radius)).toBe(expected)
  })

  it('never proposes more than the plain limit — an auto value carries no justification', () => {
    for (let speed = 0; speed <= 200; speed += 5) {
      for (const radius of [150, 190, 250, 300, 500, 760, 1200, 2500, -190, -500, -1200]) {
        const u = computeSwitchCant(speed, radius)
        expect(Math.abs(u)).toBeLessThanOrEqual(MAX_SWITCH_CANT)
        // What it proposes is what an element may carry without a reason.
        expect(cantExceedsLimit({ switchBranch: true, cant: u })).toBe(false)
      }
    }
  })
})

// The deficiency half of the rule was already in place; this pins it to the
// speed the element table derives from it, so 1.1 owns both halves.
describe('computeMaxSpeed under the switch deficiency limit', () => {
  it('admits less speed than the line limit does, at the same radius and cant', () => {
    expect(computeMaxSpeed(500, 0, MAX_SWITCH_CANT_DEF))
      .toBeLessThan(computeMaxSpeed(500, 0, cantDefLimit(FAST)))
  })

  it('leaves the deficiency at or under 110 mm at the speed it returns', () => {
    for (const radius of [190, 300, 500, 760, 1200]) {
      for (const cant of [0, 50, MAX_SWITCH_CANT]) {
        const v = computeMaxSpeed(radius, cant, MAX_SWITCH_CANT_DEF)
        expect(Math.round((11.8 * v * v) / radius - cant)).toBeLessThanOrEqual(MAX_SWITCH_CANT_DEF)
      }
    }
  })
})

// The speed an element's geometry allows, under the limit that really holds
// there. LP.KB.02 raises that limit above 150 km/h, so the answer is not one
// call to computeMaxSpeed — a curve can miss the lower stretch and still clear
// the higher one.
describe('maxSpeedFor', () => {
  it('never leaves the deficiency past the limit at the speed it returns', () => {
    for (const radius of [300, 500, 760, 1200, 2500, 4000]) {
      for (const cant of [0, 80, MAX_CANT]) {
        const v = maxSpeedFor({}, radius, cant)
        expect(Math.round((11.8 * v * v) / radius - cant), `R ${radius}, u ${cant}`)
          .toBeLessThanOrEqual(cantDefLimit(v))
      }
    }
  })

  it('stays in the lower stretch where the curve cannot leave it', () => {
    expect(maxSpeedFor({}, 500, 0)).toBe(74)          // 130 mm at 74 km/h
    expect(computeMaxSpeed(500, 0, cantDefLimit(SLOW))).toBe(74)
  })

  // R 2000 reaches 148 km/h at 130 mm — and 159 once past 150 km/h, where the
  // limit is 150. Reading the lower stretch alone would lose those 11 km/h.
  it('takes the higher stretch when the curve clears it', () => {
    expect(computeMaxSpeed(2000, 0, cantDefLimit(SLOW))).toBe(148)
    expect(maxSpeedFor({}, 2000, 0)).toBe(159)
  })

  it('never proposes a speed the catalogue has no rules for', () => {
    expect(maxSpeedFor({}, 4000, MAX_CANT)).toBe(300)
  })

  it('measures a switch route by its own, lower limit', () => {
    expect(maxSpeedFor({ switchBranch: true }, 500, 0))
      .toBeLessThan(maxSpeedFor({}, 500, 0))
  })

  it('says nothing about a straight — no curvature, no limit', () => {
    expect(maxSpeedFor({}, 0, 0)).toBe(null)
  })
})

// What a click on the map lands on. The map is faked down to the two calls the
// hit test makes of it — everything it decides is decided here, not by MapLibre.
describe('elementUnderPoint', () => {
  const feature = (trackId, elementIndex) => ({ properties: { trackId, elementIndex } })
  const fakeMap = (hits, { layer = TRACKS_LAYER } = {}) => {
    const asked = []
    return {
      asked,
      getLayer: (id) => (id === layer ? {} : undefined),
      queryRenderedFeatures: (bbox, opts) => { asked.push({ bbox, opts }); return hits },
    }
  }

  it('reads the track and the element off what was hit', () => {
    const m = fakeMap([feature('t1', '3')])
    expect(elementUnderPoint(m, { x: 100, y: 200 })).toEqual({ trackId: 't1', elementIndex: 3 })
  })

  it('asks the tracks layer, within the hit tolerance of the point', () => {
    const m = fakeMap([])
    elementUnderPoint(m, { x: 100, y: 200 })
    expect(m.asked[0].bbox).toEqual([
      [100 - HIT_TOLERANCE, 200 - HIT_TOLERANCE],
      [100 + HIT_TOLERANCE, 200 + HIT_TOLERANCE],
    ])
    expect(m.asked[0].opts).toEqual({ layers: [TRACKS_LAYER] })
  })

  it('finds nothing where nothing is drawn', () => {
    expect(elementUnderPoint(fakeMap([]), { x: 0, y: 0 })).toBe(null)
  })

  it('finds nothing before the tracks are on the map at all', () => {
    expect(elementUnderPoint(fakeMap([feature('t1', '0')], { layer: 'other' }), { x: 0, y: 0 })).toBe(null)
    expect(elementUnderPoint(null, { x: 0, y: 0 })).toBe(null)
  })

  it('takes the first of several, unless one of them is the preferred track', () => {
    const hits = [feature('branch', '0'), feature('t1', '7')]
    expect(elementUnderPoint(fakeMap(hits), { x: 0, y: 0 }).trackId).toBe('branch')
    // A turnout's branch lies across the route it was laid into: the track the
    // editor already has open is the one that was meant.
    expect(elementUnderPoint(fakeMap(hits), { x: 0, y: 0 }, 't1'))
      .toEqual({ trackId: 't1', elementIndex: 7 })
  })

  it('keeps the first hit when the preferred track is not among them', () => {
    expect(elementUnderPoint(fakeMap([feature('t2', '1')]), { x: 0, y: 0 }, 't1').trackId).toBe('t2')
  })
})

// What a deficiency says about the element carrying it. Since AP R.8 there is
// one limit and no reserve under it: a value is inside the Ril or it is not.
describe('cantDefLevel', () => {
  const line = { speed: SLOW }
  const fast = { speed: FAST }
  const route = { switchBranch: true, speed: SLOW }

  it('takes the limit that holds at this element’s own speed', () => {
    expect(limitCantDef(line)).toBe(130)
    expect(limitCantDef(fast)).toBe(150)
  })

  it('holds a switch route to its own, whatever its speed', () => {
    expect(limitCantDef(route)).toBe(MAX_SWITCH_CANT_DEF)
    expect(limitCantDef({ switchBranch: true, speed: FAST })).toBe(MAX_SWITCH_CANT_DEF)
  })

  it.each([
    [0,   null],
    [130, null],      // at the limit: still inside it
    [131, 'over'],    // past what the Ril allows below 150 km/h
    [150, 'over'],
    [236, 'over'],
  ])('reads %i mm on a line element at 100 km/h as %s', (def, level) => {
    expect(cantDefLevel(line, def)).toBe(level)
  })

  it('lets the same deficiency pass above 150 km/h, where the Ril raises it', () => {
    expect(cantDefLevel(fast, 150)).toBe(null)
    expect(cantDefLevel(fast, 151)).toBe('over')
  })

  it('has no middle ground on a switch route — its 110 mm is the limit', () => {
    expect(cantDefLevel(route, 110)).toBe(null)
    expect(cantDefLevel(route, 111)).toBe('over')
  })

  it('says nothing about cant in excess of the speed — that is not a deficiency', () => {
    expect(cantDefLevel(line, -200)).toBe(null)
  })
})

// The Regelüberhöhung, read out of LP.KB.04 — offered in the dialogs beside
// the value they propose, which parts company with it on a gentle curve.
describe('regelCant', () => {
  it('is the value the dialogs already propose wherever a curve needs cant', () => {
    for (const [v, r] of [[100, 1000], [80, 600], [160, 4000], [60, 400]]) {
      expect(regelCant(v, r), `${v} km/h, R ${r}`).toBe(computeAutoC(v, r))
    }
  })

  // computeAutoC answers 0 below 60 mm of deficiency — a curve gentle enough
  // to need no cant. LP.KB.04 has no such rule, so there the two differ, and
  // the button is what closes the gap it reports as a Hinweis.
  it('still states a cant where the proposal answers none', () => {
    expect(computeCantDef(100, 4000, 0)).toBeLessThan(60)
    expect(computeAutoC(100, 4000)).toBe(0)
    expect(regelCant(100, 4000)).toBe(15)          // 6.5 · 100² / 4000 = 16.25
  })

  it('never states more cant than the Ril allows', () => {
    // 6.5 · 100² / 300 = 217 mm, well past the 160 a curve may carry.
    expect(regelCant(100, 300)).toBe(MAX_CANT)
    // …and inside a turnout the cap is the turnout's own.
    expect(regelCant(100, 300, { inSwitch: true })).toBe(MAX_SWITCH_CANT)
  })

  it('follows the curve, as stored cant does', () => {
    expect(regelCant(100, -1000)).toBe(-regelCant(100, 1000))
  })

  it('lands on the design step, and is nil without a curve', () => {
    expect(regelCant(97, 733) % CANT_STEP).toBe(0)
    expect(regelCant(100, 0)).toBe(0)
    expect(regelCant(100, undefined)).toBe(0)
  })
})
