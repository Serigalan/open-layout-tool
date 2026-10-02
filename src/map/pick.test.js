import { describe, it, expect } from 'vitest'
import { HIT_TOLERANCE, elementUnderPoint, pickAt, notSwitchBranch } from './pick'
import { SWITCH_FILLS_LAYER, TRACKS_LAYER } from './layerIds'

// What a click on the map lands on. The map is faked down to the two calls the
// hit test makes of it — everything it decides is decided here, not by MapLibre.
describe('elementUnderPoint', () => {
  const feature = (trackId, elementIndex) => ({ properties: { trackId, elementIndex } })
  const fakeMap = (hits, { layer = TRACKS_LAYER } = {}) => {
    const asked = []
    return {
      asked,
      getLayer: (id) => (id === layer ? {} : undefined),
      queryRenderedFeatures: (bbox, opts) => { asked.push({ bbox, opts }); return hits },
    }
  }

  it('reads the track and the element off what was hit', () => {
    const m = fakeMap([feature('t1', '3')])
    expect(elementUnderPoint(m, { x: 100, y: 200 })).toEqual({ trackId: 't1', elementIndex: 3 })
  })

  it('asks the tracks layer, within the hit tolerance of the point', () => {
    const m = fakeMap([])
    elementUnderPoint(m, { x: 100, y: 200 })
    expect(m.asked[0].bbox).toEqual([
      [100 - HIT_TOLERANCE, 200 - HIT_TOLERANCE],
      [100 + HIT_TOLERANCE, 200 + HIT_TOLERANCE],
    ])
    expect(m.asked[0].opts).toEqual({ layers: [TRACKS_LAYER] })
  })

  it('finds nothing where nothing is drawn', () => {
    expect(elementUnderPoint(fakeMap([]), { x: 0, y: 0 })).toBe(null)
  })

  it('finds nothing before the tracks are on the map at all', () => {
    expect(elementUnderPoint(fakeMap([feature('t1', '0')], { layer: 'other' }), { x: 0, y: 0 })).toBe(null)
    expect(elementUnderPoint(null, { x: 0, y: 0 })).toBe(null)
  })

  it('takes the first of several, unless one of them is the preferred track', () => {
    const hits = [feature('branch', '0'), feature('t1', '7')]
    expect(elementUnderPoint(fakeMap(hits), { x: 0, y: 0 }).trackId).toBe('branch')
    // A turnout's branch lies across the route it was laid into: the track the
    // editor already has open is the one that was meant.
    expect(elementUnderPoint(fakeMap(hits), { x: 0, y: 0 }, 't1'))
      .toEqual({ trackId: 't1', elementIndex: 7 })
  })

  it('keeps the first hit when the preferred track is not among them', () => {
    expect(elementUnderPoint(fakeMap([feature('t2', '1')]), { x: 0, y: 0 }, 't1').trackId).toBe('t2')
  })
})

describe('pickAt (R3.1)', () => {
  const feature = (props) => ({ properties: props })
  const fakeMap = (byLayer) => ({
    getLayer: (id) => (id in byLayer ? {} : undefined),
    queryRenderedFeatures: (bbox, { layers }) => byLayer[layers[0]] ?? [],
  })

  it('skips what `accept` does not take', () => {
    const m = fakeMap({ [TRACKS_LAYER]: [feature({ trackId: 'b', elementIndex: 0, switchBranch: true }), feature({ trackId: 't', elementIndex: 2 })] })
    expect(pickAt(m, { x: 0, y: 0 }, { accept: notSwitchBranch })).toMatchObject({ trackId: 't', elementIndex: 2, switchBranch: false })
  })

  it('asks the layers in order — a switch body before the tracks', () => {
    const m = fakeMap({
      [SWITCH_FILLS_LAYER]: [feature({ switchId: 'w1' })],
      [TRACKS_LAYER]: [feature({ trackId: 't', elementIndex: 0, switchId: 'w2' })],
    })
    const hit = pickAt(m, { x: 0, y: 0 }, { layers: [SWITCH_FILLS_LAYER, TRACKS_LAYER], accept: (p) => !!p.switchId })
    expect(hit).toMatchObject({ switchId: 'w1', layer: SWITCH_FILLS_LAYER, trackId: null })
  })
})
