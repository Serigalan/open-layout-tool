import { describe, it, expect } from 'vitest'
import { inheritedSpeed } from './trackModel'

describe('inheritedSpeed', () => {
  const track = (...speeds) => ({ elements: speeds.map(speed => ({ elementType: 0, speed })) })

  it('takes the last element\'s speed', () => {
    expect(inheritedSpeed(track(60, 100))).toBe(100)
  })

  it('looks back past elements that state none', () => {
    expect(inheritedSpeed(track(60, 120, 0, undefined))).toBe(120)
  })

  it('is null when no element states one', () => {
    expect(inheritedSpeed(track(0, undefined))).toBeNull()
    expect(inheritedSpeed({ elements: [] })).toBeNull()
    expect(inheritedSpeed(null)).toBeNull()
  })
})
