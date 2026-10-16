import { describe, it, expect } from 'vitest'
import { planRailJsonImport } from './railJsonImport'
import { straightFrom } from '../elementFactory'

const EPSG = 25832
const el = straightFrom({ easting: 500000, northing: 5700000, zone: EPSG }, 90, 100)
const track = (id, name) => ({ id, name, epsg: EPSG, elements: [el] })
let n = 0
const newId = () => `new${++n}`

describe('planning a RailJSON import', () => {
  const parsed = {
    tracks: [track('a', '6340.001'), track('b', '6340.002')],
    switches: [{ switchId: 'w1', kind: 'turnout', ports: { A: { trackId: 'a' }, B1: { trackId: 'b' }, B2: { trackId: null } }}],
    endMarks: [{ id: 'm1', trackId: 'a', endpoint: 'BEGIN' }],
    infra: { routes: [1], switches: [{ id: 'f', ports: { A: { track: 'a', endpoint: 'END' } } }] },
  }

  it('takes tracks, switches and marks as they are into an empty project', () => {
    const plan = planRailJsonImport(parsed, { newId })
    expect(plan.addTracks.map(tr => [tr.id, tr.name])).toEqual([['a', '6340.001'], ['b', '6340.002']])
    expect(plan.addTracks[0].coordinates.length).toBeGreaterThan(0)
    expect(plan.addSwitches[0]).toMatchObject({ ports: { A: { trackId: 'a' }, B1: { trackId: 'b' }, B2: { trackId: null } } })
    expect(plan.addEndMarks).toEqual([{ id: 'm1', trackId: 'a', endpoint: 'BEGIN' }])
    expect(plan.osrd).toEqual(parsed.infra)
  })

  it('gives taken ids and names new ones and repoints everything that named them', () => {
    const plan = planRailJsonImport(parsed, {
      existingTracks: [track('a', '6340.001')], existingMarks: [{ id: 'm1' }], newId,
    })
    const [a, b] = plan.addTracks
    expect(a.id).not.toBe('a')
    expect(a.name).not.toBe('6340.001')
    // b keeps its id; its name went to the renamed a, so it takes the next one.
    expect(b).toMatchObject({ id: 'b', name: '6340.003' })
    expect(plan.addSwitches[0].ports?.A?.trackId).toBe(a.id)
    expect(plan.addEndMarks[0].trackId).toBe(a.id)
    expect(plan.addEndMarks[0].id).not.toBe('m1')
    expect(plan.osrd.switches[0].ports.A.track).toBe(a.id)
    expect(plan.osrd.routes).toEqual([1])
  })
})
