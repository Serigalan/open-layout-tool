import { describe, it, expect } from 'vitest'
import { carryReferences, remapKind } from './remap'
import { straightElement } from '../elementFactory'

const EPSG = 25832
const P = (x) => ({ easting: 500000 + x, northing: 5700000, zone: EPSG })
// A straight track along the x axis from `x0` to `x1` (east, or west when x1 < x0).
const track = (id, x0, x1, epsg = EPSG) => ({ id, epsg, elements: [straightElement(P(x0), P(x1))] })

// The old track 'a', 200 m due east, and the two pieces a split made of it.
const old = { a: track('a', 0, 200) }
const oldTracks = (id) => old[id] ?? null
const splitLog = [{ from: 'a', to: ['a1', 'a2'] }]

describe('what the log did to a track', () => {
  it('tells a split from a join', () => {
    expect(remapKind('a', splitLog)).toBe('split')
    expect(remapKind('b', [{ from: 'b', to: ['c'] }])).toBe('joined')
    expect(remapKind('a', [{ from: 'a', to: ['a'] }])).toBe(null)   // kept its own id
    expect(remapKind('x', splitLog)).toBe(null)
    expect(remapKind('a', null)).toBe(null)
  })
})

describe('carrying references across a split', () => {
  const pieces = [track('a1', 0, 100), track('a2', 100, 200)]
  const project = {
    tracks: pieces,
    switches: [{ kind: 'turnout', switchId: 'w1', portA_trackId: 'a', portA_endpoint: 'END' }],
    endMarks: [{ id: 'm1', kind: 'buffer_stop', trackId: 'a', endpoint: 'BEGIN' }],
    platforms: [
      { id: 'p1', trackId: 'a', startStation: 20, endStation: 60, side: 'left' },
      { id: 'p2', trackId: 'a', startStation: 80, endStation: 120, side: 'left' },   // over the cut
    ],
  }

  it('moves switch ports and end marks to the piece whose end lies there', () => {
    const { project: out, carried } = carryReferences(project, [splitLog], oldTracks)
    expect(out.switches[0]).toMatchObject({ portA_trackId: 'a2', portA_endpoint: 'END' })
    expect(out.endMarks[0]).toMatchObject({ trackId: 'a1', endpoint: 'BEGIN' })
    expect(carried).toContainEqual({ collection: 'switches', id: 'w1', from: 'a', to: 'a2' })
    expect(carried).toContainEqual({ collection: 'endMarks', id: 'm1', from: 'a', to: 'a1' })
  })

  it('moves a platform to the piece it lies on, and leaves one over the cut', () => {
    const { project: out } = carryReferences(project, [splitLog], oldTracks)
    expect(out.platforms[0]).toMatchObject({ trackId: 'a1', startStation: 20, endStation: 60, side: 'left' })
    expect(out.platforms[1]).toBe(project.platforms[1])
  })

  it('leaves the input untouched', () => {
    const before = structuredClone(project)
    carryReferences(project, [splitLog], oldTracks)
    expect(project).toEqual(before)
  })

  it('turns a platform round onto a piece that runs the other way', () => {
    const reversed = { ...project, tracks: [track('a1', 0, 100), track('a2', 200, 100)],
      platforms: [{ id: 'p3', trackId: 'a', startStation: 130, endStation: 170, side: 'left' }] }
    const { project: out } = carryReferences(reversed, [splitLog], oldTracks)
    expect(out.platforms[0]).toMatchObject({ trackId: 'a2', startStation: 30, endStation: 70, side: 'right' })
  })
})

describe('what it cannot carry', () => {
  it('follows the log through several steps, from both sides', () => {
    const project = {
      tracks: [track('a1', 0, 100), track('b', 100, 200)],
      switches: [{ kind: 'turnout', switchId: 'w1', portA_trackId: 'a', portA_endpoint: 'END' }],
    }
    const theirs = [{ from: 'a2', to: ['b'] }]
    const { project: out } = carryReferences(project, [splitLog, theirs], oldTracks)
    expect(out.switches[0].portA_trackId).toBe('b')
  })

  it('leaves a reference when two pieces end at the same point', () => {
    const project = {
      tracks: [track('a1', 0, 200), track('a2', 200, 300)],
      switches: [{ kind: 'turnout', switchId: 'w1', portA_trackId: 'a', portA_endpoint: 'END' }],
    }
    const { project: out, carried } = carryReferences(project, [splitLog], oldTracks)
    expect(out.switches[0].portA_trackId).toBe('a')
    expect(carried).toEqual([])
  })

  it('does not look at pieces in another plane, nor without the old geometry', () => {
    const project = {
      tracks: [track('a1', 0, 100, 25833), track('a2', 100, 200, 25833)],
      endMarks: [{ id: 'm1', trackId: 'a', endpoint: 'BEGIN' }],
    }
    expect(carryReferences(project, [splitLog], oldTracks).project.endMarks[0].trackId).toBe('a')
    const sameplane = { ...project, tracks: [track('a1', 0, 100), track('a2', 100, 200)] }
    expect(carryReferences(sameplane, [splitLog], () => null).project.endMarks[0].trackId).toBe('a')
  })
})
