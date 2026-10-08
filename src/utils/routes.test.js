import { describe, it, expect } from 'vitest'
import { straightFrom } from './elementFactory'
import {
  resolveRoute, routeAt, routeStationOf, routePointAt, routePath, extendRoute, piecesAlong, repairRoutes, nextRouteName,
} from './routes'
import { tracksOnFrom } from './topology'
import { hasPekBestand, loadPekBestand } from '../test/pekFixture'
import { hydrateProjects } from './persistenceUtils'

const EPSG = 25832
const at = (e, n) => ({ easting: e, northing: n, zone: EPSG })

/** A straight track from (e0, n) to (e1, n). */
function track(id, e0, e1, n = 5_500_000) {
  const bearing = e1 > e0 ? 90 : 270
  return { id, name: id, epsg: EPSG, elements: [straightFrom(at(500_000 + e0, n), bearing, Math.abs(e1 - e0))] }
}

// A runs east 0→100, B east 100→200, C west 300→200: B and C meet END to END.
const A = track('A', 0, 100)
const B = track('B', 100, 200)
const C = track('C', 300, 200)
const D = track('D', 400, 500)          // meets nothing
const tracks = [A, B, C, D]

describe('resolveRoute', () => {
  it('runs each track the way the joints say, stationed from 0', () => {
    const r = resolveRoute({ trackIds: ['A', 'B', 'C'] }, tracks, [])
    expect(r.ok).toBe(true)
    expect(r.parts.map(p => [p.trackId, p.reversed, Math.round(p.offset)])).toEqual([
      ['A', false, 0], ['B', false, 100], ['C', true, 200],
    ])
    expect(r.length).toBeCloseTo(300, 6)
  })

  it('reads a route the other way round as running the tracks backwards', () => {
    const r = resolveRoute({ trackIds: ['C', 'B', 'A'] }, tracks, [])
    expect(r.ok).toBe(true)
    expect(r.parts.map(p => p.reversed)).toEqual([false, true, true])
  })

  it('names gaps: tracks that do not meet, and tracks that are gone', () => {
    const r = resolveRoute({ trackIds: ['A', 'X', 'B', 'D'] }, tracks, [])
    expect(r.ok).toBe(false)
    expect(r.gaps).toEqual([
      { after: 0, kind: 'missing', trackId: 'X' },
      { after: 1, kind: 'disconnected' },
    ])
    expect(r.parts.map(p => p.trackId)).toEqual(['A', 'B', 'D'])
  })

  it('a route of one track runs with it', () => {
    const r = resolveRoute({ trackIds: ['C'] }, tracks, [])
    expect(r.parts[0].reversed).toBe(false)
  })
})

describe('stations along a route', () => {
  const r = resolveRoute({ trackIds: ['A', 'B', 'C'] }, tracks, [])

  it('maps a route station to the track and its own station', () => {
    expect(routeAt(r, 150)).toMatchObject({ trackId: 'B', index: 1 })
    expect(routeAt(r, 150).station).toBeCloseTo(50, 6)
    // C is run backwards: 20 m into it is 80 m along its own stations.
    expect(routeAt(r, 220).trackId).toBe('C')
    expect(routeAt(r, 220).station).toBeCloseTo(80, 6)
    // The joint belongs to the later part, the end to the last.
    expect(routeAt(r, 100).trackId).toBe('B')
    expect(routeAt(r, 300).trackId).toBe('C')
    expect(routeAt(r, 999).station).toBeCloseTo(0, 6)
  })

  it('and back', () => {
    expect(routeStationOf(r, 'C', 80)).toBeCloseTo(220, 6)
    expect(routeStationOf(r, 'D', 10)).toBeNull()
  })

  it('gives the bearing the route runs in', () => {
    expect(routePointAt(r, 50).bearing).toBeCloseTo(90, 6)
    expect(routePointAt(r, 250).bearing).toBeCloseTo(90, 6)   // C runs west, the route east
  })
})

