import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SWITCH_KIND, SWITCH_FORM_VERSION, SWITCH_KINDS, SWITCH_ROUTES, SWITCH_PORTS,
  elementBelongsToSwitch, isModelledSwitch, newSwitchFields, switchElementMark,
  switchPorts, portsOf, switchRoutes, switchRoutePorts,
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
  it('the id decides, and the name is not consulted', () => {
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

  it('a missing id is never a match — not even against another missing one', () => {
    expect(elementBelongsToSwitch(branchEl({ switchName: 'switch.001' }), { name: 'switch.001' })).toBe(false)
    expect(elementBelongsToSwitch(branchEl({}), {})).toBe(false)
    expect(elementBelongsToSwitch(branchEl({}), { switchId: 'a' })).toBe(false)
    expect(elementBelongsToSwitch(branchEl({ switchId: 'a' }), {})).toBe(false)
  })
})

describe('isModelledSwitch', () => {
  it('wants the id, the kind and the form version', () => {
    expect(isModelledSwitch({ switchId: 'a', kind: 'turnout', formVersion: 1 })).toBe(true)
    expect(isModelledSwitch({ kind: 'turnout', formVersion: 1 })).toBe(false)
    expect(isModelledSwitch({ switchId: 'a', formVersion: 1 })).toBe(false)
    expect(isModelledSwitch({ switchId: 'a', kind: 'turnout' })).toBe(false)
    expect(isModelledSwitch(undefined)).toBe(false)
  })

  it('takes what newSwitchFields produces', () => {
    expect(isModelledSwitch(newSwitchFields())).toBe(true)
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


describe('the ports and routes each kind has', () => {
  it('gives the turnout three ports and the crossing kinds four', () => {
    expect(switchPorts('turnout').map(p => p.port)).toEqual(['A', 'B1', 'B2'])
    for (const kind of ['crossing', 'single_slip', 'double_slip']) {
      expect(switchPorts(kind).map(p => p.port)).toEqual(['A', 'B', 'C', 'D'])
    }
  })

  it('pairs every port with the two field names a record carries it in', () => {
    for (const kind of SWITCH_KINDS) {
      for (const { port, trackKey, endKey } of switchPorts(kind)) {
        expect(trackKey).toBe(`port${port}_trackId`)
        expect(endKey).toBe(`port${port}_endpoint`)
      }
    }
  })

  it('reads the ports off the record’s own kind', () => {
    expect(portsOf({ kind: 'crossing' })).toHaveLength(4)
    expect(portsOf({ kind: 'turnout' })).toHaveLength(3)
    // A record from before the kinds existed is a turnout, and so is nonsense.
    expect(portsOf({})).toEqual(SWITCH_PORTS)
    expect(portsOf({ kind: 'no_such_kind' })).toEqual(SWITCH_PORTS)
  })

  it('names the routes of each kind, the turnout’s pair first', () => {
    expect(switchRoutes('turnout')).toEqual(['main', 'branch'])
    expect(switchRoutes('crossing')).toEqual(['main', 'cross'])
    expect(switchRoutes('single_slip')).toEqual(['main', 'cross', 'slip'])
    expect(switchRoutes('double_slip')).toEqual(['main', 'cross', 'slip1', 'slip2'])
    expect(SWITCH_ROUTES).toEqual(switchRoutes(DEFAULT_SWITCH_KIND))
  })

  it('runs every route between two ports the kind has', () => {
    for (const kind of SWITCH_KINDS) {
      const ports = new Set(switchPorts(kind).map(p => p.port))
      for (const [route, ends] of Object.entries(switchRoutePorts(kind))) {
        expect(ends, `${kind}.${route}`).toHaveLength(2)
        for (const end of ends) expect(ports.has(end), `${kind}.${route} → ${end}`).toBe(true)
      }
    }
  })

  it('parts the turnout’s routes at the toe and lets a crossing’s cross', () => {
    const shared = (kind, a, b) => {
      const ports = switchRoutePorts(kind)
      return ports[a].filter(p => ports[b].includes(p))
    }
    expect(shared('turnout', 'main', 'branch')).toEqual(['A'])
    expect(shared('crossing', 'main', 'cross')).toEqual([])
  })
})
