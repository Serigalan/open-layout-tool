import { describe, it, expect } from 'vitest'
import {
  MAX_CANT, MAX_CANT_DEF, MAX_SWITCH_CANT, MAX_SWITCH_CANT_DEF, MAX_SWITCH_CANT_EXCEPTION,
  cantExceedsLimit, cantExceptionFields, cantExceptionOf, cantLimit, clampSwitchCant,
  computeMaxSpeed, computeSwitchCant, switchCantError, switchCantLimit, worstCantOf,
} from './mapConstants'

// The numbers the whole package turns on. They are asserted by value, so a
// change to any of them has to be made here as well as there.
describe('the limits themselves', () => {
  it('holds a switch route to 100 mm, 120 by exception, and 110 mm deficiency', () => {
    expect(MAX_SWITCH_CANT).toBe(100)
    expect(MAX_SWITCH_CANT_EXCEPTION).toBe(120)
    expect(MAX_SWITCH_CANT_DEF).toBe(110)
  })

  it('leaves the line’s own limits where they were', () => {
    expect(MAX_CANT).toBe(170)
    expect(MAX_CANT_DEF).toBe(150)
  })

  it('keeps every switch limit under the line’s — a turnout is never the laxer case', () => {
    expect(MAX_SWITCH_CANT).toBeLessThan(MAX_SWITCH_CANT_EXCEPTION)
    expect(MAX_SWITCH_CANT_EXCEPTION).toBeLessThan(MAX_CANT)
    expect(MAX_SWITCH_CANT_DEF).toBeLessThan(MAX_CANT_DEF)
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
    [{ cant: 170 },                                                     170, false],
    [{ cant: 175 },                                                     170, true],
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
    [{ cant: 175, cantException: 'Zwangspunkt' },                       170, true],
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
      .toBeLessThan(computeMaxSpeed(500, 0, MAX_CANT_DEF))
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
