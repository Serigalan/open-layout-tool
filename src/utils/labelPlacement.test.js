import { describe, it, expect } from 'vitest'
import { labelBox, placeLabels, segmentHitsBox } from './labelPlacement'

const box = { x0: 0, x1: 10, y0: 0, y1: 10 }

describe('segment against box', () => {
  it('finds a segment through, into or along the box', () => {
    expect(segmentHitsBox([-5, 5, 15, 5], box)).toBe(true)    // straight through
    expect(segmentHitsBox([5, 5, 30, 30], box)).toBe(true)    // starting inside
    expect(segmentHitsBox([-5, -5, 15, 15], box)).toBe(true)  // the diagonal
  })

  it('misses one that passes by', () => {
    expect(segmentHitsBox([-5, 12, 15, 12], box)).toBe(false)
    expect(segmentHitsBox([12, -5, 12, 15], box)).toBe(false)
    expect(segmentHitsBox([-5, 9, 2, 20], box)).toBe(false)   // past the corner
  })
})

describe('placing labels', () => {
  it('takes the first free place', () => {
    const at = placeLabels([{ key: 'a', text: 'W1', x: 0, y: 0, offsets: [[0, 18], [0, -18]] }], [], [])
    expect(at.get('a')).toEqual({ x: 0, y: 18 })
  })

  it('moves off a line that runs under the first place', () => {
    const line = [-50, 18, 50, 18]
    const at = placeLabels([{ key: 'a', text: 'W1', x: 0, y: 0, offsets: [[0, 18], [0, -18]] }], [line], [])
    expect(at.get('a')).toEqual({ x: 0, y: -18 })
  })

  it('keeps two labels apart', () => {
    const items = ['a', 'b'].map(key => ({ key, text: 'W 12', x: 0, y: 0, offsets: [[0, 18], [0, -18]] }))
    const at = placeLabels(items, [], [])
    expect(at.get('a').y).not.toBe(at.get('b').y)
  })

  it('takes the place that meets the least when none is free', () => {
    const node = { x0: -10, x1: 10, y0: -30, y1: 30 }
    const lines = [[-50, 18, 50, 18]]
    const at = placeLabels([{ key: 'a', text: 'W1', x: 0, y: 0, offsets: [[0, 18], [0, -18]] }], lines, [node])
    expect(at.get('a')).toEqual({ x: 0, y: -18 })
  })

  it('sizes a label by its text', () => {
    expect(labelBox('W12').w).toBeGreaterThan(labelBox('W').w)
  })
})
