import { describe, it, expect, beforeAll } from 'vitest'
import {
  withUndo, saveProject, saveTrack, saveSwitch, loadTracks, loadSwitches,
  undo, canUndo, loadImportReports, saveImportReport, clearImportReports,
} from './storage'

// Outside the browser storage degrades to the localStorage backend — a stub
// is all the node environment has to offer it.
beforeAll(() => {
  const store = new Map()
  globalThis.localStorage = {
    getItem:    (k) => store.get(k) ?? null,
    setItem:    (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
    key:        (i) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
})

describe('withUndo', () => {
  it('takes a piecewise switch commit back in one undo step', () => {
    saveProject({ id: 'p1', tracks: [], switches: [] })
    expect(canUndo()).toBe(false)

    // The way the switch forms commit: appended leg, branch tracks, record —
    // each with its own pushUndo, which the batch suppresses.
    withUndo(() => {
      saveTrack('p1', { id: 't1', elements: [] })
      saveTrack('p1', { id: 't2', elements: [] })
      saveSwitch('p1', { switchId: 'sw1' })
    })

    expect(loadTracks('p1')).toHaveLength(2)
    expect(loadSwitches('p1')).toHaveLength(1)

    expect(undo()).toBe(true)
    expect(loadTracks('p1')).toHaveLength(0)
    expect(loadSwitches('p1')).toHaveLength(0)
    // One step for the whole switch — not one per mutation.
    expect(canUndo()).toBe(false)
  })
})

describe('the reports an import leaves behind', () => {
  it('keeps them newest first, per project', () => {
    clearImportReports('r1')
    saveImportReport('r1', { source: 'a.mdb', lines: ['erste'], tracks: 2, switches: 1 })
    const all = saveImportReport('r1', { source: 'b.mdb', lines: ['zweite'] })
    expect(all.map(r => r.source)).toEqual(['b.mdb', 'a.mdb'])
    expect(loadImportReports('r1')[1].tracks).toBe(2)
    // Another project's reports are its own.
    expect(loadImportReports('r2')).toEqual([])
  })

  it('stamps each with the time it was written', () => {
    clearImportReports('r3')
    const before = Date.now()
    const [report] = saveImportReport('r3', { source: 'a.mdb', lines: [] })
    expect(report.at).toBeGreaterThanOrEqual(before)
  })

  it('holds the last eight and no more', () => {
    clearImportReports('r4')
    for (let i = 1; i <= 10; i++) saveImportReport('r4', { source: `${i}.mdb`, lines: [] })
    const all = loadImportReports('r4')
    expect(all).toHaveLength(8)
    expect(all[0].source).toBe('10.mdb')
    expect(all[7].source).toBe('3.mdb')
  })

  it('cuts a report too long to keep and says by how much', () => {
    clearImportReports('r5')
    const lines = Array.from({ length: 4100 }, (_, i) => `Meldung ${i}`)
    const [report] = saveImportReport('r5', { source: 'gross.mdb', lines })
    expect(report.lines).toHaveLength(4000)
    expect(report.cut).toBe(100)
  })

  it('survives a store that cannot be read', () => {
    localStorage.setItem('olt_reports_r6', 'not json')
    expect(loadImportReports('r6')).toEqual([])
  })
})
