import { describe, it, expect } from 'vitest'
import { straightFrom, arcFrom } from '../geometry/elementFactory'
import { trackOf } from './tracks'
import { inRun, rowOf, tableParts, tableRoles, tableRows, trackEdit, writeRows } from './tableView'
import { planElementChange } from './editGeometry'
import { expectValidTrack } from '../../test/chainInvariants'

const EPSG = 25832
const O = { easting: 500000, northing: 5600000, zone: EPSG }
const at = (node) => ({ easting: node[0], northing: node[1], zone: EPSG })

/**
 * Two tracks end to end: A runs east (straight, then an arc of R 800 with
 * 40 mm), B is drawn from the far end back towards A (a straight, then an arc
 * of R −600 ending on A's end). The route runs A then B, so B against itself.
 */
function project() {
  const a1 = straightFrom(O, 90, 100, { speed: 100 })
  const a2 = arcFrom(at(a1.endNode), 90, 50, 800, { speed: 100, cant: 40 })
  const A = trackOf([a1, a2], EPSG, { name: 'A' }, 'A')
  // B as the route runs it: on from A's end, then reversed for storage.
  const r1 = arcFrom(at(a2.endNode), a2.endBearing, 30, 600, { speed: 80, cant: 30 })
  const r2 = straightFrom(at(r1.endNode), r1.endBearing, 70, { speed: 80 })
  const turn = (el) => ({
    ...el, startNode: el.endNode, endNode: el.startNode, bearing: ((el.endBearing ?? el.bearing) + 180) % 360,
    ...(el.endBearing != null ? { endBearing: (el.bearing + 180) % 360 } : {}),
    ...(el.radius != null ? { radius: -el.radius } : {}),
    ...(el.cant != null ? { cant: -el.cant } : {}),
  })
  const B = trackOf([turn(r2), turn(r1)], EPSG, { name: 'B' }, 'B')
  return { tracks: [A, B], route: { id: 'r', name: 'R', trackIds: ['A', 'B'] } }
}

describe('the element table of a route (Entscheidung 381)', () => {
  it('runs its tracks in its direction, one it runs against turned round', () => {
    const { tracks, route } = project()
    const { parts, gaps } = tableParts({ route }, tracks, [])
    expect(gaps).toEqual([])
    expect(parts).toEqual([{ trackId: 'A', reversed: false }, { trackId: 'B', reversed: true }])
    const { elements, rows, stations, length } = tableRows(parts, tracks)
    expect(rows.map(r => `${r.trackId}${r.index}`)).toEqual(['A0', 'A1', 'B1', 'B0'])
    // B's arc as the route runs it: bending right again, its cant on the same side.
    expect(elements[2].radius).toBeCloseTo(600, 6)
    expect(elements[2].cant).toBe(30)
    expect(stations[2].start).toBeCloseTo(150, 6)
    expect(length).toBeCloseTo(250, 6)
    expect(rowOf(rows, 'B', 0)).toBe(3)
  })

  it('is one part for a track', () => {
    const { tracks } = project()
    const { parts } = tableParts({ trackId: 'B' }, tracks, [])
    expect(parts).toEqual([{ trackId: 'B', reversed: false }])
    expect(tableRows(parts, tracks).elements[1].radius).toBeCloseTo(-600, 6)
  })

  it('turns what is typed into a reversed row back into its track\'s direction', () => {
    const rev = { trackId: 'B', index: 1, reversed: true }
    expect(trackEdit(rev, 'radius', 500)).toEqual({ key: 'radius', value: -500 })
    expect(trackEdit(rev, 'cant', 25)).toEqual({ key: 'cant', value: -25 })
    expect(trackEdit(rev, 'cantStart', 10)).toEqual({ key: 'cantEnd', value: -10 })
    expect(trackEdit(rev, 'cantEnd', 10)).toEqual({ key: 'cantStart', value: -10 })
    expect(trackEdit(rev, 'length', 12)).toEqual({ key: 'length', value: 12 })
    expect(trackEdit({ ...rev, reversed: false }, 'radius', 500)).toEqual({ key: 'radius', value: 500 })
  })

  it('writes rewritten rows back onto their elements, and leaves untouched tracks alone', () => {
    const { tracks, route } = project()
    const { parts } = tableParts({ route }, tracks, [])
    const { elements, rows } = tableRows(parts, tracks)
    const faster = elements.map((el, i) => (i === 2 ? { ...el, speed: 60 } : el))
    const next = writeRows(tracks, rows, faster)
    expect(next[0]).toBe(tracks[0])
    expect(next[1].elements[1].speed).toBe(60)
    expect(next[1].elements[1].cant).toBe(-30)
    expect(next[1].elements[0]).toBe(tracks[1].elements[0])
  })

  it('reads a Folgeelement in the route\'s direction and names the row that sets it', () => {
    const { tracks, route } = project()
    // B's element 1 is the route's third row: from it on B follows along the route.
    const withFollow = tracks.map(t => (t.id === 'B' ? { ...t, elements: [t.elements[0], { ...t.elements[1], role: 'follow' }] } : t))
    const { rows } = tableRows(tableParts({ route }, withFollow, []).parts, withFollow)
    const roles = tableRoles(rows, withFollow)
    expect(roles[2]).toMatchObject({ role: 'follow', by: null })
    expect(roles[3]).toMatchObject({ role: 'follow', by: 2 })
    expect(roles[1]).toMatchObject({ role: 'fixed' })
  })

  it('changes a radius along the route: the joint with the track before stays, the far end moves', () => {
    const { tracks, route } = project()
    const { rows } = tableRows(tableParts({ route }, tracks, []).parts, tracks)
    const B = tracks[1]
    const plan = inRun(rows[2], tracks, [], (ts, sws, index) => planElementChange(ts, sws, 'B', index, { radius: 700 }))
    expect(plan.error).toBeFalsy()
    const nb = plan.tracks.find(t => t.id === 'B')
    expect(nb.elements[1].radius).toBeCloseTo(-700, 6)
    // B's END is the joint with A: it stays; B's BEGIN, the route's far end, moves.
    expect(nb.elements[1].endNode[0]).toBeCloseTo(B.elements[1].endNode[0], 6)
    expect(nb.elements[1].endNode[1]).toBeCloseTo(B.elements[1].endNode[1], 6)
    expect(Math.hypot(nb.elements[0].startNode[0] - B.elements[0].startNode[0],
      nb.elements[0].startNode[1] - B.elements[0].startNode[1])).toBeGreaterThan(0.01)
    expectValidTrack(nb)
  })
})
