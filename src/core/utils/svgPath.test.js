import { describe, it, expect } from 'vitest'
import { parseSvgPath } from './svgPath'

const end = (c) => c.slice(-2)

describe('SVG path data', () => {
  it('makes relative commands absolute and H/V lines', () => {
    expect(parseSvgPath('M10 20h5v-3l-5 0z')).toEqual([
      ['M', 10, 20], ['L', 15, 20], ['L', 15, 17], ['L', 10, 17], ['Z'],
    ])
  })

  it('reads numbers run together, as editors write them', () => {
    expect(parseSvgPath('M.5-.25l.657.657')).toEqual([['M', 0.5, -0.25], ['L', expect.closeTo(1.157), expect.closeTo(0.407)]])
  })

  it('takes pairs after a move as lines', () => {
    expect(parseSvgPath('m1 1 2 0 0 2')).toEqual([['M', 1, 1], ['L', 3, 1], ['L', 3, 3]])
  })

  it('turns a quadratic into the cubic that traces it', () => {
    const [, c] = parseSvgPath('M0 0Q3 3 6 0')
    expect(c).toEqual(['C', 2, 2, 4, 2, 6, 0])
  })

  it('reflects the last control point for S and T', () => {
    const cmds = parseSvgPath('M0 0C0 1 1 1 1 0S2 -1 2 0')
    expect(cmds[2].slice(1, 3)).toEqual([1, -1])
  })

  it('turns a half circle arc into cubics on the circle', () => {
    const cmds = parseSvgPath('M0 0a1 1 0 1 1 0 2')
    expect(cmds.length).toBeGreaterThan(2)
    expect(end(cmds[cmds.length - 1])).toEqual([0, 2])
    // The arc bulges to the right of its chord: through (1, 1).
    const mid = cmds[1].slice(-2)
    expect(Math.hypot(mid[0] - 0, mid[1] - 1)).toBeCloseTo(1, 5)
    expect(mid[0]).toBeGreaterThan(0)
  })
})
