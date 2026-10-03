import { describe, it, expect } from 'vitest'
import { EMPTY_PLATFORM_FORM, platformDraft, platformForm, platformFormValid } from './platformForm'
import { PLATFORM_FRONT_OFFSET, PLATFORM_WIDTH, DEFAULT_PLATFORM_HEIGHT } from './platformUtils'
import { straightFrom } from './elementFactory'

const track = { id: 't', epsg: 25832, elements: [straightFrom({ easting: 500000, northing: 5700000, zone: 25832 }, 90, 300)] }
const form = (over) => ({ ...EMPTY_PLATFORM_FORM, trackId: 't', start: '20', end: '140', ...over })

describe('the platform form', () => {
  it('makes a record with the stations in order and the back edge behind the front', () => {
    expect(platformDraft(form({ start: '140', end: '20' }))).toMatchObject({
      trackId: 't', startStation: 20, endStation: 140, side: 'right',
      frontOffset: PLATFORM_FRONT_OFFSET, backOffset: PLATFORM_FRONT_OFFSET + PLATFORM_WIDTH, height: DEFAULT_PLATFORM_HEIGHT,
    })
  })

  it('wants both stations on the track, a metre apart, an edge and a height', () => {
    expect(platformFormValid(form(), track)).toBe(true)
    expect(platformFormValid(form(), null)).toBe(false)
    expect(platformFormValid(form({ end: '301' }), track)).toBe(false)
    expect(platformFormValid(form({ end: '20.5' }), track)).toBe(false)
    expect(platformFormValid(form({ frontOffset: 0 }), track)).toBe(false)
    expect(platformFormValid(form({ height: '' }), track)).toBe(false)
  })

  it('fills in a stored platform, an old one without height at the default', () => {
    expect(platformForm({ trackId: 't', startStation: 10.12345, endStation: 90, side: 'left', height: 420, code: 'A' }))
      .toMatchObject({ start: '10.123', end: '90', side: 'left', height: 420, freeHeight: true, code: 'A', frontOffset: PLATFORM_FRONT_OFFSET })
    const old = platformForm({ trackId: 't', startStation: 0, endStation: 50 })
    expect(old).toMatchObject({ height: DEFAULT_PLATFORM_HEIGHT, freeHeight: false, side: 'right' })
  })
})
