import { describe, it, expect } from 'vitest'
import { stationsToRead } from './elevationFill'

describe('stationsToRead — where the terrain still has to be read', () => {
  const track = (heights) => ({ elements: [{ length: 400 }], heights })

  it('is the whole track where it has no heights, and nothing where they cover it', () => {
    expect(stationsToRead(track(undefined))[0]).toBe(0)
    expect(stationsToRead(track(undefined)).at(-1)).toBe(400)
    expect(stationsToRead(track([{ station: 0, z: 1 }, { station: 400, z: 2 }]))).toEqual([])
  })

  it('is the stretch before the first point where an imported gradient begins late', () => {
    const stations = stationsToRead(track([{ station: 150, z: 1 }, { station: 400, z: 2 }]))
    expect(stations[0]).toBe(0)
    expect(stations.every(s => s < 150)).toBe(true)
  })

  it('is the stretch past the last point, and both where both are missing', () => {
    const after = stationsToRead(track([{ station: 0, z: 1 }, { station: 250, z: 2 }]))
    expect(after.every(s => s > 250)).toBe(true)
    expect(after.at(-1)).toBe(400)
    const both = stationsToRead(track([{ station: 100, z: 1 }, { station: 300, z: 2 }]))
    expect(both.filter(s => s < 100).length).toBeGreaterThan(0)
    expect(both.filter(s => s > 300).length).toBeGreaterThan(0)
    expect(both.some(s => s >= 100 && s <= 300)).toBe(false)
  })
})
