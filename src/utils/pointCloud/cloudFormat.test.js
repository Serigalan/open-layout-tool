import { describe, it, expect } from 'vitest'
import { CLOUD_CRS, duration, sizeText } from './cloudFormat'

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
