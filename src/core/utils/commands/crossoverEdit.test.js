import { describe, it, expect } from 'vitest'
import { editCommit, editStart, switchConnectionOf, takeApart } from './crossoverEdit'
import { buildSCurve, connectionPick, settleConnection, solveConnection } from './sCurve'
import { buildLineTrack } from './tracks'
import { planSwitchDeletion, SWITCH_TYPES } from '../switch'
import { remapSwitches } from '../track'
import { expectNodesJoin, expectSwitchRoutesCarved } from '../../test/chainInvariants'

const EPSG = 25832
const P = (e, n) => ({ easting: e, northing: n, zone: EPSG })

/** A commit (commitSwitchConnection's argument) carried out on a project, as storage does. */
function applyConnection(project, { removeTrackIds = [], addTracks = [], addSwitches = [], remap = [] }) {
  const removed = new Set(removeTrackIds)
  const switches = remap.length ? remapSwitches(project.switches, remap) : project.switches
  return {
    tracks: [...project.tracks.filter(t => !removed.has(t.id)), ...addTracks],
    switches: [...switches, ...addSwitches],
  }
}

/** A deletion (commitSwitchDeletion's argument) carried out likewise. */
function applyDeletion(project, plan) {
  const removed = new Set(plan.removeTrackIds)
  const updated = new Map(plan.updateTracks.map(t => [t.id, t]))
  const rest = project.switches.filter(sw => sw.switchId !== plan.switchId)
  return {
    tracks: project.tracks.filter(t => !removed.has(t.id)).map(t => updated.get(t.id) ?? t),
    switches: plan.remap?.length ? remapSwitches(rest, plan.remap) : rest,
  }
}

// Two parallel tracks running north, 4.5 m apart, joined by a connection at
// 60 km/h laid as the dialog lays one.
const SPEED = 60
const t1 = buildLineTrack({ start: P(500000, 5600000), end: P(500000, 5600600), speed: 100, id: 'line1' })
const t2 = buildLineTrack({ start: P(499995.5, 5600000), end: P(499995.5, 5600600), speed: 100, id: 'line2' })
const picks = [connectionPick(t1, 0, 200), connectionPick(t2, 0, 330)]
const laid = settleConnection({ picks, speed: SPEED, shift: 0 })
const commit = buildSCurve({ result: laid.result, picks, tracks: [t1, t2], switches: [], speed: SPEED })
const project = applyConnection({ tracks: [t1, t2], switches: [] }, commit)
const conn = commit.addTracks[commit.addTracks.length - 1]

