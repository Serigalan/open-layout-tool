import { describe, it, expect } from 'vitest'
import { outlineSegments, outlineFeature } from './cloudOutline'

describe('outlineSegments', () => {
  it('draws the border of the occupied 10-m cells and nothing inside them', () => {
    // Tiles of 2 m in two neighbouring cells, (0,0) and (1,0).
    const index = { tileSize: 2, tiles: [[0, 0, []], [4, 4, []], [5, 0, []]] }
    const segs = outlineSegments(index)
    // Two cells side by side: 6 outer sides, the shared one left out.
    expect(segs).toHaveLength(6)
    const shared = segs.find(([[e0, n0], [e1, n1]]) => e0 === 10 && e1 === 10 && n0 === 0 && n1 === 10)
    expect(shared).toBeUndefined()
  })

  it('handles cells left of and below the origin', () => {
    expect(outlineSegments({ tileSize: 2, tiles: [[-1, -1, []]] })).toEqual([
      [[-10, -10], [0, -10]], [[-10, 0], [0, 0]], [[-10, -10], [-10, 0]], [[0, -10], [0, 0]],
    ])
  })

  it('goes to the map in WGS84', () => {
    const f = outlineFeature({ id: 'c', name: 'n', crs: 25832, tileSize: 2, tiles: [[350000, 2850000, []]] })
    const [[lon, lat]] = f.geometry.coordinates[0]
    expect(lon).toBeGreaterThan(9)
    expect(lon).toBeLessThan(15)
    expect(lat).toBeGreaterThan(50)
    expect(lat).toBeLessThan(54)
    expect(f.properties).toEqual({ cloudId: 'c', name: 'n' })
  })
})
