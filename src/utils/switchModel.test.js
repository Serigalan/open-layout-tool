import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SWITCH_KIND, SWITCH_FORM_VERSION, SWITCH_KINDS, SWITCH_ROUTES,
  elementBelongsToSwitch, migrateProjectSwitches, newSwitchFields, switchElementMark,
} from './switchModel'

describe('the model’s vocabulary', () => {
  it('names the kinds a record can discriminate on, the turnout first', () => {
    expect(SWITCH_KINDS).toEqual(['turnout', 'crossing', 'single_slip', 'double_slip'])
    expect(SWITCH_KINDS).toContain(DEFAULT_SWITCH_KIND)
  })

  it('names the routes a turnout marks its elements with', () => {
    expect(SWITCH_ROUTES).toEqual(['main', 'branch'])
  })
})

const branchEl = (props) => ({ switchBranch: true, length: 10, ...props })

describe('elementBelongsToSwitch', () => {
  it('the id decides wherever both carry one', () => {
    const sw = { switchId: 'a', name: 'switch.001' }
    expect(elementBelongsToSwitch(branchEl({ switchId: 'a', switchName: 'switch.009' }), sw)).toBe(true)
    expect(elementBelongsToSwitch(branchEl({ switchId: 'b', switchName: 'switch.001' }), sw)).toBe(false)
  })

  it('two records sharing a name are told apart — the defect the id ends', () => {
    const first  = { switchId: 'a', name: 'switch.001' }
    const second = { switchId: 'b', name: 'switch.001' }
    const el = branchEl({ switchId: 'b', switchName: 'switch.001' })
    expect(elementBelongsToSwitch(el, first)).toBe(false)
    expect(elementBelongsToSwitch(el, second)).toBe(true)
  })

  it('falls back on the name where either side has no id yet', () => {
    expect(elementBelongsToSwitch(branchEl({ switchName: 'switch.001' }), { name: 'switch.001' })).toBe(true)
    expect(elementBelongsToSwitch(branchEl({ switchName: 'switch.002' }), { name: 'switch.001' })).toBe(false)
    // An element with an id against a record without one: still the name.
    expect(elementBelongsToSwitch(branchEl({ switchId: 'a', switchName: 'switch.001' }), { name: 'switch.001' })).toBe(true)
  })

  it('an unnamed element or record matches, as it did before ids existed', () => {
    expect(elementBelongsToSwitch(branchEl({}), { name: 'switch.001' })).toBe(true)
    expect(elementBelongsToSwitch(branchEl({ switchName: 'switch.001' }), {})).toBe(true)
  })
})

describe('switchElementMark', () => {
  it('carries the id, the route and the labels, and omits what the record has not got', () => {
    expect(switchElementMark({ switchId: 'a', name: 'switch.001', label: '300 – 1:9' }, 'branch'))
      .toEqual({
        switchBranch: true, switchRoute: 'branch',
        switchId: 'a', switchName: 'switch.001', switchLabel: '300 – 1:9',
      })
    expect(switchElementMark({ switchId: 'a' }, 'main'))
      .toEqual({ switchBranch: true, switchRoute: 'main', switchId: 'a' })
  })
})

describe('newSwitchFields', () => {
  it('gives a fresh id, the kind and the form version', () => {
    const a = newSwitchFields()
    const b = newSwitchFields()
    expect(a.switchId).not.toBe(b.switchId)
    expect(a.kind).toBe(DEFAULT_SWITCH_KIND)
    expect(a.formVersion).toBe(SWITCH_FORM_VERSION)
    expect(newSwitchFields('crossing').kind).toBe('crossing')
  })
})

describe('migrateProjectSwitches', () => {
  const legacyProject = () => ({
    switches: [{ name: 'switch.001', label: '300 – 1:9' }],
    tracks: [
      { id: 't1', elements: [
        { switchBranch: true, switchRoute: 'main', switchName: 'switch.001' },
        { length: 50 },
      ] },
      { id: 't2', elements: [
        { switchBranch: true, switchRoute: 'branch', switchName: 'switch.001' },
      ] },
    ],
  })

  it('gives a record without them an id, a kind and a form version', () => {
    const p = migrateProjectSwitches(legacyProject())
    const [sw] = p.switches
    expect(sw.switchId).toMatch(/^[0-9a-f-]{36}$/)
    expect(sw.kind).toBe(DEFAULT_SWITCH_KIND)
    expect(sw.formVersion).toBe(SWITCH_FORM_VERSION)
  })

  it('writes that id onto the elements the name pointed at, and onto no others', () => {
    const p = migrateProjectSwitches(legacyProject())
    const id = p.switches[0].switchId
    expect(p.tracks[0].elements[0].switchId).toBe(id)
    expect(p.tracks[1].elements[0].switchId).toBe(id)
    expect(p.tracks[0].elements[1].switchId).toBeUndefined()
  })

  it('leaves what already carries the fields alone', () => {
    const p = migrateProjectSwitches(legacyProject())
    const before = JSON.stringify(p)
    migrateProjectSwitches(p)
    expect(JSON.stringify(p)).toBe(before)
  })

  it('keeps an id a record already has', () => {
    const p = migrateProjectSwitches({
      switches: [{ switchId: 'kept', name: 'switch.001', kind: 'turnout', formVersion: 1 }],
      tracks: [{ id: 't1', elements: [{ switchBranch: true, switchName: 'switch.001' }] }],
    })
    expect(p.switches[0].switchId).toBe('kept')
    expect(p.tracks[0].elements[0].switchId).toBe('kept')
  })

  it('gives elements of two records sharing a name to the first, rather than to both', () => {
    const p = migrateProjectSwitches({
      switches: [{ name: 'switch.001' }, { name: 'switch.001' }],
      tracks: [{ id: 't1', elements: [{ switchBranch: true, switchName: 'switch.001' }] }],
    })
    const [first, second] = p.switches
    expect(first.switchId).not.toBe(second.switchId)
    expect(p.tracks[0].elements[0].switchId).toBe(first.switchId)
  })

  it('leaves a project without switches untouched', () => {
    const p = { tracks: [{ id: 't1', elements: [{ length: 10 }] }] }
    expect(migrateProjectSwitches(p)).toBe(p)
    expect(p.tracks[0].elements[0].switchId).toBeUndefined()
  })
})
