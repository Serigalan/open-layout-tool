import { describe, it, expect } from 'vitest'
import { fieldFindings, ruleFields } from './ruleFields'
import { ruleById } from './regelkatalog'
import { checkTrack } from './trassierungCheck'

describe('findings at their fields', () => {
  it('reads the fields off a rule\'s inputs', () => {
    expect(ruleFields(ruleById('LP.ALL.01'))).toEqual(['speed'])
    expect(ruleFields(null)).toEqual([])
  })

  it('puts an out-of-range speed at the speed field, and nothing at the others', () => {
    const { perElement } = checkTrack([{ elementType: 0, speed: 333, length: 500, cant: 0 }])
    const found = fieldFindings(perElement[0].results)
    expect(found.speed.severity).toBe('error')
    expect(found.speed.ids).toContain('LP.ALL.01')
    expect(found.radius).toBeUndefined()
  })

  it('leaves out what holds and what is only advice', () => {
    expect(fieldFindings([{ id: 'LP.ALL.01', severity: 'ok' }, { id: 'LP.ALL.01', severity: 'hint' }])).toEqual({})
  })
})
