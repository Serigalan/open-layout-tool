import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { sampleHeightsWithSource, terrainSourceLabel, terrainSources } from '../core/utils/elevation/elevationSource'
import { extend, resetExtensions } from '../core/extensions'
import { dgm1Relief, dgm1Source } from './terrainDgm1'
import { allBasemaps, findBasemap, isElevationBasemap } from '../core/basemaps'

beforeEach(() => extend('terrainSources', dgm1Source))
afterEach(() => { vi.unstubAllGlobals(); resetExtensions() })

describe('the Länder\'s DGM1 as a terrain source', () => {
  it('comes after the automatic choice', () => {
    expect(terrainSources()).toEqual(['auto', 'dgm1', 'dgm5', 'maptiler'])
  })

  it('names every dataset the way a reader knows it', () => {
    expect(terrainSourceLabel('dgm1-th 2020-2025')).toBe('DGM1 Thüringen 2020–2025')
    expect(terrainSourceLabel('dgm1-by')).toBe('DGM1 Bayern')
    expect(terrainSourceLabel('dgm1-nw')).toBe('DGM1 Nordrhein-Westfalen')
    expect(terrainSourceLabel('dgm5')).toBe('DGM5 (BKG)')
  })

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

describe('the Länder\'s DGM1 as a basemap', () => {
  beforeEach(() => {
    extend('basemaps', dgm1Relief)
    vi.stubGlobal('window', { location: { href: 'https://online.open-layout-tool.org/projekt/1' } })
  })

  it('stands with the German basemaps, after DGM5, coloured by height', () => {
    const germany = allBasemaps().filter((b) => b.group === 'germany').map((b) => b.id)
    expect(germany).toEqual(['basemapde', 'dgm5', 'dgm1'])
    expect(isElevationBasemap('dgm1')).toBe(true)
    expect(isElevationBasemap('dgm5')).toBe(true)
    expect(isElevationBasemap('liberty')).toBe(false)
  })

  it('draws the service\'s 1 m tiles over DGM5 from map zoom 15 (tile zoom 16), the terrain staying on DGM5', () => {
    const style = findBasemap('dgm1').style
    expect(style.terrain.source).toBe('dgm5Source')
    expect(style.sources.fineSource).toMatchObject({
      type: 'raster-dem', minzoom: 16, maxzoom: 17, encoding: 'custom',
      tiles: ['https://online.open-layout-tool.org/optimizer/dem/{z}/{x}/{y}.png'],
    })
    // h = (R · 65536 + G · 256 + B) · 0.01 − 10000, as dem_tiles.py packs it.
    const { redFactor, greenFactor, blueFactor, baseShift } = style.sources.fineSource
    const unpack = (r, g, b) => r * redFactor + g * greenFactor + b * blueFactor - baseShift
    const v = Math.round((312.47 + 10000) * 100)
    expect(unpack(v >> 16, (v >> 8) & 255, v & 255)).toBeCloseTo(312.47, 6)
    const fine = style.layers.filter((l) => l.source === 'fineSource')
    expect(fine.map((l) => [l.type, l.minzoom])).toEqual([['color-relief', 15], ['hillshade', 15]])
    expect(style.layers.findIndex((l) => l.id === 'color-relief-fine'))
      .toBeGreaterThan(style.layers.findIndex((l) => l.id === 'hillshade'))
  })
})
