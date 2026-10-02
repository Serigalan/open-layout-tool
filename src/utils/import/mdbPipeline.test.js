import { describe, it, expect } from 'vitest'
import { ALL_STRECKEN, runMdbImport, toPlane } from './mdbPipeline'
import { parseMdbPayload } from '../mdbImport'
import fixture from '../../test/fixtures/mdb_weiche.json'
import thueringen from '../../test/fixtures/mdb_thueringen.json'

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
    expect(counts).toEqual({ tracks: 0, switches: 0 })
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