describe('routePath and extendRoute', () => {
  it('finds the run of tracks between two', () => {
    expect(routePath(tracks, [], 'A', ['END'], 'C')).toEqual(['B', 'C'])
    expect(routePath(tracks, [], 'A', ['BEGIN'], 'C')).toBeNull()
    expect(routePath(tracks, [], 'A', ['END'], 'D')).toBeNull()
  })

  it('fills the gap to a track clicked further on', () => {
    expect(extendRoute(['A'], 'C', tracks, [])).toEqual({ trackIds: ['A', 'B', 'C'], added: ['B', 'C'] })
    expect(extendRoute(['C'], 'A', tracks, [])).toEqual({ trackIds: ['C', 'B', 'A'], added: ['B', 'A'] })
    expect(extendRoute(['A', 'B'], 'D', tracks, [])).toEqual({ trackIds: ['A', 'B'], added: [] })
    expect(extendRoute([], 'D', tracks, []).trackIds).toEqual(['D'])
  })
})

describe('tracks that went away', () => {
  // B split at 140 into B1 and B2.
  const B1 = track('B1', 100, 140)
  const B2 = track('B2', 140, 200)
  const split = [A, B1, B2, C, D]

  it('finds the pieces lying where a track lay, in its order', () => {
    expect(piecesAlong(B, [C, B2, B1, D])).toEqual(['B1', 'B2'])
    // A short piece between two samples is found by its middle.
    const short = [track('S1', 100, 102), track('S2', 102, 103), track('S3', 103, 200)]
    expect(piecesAlong(B, short)).toEqual(['S1', 'S2', 'S3'])
  })

  it('a write that splits a track puts its pieces into the route, in the route\'s direction', () => {
    const before = { tracks, switches: [], routes: [{ id: 'r', trackIds: ['A', 'B', 'C'] }, { id: 'q', trackIds: ['C', 'B', 'A'] }] }
    const after = repairRoutes(before, { ...before, tracks: split })
    expect(after.routes.map(r => r.trackIds)).toEqual([['A', 'B1', 'B2', 'C'], ['C', 'B2', 'B1', 'A']])
    expect(resolveRoute(after.routes[1], split, []).ok).toBe(true)
  })

  it('a joined track takes the place of both', () => {
    const AB = track('AB', 0, 200)
    const before = { tracks, switches: [], routes: [{ id: 'r', trackIds: ['A', 'B', 'C'] }] }
    const after = repairRoutes(before, { ...before, tracks: [AB, C, D] })
    expect(after.routes[0].trackIds).toEqual(['AB', 'C'])
  })

  it('a deleted track drops out and leaves a gap; nothing changes where nothing is missing', () => {
    const before = { tracks, switches: [], routes: [{ id: 'r', trackIds: ['A', 'B', 'C'] }] }
    const after = repairRoutes(before, { ...before, tracks: [A, C, D] })
    expect(after.routes[0].trackIds).toEqual(['A', 'C'])
    expect(resolveRoute(after.routes[0], [A, C, D], []).gaps).toEqual([{ after: 0, kind: 'disconnected' }])
    const same = { ...before, tracks: [...tracks] }
    expect(repairRoutes(before, same)).toBe(same)
  })
})

describe('nextRouteName', () => {
  it('numbers on from the routes there', () => {
    expect(nextRouteName([])).toBe('Route 1')
    expect(nextRouteName([{ name: 'Route 2' }])).toBe('Route 3')
    expect(nextRouteName([{ name: 'x' }, { name: 'Route 3' }])).toBe('Route 4')
  })
})

