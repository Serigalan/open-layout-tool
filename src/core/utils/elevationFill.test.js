import { describe, it, expect, vi } from 'vitest'
import { fillHeights, stationsToRead } from './elevationFill'

vi.mock('./elevationSource', () => ({
  sampleHeights: vi.fn(async (lngLats) => lngLats.map(() => 100)),
}))

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

describe('fillHeights — reads, never writes (R1.2)', () => {
  const straight = (x0, x1) => ({
    elementType: 0, startNode: [x0, 5600000], endNode: [x1, 5600000], bearing: 90, length: x1 - x0,
  })
  const track = (id, x0, x1, heights) => ({ id, epsg: 25832, elements: [straight(x0, x1)], ...(heights ? { heights } : {}) })

  it('answers the heights to store for tracks without, and leaves the project alone', async () => {
    const project = { tracks: [track('a', 500000, 500200), track('b', 500200, 500400, [{ station: 0, z: 7 }, { station: 200, z: 7 }])], switches: [] }
    const before = JSON.stringify(project)
    const r = await fillHeights(() => project)
    expect(JSON.stringify(project)).toBe(before)
    expect(r.updated).toBe(1)
    expect(r.heights.has('a')).toBe(true)
    // b only comes along as the other side of the joint, unchanged.
    if (r.heights.has('b')) expect(r.heights.get('b')).toEqual(project.tracks[1].heights)
    const a = r.heights.get('a')
    expect(a[0].z).toBe(100)
    // Where a meets b, the standing height wins: the joint is kept level.
    expect(a.at(-1).z).toBe(7)
  })

  it('skips a track whose length changed while the terrain was asked', async () => {
    let project = { tracks: [track('a', 500000, 500200)], switches: [] }
    const read = () => project
    const pending = fillHeights(read)
    project = { tracks: [track('a', 500000, 500300)], switches: [] }
    const r = await pending
    expect(r.heights.size).toBe(0)
  })
})
