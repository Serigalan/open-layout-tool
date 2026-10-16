import { describe, it, expect } from 'vitest'
import { findBasemap, lvBasemapId, lvStatesOf } from './basemaps'

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
