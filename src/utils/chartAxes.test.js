import { describe, it, expect } from 'vitest'
import { niceStep, stepDecimals, ticks } from './chartAxes'

describe('chart axes', () => {
  it('picks the smallest round step that keeps labels apart', () => {
    expect(niceStep(70, 1)).toBe(100)       // 1 px per metre: 100 m
    expect(niceStep(70, 7)).toBe(10)
    expect(niceStep(26, 300)).toBe(0.1)
    expect(niceStep(70, 1e-6)).toBe(10000)  // held to the largest
  })

  it('gives labels as many decimals as their step needs', () => {
    expect([0.1, 0.2, 0.5, 1, 20].map(stepDecimals)).toEqual([2, 1, 1, 0, 0])
  })

  it('puts the multiples of the step into the range', () => {
    expect(ticks(12, 61, 10)).toEqual([20, 30, 40, 50, 60])
    expect(ticks(-0.25, 0.3, 0.1)).toEqual([-0.2, -0.1, 0, 0.1, 0.2, 0.3])
    expect(ticks(5, 4, 1)).toEqual([])
  })
})
