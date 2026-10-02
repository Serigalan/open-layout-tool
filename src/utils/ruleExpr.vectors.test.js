import { describe, it, expect } from 'vitest'
import { evalExpr, ExprError } from './ruleExpr'
import vectors from '../constraints/tests/expressions.json'

// The same cases tools/optimizer/tests/vectors.py runs against ruleexpr.py.
const fns = {
  min: (...xs) => Math.min(...xs),
  max: (...xs) => Math.max(...xs),
  abs: (x) => Math.abs(x),
  round_to: (x, step) => Math.round(x / step) * step,
}

describe('expression language, shared vectors (R8.5)', () => {
  for (const c of vectors.cases) {
    it(c.src, () => {
      if (c.error) {
        expect(() => evalExpr(c.src, c.scope ?? {}, fns)).toThrow(ExprError)
      } else {
        const got = evalExpr(c.src, c.scope ?? {}, fns)
        if (typeof c.value === 'number' && !Number.isInteger(c.value)) expect(got).toBeCloseTo(c.value, 9)
        else expect(typeof got === 'number' ? got + 0 : got).toBe(c.value)   // -0 reads as 0
      }
    })
  }
})