describe('a switch connection, edited (Entscheidung 364)', () => {
  it('is a track between two turnouts\' routes with one to three elements of its own', () => {
    expect(laid.result.valid).toBe(true)
    const found = switchConnectionOf({ trackId: conn.id, ...project })
    expect(found.error).toBeUndefined()
    expect(found.mids).toHaveLength(1)
    expect(found.form.label).toBe(laid.result.switchType.label)
    expect(found.speed).toBe(SPEED)
    expect(found.turnouts.map(t => t.port)).toEqual(['B1', 'B1'])
    // A running track is none.
    expect(switchConnectionOf({ trackId: project.tracks[0].id, ...project }).error).toBe('crossover_edit_error_none')
  })

  it('is taken apart into the two tracks as they were, the picks where the toes stood', () => {
    const found = switchConnectionOf({ trackId: conn.id, ...project })
    const apart = takeApart(found, project)
    expect(apart.error).toBeUndefined()
    expect(apart.switches).toEqual([])
    expect(apart.tracks).toHaveLength(2)
    for (const tr of apart.tracks) {
      expect(tr.elements.reduce((sum, el) => sum + el.length, 0)).toBeCloseTo(600, 6)
      expect(tr.elements.some(el => el.switchId)).toBe(false)
    }
    const at = solveConnection({ picks: apart.picks, speed: SPEED, shift: 0, form: found.form })
    expect(at.valid).toBe(true)
    expect(Math.hypot(at.TP1.easting - laid.result.TP1.easting, at.TP1.northing - laid.result.TP1.northing)).toBeLessThan(1e-6)
    expect(Math.hypot(at.TP2.easting - laid.result.TP2.easting, at.TP2.northing - laid.result.TP2.northing)).toBeLessThan(1e-6)
    expect(at.Lg).toBeCloseTo(laid.result.Lg, 6)
  })

  it('starts where it stands, its middle elements as they are with two values open', () => {
    const found = switchConnectionOf({ trackId: conn.id, ...project })
    const apart = takeApart(found, project)
    const start = editStart(found, apart)
    expect(start.shift).toBeCloseTo(0, 9)
    const open = start.mids.flatMap(m => [m.length, ...(m.type === 'arc' ? [m.radius] : [])]).filter(v => v == null)
    expect(open).toHaveLength(2)
    const res = settleConnection({ picks: apart.picks, speed: SPEED, shift: start.shift, mids: start.mids, seed: start.seed, form: found.form }).result
    expect(res.valid).toBe(true)
    expect(res.Lg).toBeCloseTo(laid.result.Lg, 6)
  })

  it('is laid again elsewhere and keeps its switch ids, names and track', () => {
    const found = switchConnectionOf({ trackId: conn.id, ...project })
    const apart = takeApart(found, project)
    const start = editStart(found, apart)
    // Ten metres on.
    const res = settleConnection({ picks: apart.picks, speed: SPEED, shift: start.shift + 10, mids: start.mids, seed: start.seed, form: found.form }).result
    expect(res.valid).toBe(true)
    const again = buildSCurve({
      result: res, picks: apart.picks, tracks: apart.tracks, switches: apart.switches, speed: SPEED,
      identities: found.turnouts.map(t => t.sw), connTrack: found.conn,
    })
    const edit = editCommit(found, apart, again)
    expect(edit.deletions).toHaveLength(2)
    // Carried out on the project the way storage does it.
    let next = project
    for (const plan of edit.deletions) next = applyDeletion(next, plan)
    next = applyConnection(next, edit.connection)
    expect(next.switches.map(sw => sw.switchId).sort()).toEqual(project.switches.map(sw => sw.switchId).sort())
    expect(next.switches.map(sw => sw.name).sort()).toEqual(project.switches.map(sw => sw.name).sort())
    expect(next.tracks.filter(tr => tr.id === conn.id)).toHaveLength(1)
    expect(next.tracks).toHaveLength(project.tracks.length)
    for (const tr of next.tracks) expectNodesJoin(tr.elements)
    for (const sw of next.switches) expectSwitchRoutesCarved(sw, next.tracks)
    // The first toe 10 m on along track 1.
    const old = project.switches.find(sw => sw.switchId === found.turnouts[0].sw.switchId)
    const now = next.switches.find(sw => sw.switchId === old.switchId)
    expect(now.ports.A.trackId).not.toBe(old.ports.A.trackId)
    const toe = next.tracks.find(tr => tr.id === conn.id).elements[0].startNode
    expect(toe[1] - conn.elements[0].startNode[1]).toBeCloseTo(10, 6)
  })

  it('starts a chain of three where it stands, the values it has given', () => {
    // Two tracks 4.5 m apart, 1° to each other, joined at 60 km/h by a
    // transition, an arc and a transition.
    const u2 = buildLineTrack({ start: P(499995.5, 5600000), end: P(499995.5 + 600 * Math.sin(-Math.PI / 180), 5600000 + 600 * Math.cos(Math.PI / 180)), speed: 100, id: 'line3' })
    const pk = [connectionPick(t1, 0, 200), connectionPick(u2, 0, 300)]
    const spec = [{ type: 'transition', length: 15, radius: null }, { type: 'arc', length: null, radius: null }, { type: 'transition', length: 15, radius: null }]
    const out = settleConnection({ picks: pk, speed: SPEED, shift: 0, mids: spec })
    expect(out.result.valid || out.result.overridable).toBe(true)
    const c = buildSCurve({ result: out.result, picks: pk, tracks: [t1, u2], switches: [], speed: SPEED, force: true })
    const p = applyConnection({ tracks: [t1, u2], switches: [] }, c)
    const cn = c.addTracks[c.addTracks.length - 1]
    const found = switchConnectionOf({ trackId: cn.id, ...p })
    expect(found.mids.map(el => el.elementType)).toEqual([2, 1, 2])
    const apart = takeApart(found, p)
    const start = editStart(found, apart)
    expect(start).not.toBeNull()
    expect(start.mids.map(m => m.type)).toEqual(['transition', 'arc', 'transition'])
    const open = start.mids.flatMap(m => [m.length, ...(m.type === 'arc' ? [m.radius] : [])]).filter(v => v == null)
    expect(open).toHaveLength(2)
    const res = settleConnection({ picks: apart.picks, speed: SPEED, shift: start.shift, mids: start.mids, seed: start.seed, form: found.form }).result
    expect(res.midPieces.map(m => m.route.length).reduce((a, b) => a + b))
      .toBeCloseTo(out.result.midPieces.map(m => m.route.length).reduce((a, b) => a + b), 3)
  })

  it('opens as it lies where the construction does not lay it so, its elements as they are', () => {
    const found = switchConnectionOf({ trackId: conn.id, ...project })
    const apart = takeApart(found, project)
    // Two straights between the branches, and the first turnout on an
    // element of 30 m: shorter than its through route, it does not lie on it.
    const crooked = { ...found, mids: [found.mids[0], found.mids[0]].map(el => ({ ...el, length: 5, radius: null })) }
    const short = { ...apart.picks[0], along: 15, route: { ...apart.picks[0].route, length: 30 } }
    const off = { ...apart, picks: [short, apart.picks[1]] }
    const start = editStart(crooked, off)
    expect(start.closes).toBe(false)
    expect(start.shift).toBe(0)
    expect(start.mids).toEqual([{ type: 'straight', length: null, radius: null }, { type: 'straight', length: null, radius: null }])
    expect(start.seed).toEqual({ ds: 0, values: [5, 5] })
    expect(editStart(found, apart).closes).toBe(true)
  })

  it('takes every form a turnout can be laid in with', () => {
    const fb = project.switches.map(sw => ({ ...sw, label: '1200 – 1:19.277' }))
    const found = switchConnectionOf({ trackId: conn.id, tracks: project.tracks, switches: fb })
    expect(found.error).toBeUndefined()
    expect(found.form.label).toBe('1200 – 1:19.277')
    expect(found.speed).toBe(100)
  })

  it('names why it cannot be edited', () => {
    // More than three elements between the turnouts' routes.
    const found = switchConnectionOf({ trackId: conn.id, ...project })
    const many = { ...found.conn, elements: [found.turnouts[0].own, found.mids, found.mids, found.mids, found.mids, found.turnouts[1].own].flat() }
    const tracks = project.tracks.map(tr => (tr.id === conn.id ? many : tr))
    expect(switchConnectionOf({ trackId: conn.id, tracks, switches: project.switches }).error).toBe('crossover_edit_error_mids')
    // Turnouts of a form the dialog does not know.
    const other = project.switches.map(sw => ({ ...sw, label: 'nicht im Katalog' }))
    expect(switchConnectionOf({ trackId: conn.id, tracks: project.tracks, switches: other }).error).toBe('crossover_edit_error_form')
    expect(SWITCH_TYPES.length).toBeGreaterThan(0)
    expect(planSwitchDeletion).toBeTypeOf('function')
  })
})
