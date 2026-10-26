import { describe, it, expect } from 'vitest'
import { otherTrackHeights, switchesOfTrack } from './otherTrack'
import { endPointStraightUtm } from '../geometry/elementUtils'
import { reverseTrack } from '../track/trackModel'

// A crossing (decision 383): `p` runs east through (1000, 1000) with 60 mm
// cant, `q` north through the same point; each has its 20 m over the crossing
// marked as the switch's.
const node = (u) => [u.easting, u.northing]
const at = (e, n) => ({ easting: e, northing: n, zone: 5684 })
const straight = (from, bearing, length, extra = {}) => ({
  elementType: 0, startNode: node(from), endNode: node(endPointStraightUtm(from, bearing, length)), bearing, length, speed: 80, ...extra,
})
const line = (id, from, bearing, extra, heights) => {
  const a = straight(from, bearing, 40, extra)
  const b = straight(endPointStraightUtm(from, bearing, 40), bearing, 20, { ...extra, switchId: 'k', switchRoute: id === 'p' ? 'main' : 'cross' })
  const c = straight(endPointStraightUtm(from, bearing, 60), bearing, 40, extra)
  return { id, name: id, epsg: 5684, trackType: 1, elements: [a, b, c], ...(heights ? { heights } : {}) }
}
const crossing = { switchId: 'k', kind: 'crossing', label: 'KR', ports: {} }
const project = (q = line('q', at(1000, 950), 0, {}, [{ station: 0, z: 90 }, { station: 100, z: 90 }])) => ({
  tracks: [line('p', at(950, 1000), 90, { cant: 60 }, [{ station: 0, z: 100 }, { station: 100, z: 101 }]), q],
  switches: [crossing],
})

describe('the other tracks of a crossing (decision 383)', () => {
  it('lie in the plane of the one given, higher on the side its cant raises', () => {
    const p0 = project()
    const r = otherTrackHeights(p0, 'k', 'p')
    const q = r.project.tracks.find(t => t.id === 'q').heights
    // q's stretch reaches 10 m either side of p: south is p's right, north its left.
    expect(q.map(x => x.station)).toEqual([0, 40, 60, 100])
    expect(q[1].z).toBeCloseTo(100.5 - 0.06 / 1.5 * 10, 4)
    expect(q[2].z).toBeCloseTo(100.5 + 0.06 / 1.5 * 10, 4)
    // The given track stays, and so do the other's points away from the crossing.
    expect(r.project.tracks[0]).toBe(p0.tracks[0])
    expect(q[0]).toEqual({ station: 0, z: 90 })
    expect(otherTrackHeights(r.project, 'k', 'p').project).toBe(r.project)
  })

  it('reads the same with the other track running the other way, or without heights', () => {
    const back = reverseTrack(line('q', at(1000, 950), 0, {}, [{ station: 0, z: 90 }, { station: 100, z: 90 }]))
    const q = otherTrackHeights(project(back), 'k', 'p').project.tracks.find(t => t.id === 'q').heights
    expect(q[1].z).toBeCloseTo(100.9, 4)
    expect(q[2].z).toBeCloseTo(100.1, 4)
    const bare = otherTrackHeights(project(line('q', at(1000, 950), 0, {})), 'k', 'p').project.tracks.find(t => t.id === 'q').heights
    expect(bare.map(x => x.station)).toEqual([40, 60])
  })

  it('says why it cannot: a track without heights given, or one that is not the switch\'s', () => {
    const p = project()
    expect(otherTrackHeights(p, 'k', 'q').error).toBeUndefined()
    expect(otherTrackHeights({ ...p, tracks: [{ ...p.tracks[0], heights: undefined }, p.tracks[1]] }, 'k', 'p')).toEqual({ error: 'no_gradient' })
    expect(otherTrackHeights(p, 'k', 'nope')).toEqual({ error: 'not_on_track' })
    expect(otherTrackHeights(p, 'gone', 'p')).toEqual({ error: 'not_coupled' })
  })

  it('is listed on both its tracks', () => {
    expect(switchesOfTrack(project(), 'p')).toEqual([{ sw: crossing, side: 'crossing', other: null }])
    expect(switchesOfTrack(project(), 'q')).toHaveLength(1)
  })
})