describe.skipIf(!hasPekBestand)('PEK Bestand', () => {
  it('a route found over the switches resolves without a gap', () => {
    const project = hydrateProjects([loadPekBestand()])[0]
    const { tracks: ts, switches } = project
    // From a track with a switch at its end, as far on as the network goes.
    const sw = switches.find(s => s.kind === 'turnout' && s.portA_trackId)
    const start = sw.portA_trackId
    const exit = sw.portA_endpoint
    const reachable = tracksOnFrom(start, exit, ts, switches)
    expect(reachable.length).toBeGreaterThan(0)
    // Walk a few tracks on and route to the last one reached.
    let ids = [start]
    let cur = { trackId: start, out: exit }
    for (let k = 0; k < 6; k++) {
      const next = tracksOnFrom(cur.trackId, cur.out, ts, switches)[0]
      if (!next || ids.includes(next.trackId)) break
      ids.push(next.trackId)
      cur = { trackId: next.trackId, out: next.endpoint === 'BEGIN' ? 'END' : 'BEGIN' }
    }
    const target = ids[ids.length - 1]
    const { trackIds } = extendRoute([start], target, ts, switches)
    expect(trackIds[trackIds.length - 1]).toBe(target)
    const r = resolveRoute({ trackIds }, ts, switches)
    expect(r.gaps).toEqual([])
    expect(r.length).toBeGreaterThan(0)
  })
})

describe('in the store', () => {
  it('a write that takes a track apart repairs the route in the same step, and undo takes both back', async () => {
    const { openProject, saveRoute, deleteElements, currentProject, undo, reverseTrackDirection } = await import('../storage')
    // B of three elements; the middle one deleted leaves two pieces with a gap between.
    const B3 = {
      id: 'B', name: 'B', epsg: EPSG,
      elements: [straightFrom(at(500_100, 5_500_000), 90, 30), straightFrom(at(500_130, 5_500_000), 90, 40),
        straightFrom(at(500_170, 5_500_000), 90, 30)],
    }
    openProject({ id: 'routes', tracks: [A, B3, C], switches: [] })
    saveRoute({ id: 'r', name: 'R', trackIds: ['A', 'B', 'C'] })
    deleteElements([{ trackId: 'B', elementIndex: 1 }])
    const p = currentProject()
    const ids = p.routes[0].trackIds
    expect(ids).toHaveLength(4)
    expect(ids[0]).toBe('A')
    expect(ids[3]).toBe('C')
    const r = resolveRoute(p.routes[0], p.tracks, p.switches)
    expect(r.gaps).toEqual([{ after: 1, kind: 'disconnected' }])
    undo()
    expect(currentProject().routes[0].trackIds).toEqual(['A', 'B', 'C'])
    // Turning a track round keeps the route as it is, and still whole.
    reverseTrackDirection('B')
    const q = currentProject()
    const back = resolveRoute(q.routes[0], q.tracks, q.switches)
    expect(back.ok).toBe(true)
    expect(back.parts.map(x => x.reversed)).toEqual([false, true, true])
  })
})

describe('merging variants', () => {
  it('carries a route over a track the other side split', async () => {
    const { carryReferences } = await import('./merge/remap')
    const B1 = track('B1', 100, 140)
    const B2 = track('B2', 140, 200)
    const record = { tracks: [A, B1, B2, C], switches: [], routes: [{ id: 'r', name: 'R', trackIds: ['A', 'B', 'C'] }] }
    const { project, carried } = carryReferences(record, [[{ from: 'B', to: ['B1', 'B2'] }]], (id) => (id === 'B' ? B : null))
    expect(project.routes[0].trackIds).toEqual(['A', 'B1', 'B2', 'C'])
    expect(carried).toEqual([{ collection: 'routes', id: 'r', from: 'B', to: 'B1,B2' }])
  })
})

describe('closeGaps', () => {
  it('fills a gap over the tracks between, and counts what it could not', async () => {
    const { closeGaps } = await import('./routes')
    expect(closeGaps(['A', 'C'], tracks, [])).toEqual({ trackIds: ['A', 'B', 'C'], closed: 1, open: 0 })
    expect(closeGaps(['A', 'D'], tracks, [])).toEqual({ trackIds: ['A', 'D'], closed: 0, open: 1 })
    expect(closeGaps(['C', 'A'], tracks, [])).toEqual({ trackIds: ['C', 'B', 'A'], closed: 1, open: 0 })
  })
})
