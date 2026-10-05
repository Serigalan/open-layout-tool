import { describe, it, expect } from 'vitest'
import { CLOUD_CRS, crsHint, duration, sizeText } from './cloudFormat'

describe('point cloud figures', () => {
  it('offers DHDN Gauss-Krüger besides the track planes, each once', () => {
    expect(CLOUD_CRS).toContain(5678)
    expect(new Set(CLOUD_CRS).size).toBe(CLOUD_CRS.length)
  })

  it('states durations in minutes and seconds', () => {
    expect(duration(42.4)).toBe('42 s')
    expect(duration(185)).toBe('3 min 05 s')
    expect(duration(null)).toBe('…')
    expect(duration(Infinity)).toBe('…')
  })

  it('switches to GB from one GB on', () => {
    expect(sizeText(2.5e6)).toMatch(/^2[.,]5 MB$/)
    expect(sizeText(3.25e9)).toMatch(/^3[.,]3 GB$|^3[.,]2 GB$/)
  })
})

describe('crsHint', () => {
  it('names a WKT system by its name and EPSG code', () => {
    const wkt1 = 'PROJCS["DHDN / 3-degree Gauss-Kruger zone 4",GEOGCS["DHDN",DATUM["Deutsches_Hauptdreiecksnetz",'
      + 'SPHEROID["Bessel 1841",6377397.155,299.1528128,AUTHORITY["EPSG","7004"]],AUTHORITY["EPSG","6314"]],'
      + 'AUTHORITY["EPSG","4314"]],PROJECTION["Transverse_Mercator"],AUTHORITY["EPSG","5678"]]'
    expect(crsHint(wkt1)).toBe('DHDN / 3-degree Gauss-Kruger zone 4 (EPSG:5678)')
    expect(crsHint('PROJCRS["ETRS89 / UTM zone 32N",BASEGEOGCRS["ETRS89"],ID["EPSG",25832]]')).toBe('ETRS89 / UTM zone 32N (EPSG:25832)')
  })

  it('keeps a short text as it is and cuts a long one', () => {
    expect(crsHint('EPSG:5678')).toBe('EPSG:5678')
    expect(crsHint('x'.repeat(300))).toHaveLength(120)
  })
})

