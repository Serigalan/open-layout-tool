import { describe, it, expect, afterEach } from 'vitest'
import {
  terrainSourceLabel, sampleHeightsWithSource, chosenTerrainSource, terrainSources, DEFAULT_TERRAIN_SOURCE,
} from './elevationSource'
import { extend, resetExtensions } from '../extensions'

afterEach(() => resetExtensions())

describe('the terrain sources', () => {
  it('offers the automatic choice first, and falls back to it', () => {
    expect(terrainSources()).toEqual(['auto', 'dgm5', 'maptiler'])
    expect(DEFAULT_TERRAIN_SOURCE).toBe('auto')
    expect(chosenTerrainSource()).toBe('auto')   // no settings in this suite
  })

  it('names the tile datasets the way a reader knows them', () => {
    expect(terrainSourceLabel('dgm5')).toBe('DGM5 (BKG)')
    expect(terrainSourceLabel('terrain')).toBe('MapTiler Terrain')
    expect(terrainSourceLabel('other')).toBe('other')
  })

  it('puts a registered point source after the automatic choice, asks it first and names its datasets (Paket L)', async () => {
    extend('terrainSources', {
      id: 'pts',
      sample: async (lngLats) => ({ heights: lngLats.map(() => 101.234), sources: lngLats.map(() => 'pts-a') }),
      label: (id) => (id === 'pts-a' ? 'Points A' : null),
    })
    expect(terrainSources()).toEqual(['auto', 'pts', 'dgm5', 'maptiler'])
    const { heights, sources } = await sampleHeightsWithSource([[11, 48]], { source: 'pts' })
    expect(heights).toEqual([101.23])
    expect(sources).toEqual(['pts-a'])
    expect(terrainSourceLabel('pts-a')).toBe('Points A')
  })
})
