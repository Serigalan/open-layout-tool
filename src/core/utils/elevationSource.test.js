import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  terrainSourceLabel, sampleHeightsWithSource, chosenTerrainSource, TERRAIN_SOURCES, DEFAULT_TERRAIN_SOURCE,
} from './elevationSource'

afterEach(() => vi.unstubAllGlobals())

describe('the terrain sources', () => {
  it('offers the automatic choice first, and falls back to it', () => {
    expect(TERRAIN_SOURCES[0]).toBe('auto')
    expect(DEFAULT_TERRAIN_SOURCE).toBe('auto')
    expect(chosenTerrainSource()).toBe('auto')   // no settings in this suite
  })

  it('names every dataset the way a reader knows it', () => {
    expect(terrainSourceLabel('dgm1-th 2020-2025')).toBe('DGM1 Thüringen 2020–2025')
    expect(terrainSourceLabel('dgm1-by')).toBe('DGM1 Bayern')
    expect(terrainSourceLabel('dgm1-nw')).toBe('DGM1 Nordrhein-Westfalen')
    expect(terrainSourceLabel('dgm5')).toBe('DGM5 (BKG)')
    expect(terrainSourceLabel('terrain')).toBe('MapTiler Terrain')
  })
})

describe('reading from one chosen source', () => {
  it('asks the service only for points in a Land it has DGM1 for', async () => {
    const fetch = vi.fn(async (_url, { body }) => {
      const { lnglat } = JSON.parse(body)
      return { ok: true, json: async () => ({ heights: lnglat.map(() => 520.31), sources: lnglat.map(() => 'dgm1-by') }) }
    })
    vi.stubGlobal('fetch', fetch)
    const hannover = [9.7417, 52.3766], muenchen = [11.5583, 48.1403]
    const { heights, sources } = await sampleHeightsWithSource([hannover, muenchen], { source: 'dgm1' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0][1].body).lnglat).toEqual([muenchen])
    expect(heights).toEqual([null, 520.31])
    expect(sources).toEqual([null, 'dgm1-by'])
  })

  it('leaves a point without height where the chosen DGM1 has none — no other source stands in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { heights } = await sampleHeightsWithSource([[11.5583, 48.1403]], { source: 'dgm1' })
    expect(heights).toEqual([null])
  })
})
