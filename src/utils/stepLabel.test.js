import { describe, it, expect } from 'vitest'
import { describeStep } from './stepLabel'

const track = (id, name) => ({ id, name, elements: [] })
const base = { tracks: [track('a', 'A'), track('b', 'B')], switches: [{ switchId: 's1', name: 'W1' }], platforms: [], endMarks: [] }

describe('describing a step', () => {
  it('names a switch before the tracks it brought', () => {
    const after = { ...base, tracks: [...base.tracks, track('c', 'C')], switches: [...base.switches, { switchId: 's2', name: 'W12' }] }
    expect(describeStep(base, after)).toEqual({ key: 'step_switch_added', params: { name: 'W12' } })
    expect(describeStep(after, base)).toEqual({ key: 'step_switch_removed', params: { name: 'W12' } })
  })

  it('tells tracks added, removed, replaced and changed', () => {
    expect(describeStep(base, { ...base, tracks: [...base.tracks, track('c', 'C')] })).toEqual({ key: 'step_track_added', params: { name: 'C' } })
    expect(describeStep(base, { ...base, tracks: [base.tracks[0]] })).toEqual({ key: 'step_track_removed', params: { name: 'B' } })
    expect(describeStep(base, { ...base, tracks: [track('m', 'M')] })).toEqual({ key: 'step_tracks_replaced', params: { removed: 2, added: 1 } })
    expect(describeStep(base, { ...base, tracks: [{ ...base.tracks[0] }, base.tracks[1]] })).toEqual({ key: 'step_track_changed', params: { name: 'A' } })
    expect(describeStep(base, { ...base, tracks: base.tracks.map(t => ({ ...t })) })).toEqual({ key: 'step_tracks_changed', params: { n: 2 } })
  })

  it('names a deleted track, not the switches it took along', () => {
    const two = { ...base, switches: [...base.switches, { switchId: 's2', name: 'W2' }] }
    expect(describeStep(two, { ...base, tracks: [base.tracks[0]], switches: [] })).toEqual({ key: 'step_track_removed', params: { name: 'B' } })
    expect(describeStep(base, { ...base, switches: [] })).toEqual({ key: 'step_switch_removed', params: { name: 'W1' } })
  })

  it('counts several at once', () => {
    const after = { ...base, tracks: [...base.tracks, track('c', 'C'), track('d', 'D')] }
    expect(describeStep(base, after)).toEqual({ key: 'step_tracks_added', params: { n: 2 } })
  })

  it('names platforms and end marks, and falls back on the project', () => {
    const p = { id: 'p1', code: 'B', stationName: 'Halle' }
    expect(describeStep(base, { ...base, platforms: [p] })).toEqual({ key: 'step_platform_added', params: { name: 'B · Halle' } })
    expect(describeStep(base, { ...base, endMarks: [{ id: 'e', trackId: 'a' }] })).toEqual({ key: 'step_end_mark_added', params: {} })
    expect(describeStep(base, { ...base, title: 'x' })).toEqual({ key: 'step_project', params: {} })
  })
})

describe('the tracks of a step', async () => {
  const { stepTrackIds } = await import('./stepLabel')
  it('are the ones it brought or changed', () => {
    const after = { ...base, tracks: [{ ...base.tracks[0] }, track('c', 'C')] }
    expect(stepTrackIds(base, after)).toEqual(['c', 'a'])
    expect(stepTrackIds(base, base)).toEqual([])
    expect(stepTrackIds(null, base)).toEqual([])
  })
})
