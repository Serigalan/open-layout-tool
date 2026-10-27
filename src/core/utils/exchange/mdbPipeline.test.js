import { describe, it, expect } from 'vitest'
import { ALL_STRECKEN, runMdbImport, toPlane } from './mdbPipeline'
import { parseMdbPayload } from './mdbImport'
import fixture from '../../test/fixtures/mdb_weiche.json'
import thueringen from '../../test/fixtures/mdb_thueringen.json'
import { endPointStraightUtm } from '../geometry/elementUtils'

// The notes come back as key + params, so the test sees what was said.
const fill = (key, params) => `${key} ${JSON.stringify(params)}`
let n = 0
const newId = () => `id${++n}`
const noGrids = async () => []

describe('the MDB import pipeline', () => {
  const payload = parseMdbPayload(fixture)

  it('builds tracks and the turnout on them as one commit', async () => {
    const { commit, counts, notes } = await runMdbImport({ payload, strecke: ALL_STRECKEN, fill, newId })
    expect(counts.switches).toBe(1)
    expect(counts.tracks).toBe(commit.addTracks.length)
    expect(commit.addTracks.length).toBeGreaterThan(1)
    // Survey data, not built geometry: the chains join as the file has them.
    for (const tr of commit.addTracks) expect(tr.coordinates.length).toBeGreaterThan(1)
    expect(commit.addSwitches.filter(sw => sw.kind === 'turnout')).toHaveLength(1)
    expect(Array.isArray(notes)).toBe(true)
  })

  it('leaves the switches out when asked to', async () => {
    const { commit, counts } = await runMdbImport({ payload, strecke: ALL_STRECKEN, withSwitches: false, fill, newId })
    expect(counts.switches).toBe(0)
    expect(commit.addSwitches.filter(sw => sw.kind === 'turnout')).toEqual([])
  })

  it('names tracks around the ones the project already has', async () => {
    const first = await runMdbImport({ payload, strecke: ALL_STRECKEN, fill, newId })
    const again = await runMdbImport({
      payload, strecke: ALL_STRECKEN, fill, newId,
      existing: { tracks: first.commit.addTracks, switches: first.commit.addSwitches },
    })
    const taken = new Set(first.commit.addTracks.map(tr => tr.name))
    expect(again.commit.addTracks.some(tr => taken.has(tr.name))).toBe(false)
  })

  it('builds nothing for a line the file does not have', async () => {
    const { commit, counts } = await runMdbImport({ payload, strecke: '0000', fill, newId })
    expect(commit).toBe(null)
    expect(counts).toEqual({ tracks: 0, switches: 0, kmLines: 0 })
  })
})

describe('into one plane', () => {
  // The Thüringen slice is surveyed in several Lagesysteme.
  const payload = parseMdbPayload(thueringen)

  it('moves every chain into the target plane and says how far it stretched', async () => {
    const { commit, notes } = await runMdbImport({
      payload, strecke: ALL_STRECKEN, target: 5684, fill, newId, loadGrids: noGrids,
    })
    expect(commit.addTracks.every(tr => Number(tr.epsg) === 5684)).toBe(true)
    expect(notes.some(l => l.startsWith('data_exchange_mdb_grid_none'))).toBe(true)
  })

  it('leaves tracks that are already there alone', async () => {
    const notes = []
    const track = { id: 't', epsg: 5684, coordinates: [[11, 51], [11.01, 51]], elements: [] }
    const [out] = await toPlane([track], 5684, notes, fill, { loadGrids: noGrids })
    expect(out).toBe(track)
    expect(notes).toHaveLength(1)
  })
})

describe('the axes of the file, cleaned up and checked', () => {
  // Two straights due east in DB_REF: A for 100 m, B on from 4 mm beyond A's
  // end, and C — A's first 50 m once more under other point addresses.
  const S0 = { easting: 4480000, northing: 5765000, zone: 5684 }
  const A1 = endPointStraightUtm(S0, 90, 100)
  const B0 = endPointStraightUtm(S0, 90, 100.004)
  const B1 = endPointStraightUtm(S0, 90, 200)
  const C1 = endPointStraightUtm(S0, 90, 50)
  const pt = (pad, u) => ({ pad, sys: 'ER0', y: u.easting, x: u.northing })
  const el = (pad1, pad2, trasse, length) => ({
    pad1, pad2, sys: 'ER0', typ: 0, p1: length, p2: 0, p3: 0, ariwi: 100, text: `Trasse:${trasse}`, err: 0,
  })
  const payload = parseMdbPayload({
    points: [pt('A0', S0), pt('A1', A1), pt('B0', B0), pt('B1', B1), pt('C0', S0), pt('C1', C1)],
    elements: [el('A0', 'A1', 'A', 100), el('B0', 'B1', 'B', 99.996), el('C0', 'C1', 'C', 50)],
  })

  it('leaves out the copy and says so', async () => {
    const { commit, notes } = await runMdbImport({ payload, strecke: ALL_STRECKEN, fill, newId })
    expect(commit.addTracks.map(tr => tr.name).sort()).toEqual(['A.001', 'B.001'])
    expect(notes.find(l => l.startsWith('data_exchange_mdb_duplicates'))).toContain('C.001 → A.001')
  })

  it('links the joint and reports the gap in it', async () => {
    const { commit, notes } = await runMdbImport({ payload, strecke: ALL_STRECKEN, fill, newId })
    expect(commit.addSwitches.filter(sw => sw.kind === 'link')).toHaveLength(1)
    const gap = notes.find(l => l.startsWith('data_exchange_mdb_gaps'))
    expect(gap).toContain('"n":1')
    expect(gap).toContain('4.0 mm')
  })
})
