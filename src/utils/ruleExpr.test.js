import { describe, it, expect } from 'vitest'
import { evalExpr, parseExpr, ExprError } from './ruleExpr'

const fns = {
  min: (...xs) => Math.min(...xs),
  max: (...xs) => Math.max(...xs),
  abs: (x) => Math.abs(x),
  round_to: (x, step) => Math.round(x / step) * step,
  boom: () => { throw new Error('should not be called') },
}
const run = (src, scope = {}) => evalExpr(src, scope, fns)

describe('the rule expression language', () => {
  it('reads numbers, strings and names', () => {
    expect(run('42')).toBe(42)
    expect(run('0.5')).toBe(0.5)
    expect(run("'clothoid'")).toBe('clothoid')
    expect(run('v', { v: 120 })).toBe(120)
    // A dot is part of the name, not a field access: the scope is flat.
    expect(run('element.design_speed', { 'element.design_speed': 80 })).toBe(80)
  })

  it('applies the arithmetic in the usual order', () => {
    expect(run('1 + 2 * 3')).toBe(7)
    expect(run('(1 + 2) * 3')).toBe(9)
    expect(run('10 - 2 - 3')).toBe(5)
    expect(run('7 % 5')).toBe(2)
    expect(run('-3 + 1')).toBe(-2)
  })

  it('reads ^ as exponentiation, not as exclusive-or', () => {
    expect(run('2 ^ 10')).toBe(1024)
    expect(run('6.5 * 100 ^ 2 / 1000')).toBeCloseTo(65, 10)
    // Right-associative, and tighter than the unary minus in front of it.
    expect(run('2 ^ 3 ^ 2')).toBe(512)
    expect(run('-2 ^ 2')).toBe(-4)
  })

  it('compares and combines', () => {
    expect(run('3 <= 3 and 4 > 2')).toBe(true)
    expect(run('3 < 3 or 4 > 2')).toBe(true)
    expect(run('not (1 == 2)')).toBe(true)
    expect(run('1 != 2')).toBe(true)
    expect(run("form == 'bloss'", { form: 'bloss' })).toBe(true)
  })

  it('stops at the left of and/or, so a rule may guard its own inputs', () => {
    // `jump` is false, so nothing asks for the name that is not there.
    expect(run('jump and missing > 1', { jump: false })).toBe(false)
    expect(run('ok or missing > 1', { ok: true })).toBe(true)
  })

  it('calls the catalogue functions', () => {
    expect(run('min(3, 1, 2)')).toBe(1)
    expect(run('max(3, 1, 2)')).toBe(3)
    expect(run('abs(0 - 4)')).toBe(4)
    expect(run('round_to(97.5, 5)')).toBe(100)
    expect(run('round_to(96, 5)')).toBe(95)
  })

  it('evaluates only the branch if() takes', () => {
    // The other branch divides by a radius that is zero on a straight — that
    // is why `if` may not evaluate both arms first.
    expect(evalExpr('if(r > 0, 6.5 / r, 0)', { r: 0 }, fns)).toBe(0)
    expect(evalExpr('if(false, boom(), 1)', {}, fns)).toBe(1)
  })

  it('throws on a name nothing provides', () => {
    expect(() => run('nope + 1')).toThrow(ExprError)
  })

  it('throws on an unknown function and on a syntax error', () => {
    expect(() => run('nope(1)')).toThrow(ExprError)
    expect(() => run('1 +')).toThrow(ExprError)
    expect(() => run('(1')).toThrow(ExprError)
    expect(() => run('1 $ 2')).toThrow(ExprError)
  })

  it('refuses arithmetic on something that is not a number', () => {
    expect(() => run("'a' + 1")).toThrow(ExprError)
  })

  it('parses one expression once and keeps it', () => {
    expect(parseExpr('1 + 1')).toBe(parseExpr('1 + 1'))
  })
})
