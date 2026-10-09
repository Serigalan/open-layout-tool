import { describe, it, expect } from 'vitest'
import { straightFrom } from './elementFactory'
import { resolveRoute } from './routes'
import { routeProfile, routeFindings, trackAsRoute } from './routeProfile'
import { checkVertical, verticalFindings } from './gradientCheck'

const EPSG = 25832
const at = (e, n) => ({ easting: e, northing: n, zone: EPSG })
function track(id, e0, e1, heights) {
  const bearing = e1 > e0 ? 90 : 270
  return { id, name: id, epsg: EPSG, elements: [straightFrom(at(500_000 + e0, 5_500_000), bearing, Math.abs(e1 - e0))], heights }
}

// A east 0→100, B east 100→200, C west 300→200 (run backwards by the route).
const A = track('A', 0, 100, [{ station: 0, z: 100 }, { station: 50, z: 100.5, rv: 5000 }, { station: 100, z: 100 }])
const B = track('B', 100, 200, [{ station: 0, z: 100 }, { station: 100, z: 101 }])
const C = track('C', 300, 200, [{ station: 0, z: 103 }, { station: 30, z: 102, rv: 8000 }, { station: 100, z: 101 }])
const tracks = [A, B, C]

describe('routeProfile', () => {
  const profile = routeProfile(resolveRoute({ trackIds: ['A', 'B', 'C'] }, tracks, []))

  it('lays the points of all tracks over the route, a joint once', () => {
    expect(profile.points.map(p => [Math.round(p.station * 1000) / 1000, p.z])).toEqual([
      [0, 100], [50, 100.5], [100, 100], [200, 101], [270, 102], [300, 103],
    ])
    expect(profile.points.map(p => p.joint)).toEqual([false, false, true, true, false, false])
    expect(profile.points[2].refs.map(r => `${r.trackId}${r.index}`)).toEqual(['A2', 'B0'])
    // C run backwards: its point 1 (30 m along C) is 70 m into the route's part.
    expect(profile.points[4].owner).toMatchObject({ trackId: 'C', index: 1 })
    expect(profile.byRef('C', 2)).toBe(3)
    expect(profile.byRef('B', 1)).toBe(3)
  })

  it('names the ends of its own track, and where parts and elements begin', () => {
    expect(profile.points.map(p => p.trackEnd)).toEqual(['BEGIN', null, 'END', 'END', null, 'BEGIN'])
    expect(profile.partStarts.map(p => [Math.round(p.station), p.part.trackId])).toEqual([[100, 'B'], [200, 'C']])
    expect(profile.boundaries.map(b => Math.round(b.station))).toEqual([0, 100, 200])
  })

  it('a single track is the route of one part, exactly as before', () => {
    const one = routeProfile(trackAsRoute(C))
    expect(one.points.map(p => [p.station, p.z, p.owner.index])).toEqual([[0, 103, 0], [30, 102, 1], [100, 101, 2]])
  })
})

describe('routeFindings', () => {
  it('maps each track\'s findings onto the route, the gradient signed in its direction', () => {
    const profile = routeProfile(resolveRoute({ trackIds: ['A', 'B', 'C'] }, tracks, []))
    const checks = new Map(tracks.map(t => [t.id, checkVertical(t, { project: {}, switches: [], tracks })]))
    const f = routeFindings(profile, checks)
    // C's stretch between its points 1 and 2 ends, in the route's direction, at route point 4.
    const c = checks.get('C').stretches.find(s => s.index === 2)
    expect(f.stretchAt.get(4).grade).toBeCloseTo(-c.grade, 9)
    expect(f.curveAt.get(4).station).toBeCloseTo(270, 6)
    expect(f.curveAt.get(1).station).toBeCloseTo(50, 6)
    expect(Array.isArray(verticalFindings(f))).toBe(true)
  })
})
