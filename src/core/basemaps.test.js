import { describe, it, expect } from 'vitest'
import { allBasemaps, findBasemap, fineReliefStyle, isElevationBasemap, lvBasemapId, lvStatesOf } from './basemaps'

describe('state orthophotos as one basemap', () => {
  it('joins the states in the list order, whatever order they were ticked in', () => {
    expect(lvBasemapId(['lv-sn', 'lv-by'])).toBe('lv-by+lv-sn')
    expect(lvBasemapId(['lv-by'])).toBe('lv-by')
    expect(lvBasemapId([])).toBe('')
  })

  it('reads the states back, and none for any other basemap', () => {
    expect(lvStatesOf('lv-by+lv-sn').map((s) => s.id)).toEqual(['lv-by', 'lv-sn'])
    expect(lvStatesOf('liberty')).toEqual([])
    expect(lvStatesOf('lv-by+liberty')).toEqual([])
    expect(lvStatesOf(undefined)).toEqual([])
  })

  it('keeps a single state as a JPEG, several as transparent PNGs limited to their box', () => {
    const one = findBasemap('lv-by').style
    expect(Object.keys(one.sources)).toEqual(['lv-by'])
    expect(one.sources['lv-by'].tiles[0]).toContain('FORMAT=image/jpeg')

    const two = findBasemap('lv-by+lv-sn').style
    expect(two.layers.map((l) => l.source)).toEqual(['lv-by', 'lv-sn'])
    for (const src of Object.values(two.sources)) {
      expect(src.tiles[0]).toContain('FORMAT=image/png&TRANSPARENT=TRUE')
      expect(src.bounds).toHaveLength(4)
      expect(src.attribution).toMatch(/dl-de\/by-2-0/)
    }
  })

  it('finds the fixed basemaps as before and nothing for an unknown id', () => {
    expect(findBasemap('liberty').id).toBe('liberty')
    expect(findBasemap('lv-xx')).toBeUndefined()
  })
})

describe('elevation basemaps', () => {
  it('without the server only the fixed ones, DGM5 and the worldwide relief coloured by height', () => {
    expect(allBasemaps().map((b) => b.id)).not.toContain('dgm1')
    expect(allBasemaps().filter((b) => b.elevation).map((b) => b.id)).toEqual(['elevation', 'dgm5'])
    expect(isElevationBasemap('lv-by')).toBe(false)
    expect(isElevationBasemap('dgm1')).toBe(false)
  })

  it('puts a finer DEM over DGM5 without touching the DGM5 basemap', () => {
    const style = fineReliefStyle({ tiles: ['https://x/{z}/{x}/{y}.png'], minzoom: 16 })
    expect(style.layers.map((l) => l.id))
      .toEqual(['background', 'color-relief', 'hillshade', 'color-relief-fine', 'hillshade-fine'])
    expect(style.layers.filter((l) => l.source === 'fineSource').map((l) => l.minzoom)).toEqual([15, 15])
    expect(findBasemap('dgm5').style.layers).toHaveLength(3)
  })
})
