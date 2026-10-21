import { describe, it, expect } from 'vitest'
import { localKmFeatures } from './localKmLayer'

describe('localKmFeatures', () => {
  it('draws every run and a mark on each whole hectometre, whichever way the kilometrage runs', () => {
    const { lines, marks } = localKmFeatures([
      { lineNumber: 6340, runs: [[[11, 50, 163950], [11.001, 50, 164050], [11.002, 50, 164250]]] },
      { lineNumber: '6311', runs: [[[12, 51, 1000], [12.001, 51, 800]], [[12, 51]]] },
    ])
    expect(lines.features.map(f => [f.properties.lineNumber, f.geometry.coordinates.length])).toEqual([['6340', 3], ['6311', 2]])
    expect(marks.features.map(f => f.properties.label)).toEqual(['164,0', '164,1', '164,2', '0,8', '0,9', '1,0'])
    expect(marks.features.map(f => f.properties.full)).toEqual([1, 0, 0, 0, 0, 1])
    // Halfway between the first two vertices.
    expect(marks.features[0].geometry.coordinates[0]).toBeCloseTo(11.0005, 9)
    expect(marks.features[0].properties.lineNumber).toBe('6340')
  })

  it('has nothing for no lines', () => {
    expect(localKmFeatures(undefined).lines.features).toEqual([])
  })
})
