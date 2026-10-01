import { describe, it, expect, beforeAll } from 'vitest'
import {
  withUndo, saveProject, saveTrack, saveSwitch, loadTracks, loadSwitches,
  undo, canUndo, loadImportReports, saveImportReport, clearImportReports,
  loadPlanHeader, savePlanHeader, exportProjectsPayload,
  saveEndMark, loadEndMarks, deleteEndMark, deleteElement, reverseTrackDirection, deleteTrack,
  commitSwitchConnection, deleteTracks, remapSwitchTrackIds, loadIdLog,
} from './storage'
import { newBufferStop, newBoundary } from './utils/trackEndMarks'

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

describe('deleting a whole network', () => {
  it('takes its tracks and their switches in one undo step', () => {
    saveProject({ id: 'net2', tracks: [], switches: [] })
    for (const id of ['a', 'b', 'c', 'far']) saveTrack('net2', { id, elements: [] })
    saveSwitch('net2', { switchId: 'w', portA_trackId: 'a', portA_endpoint: 'END', portB1_trackId: 'b', portB1_endpoint: 'BEGIN', portB2_trackId: 'c', portB2_endpoint: 'BEGIN' })

    deleteTracks('net2', ['a', 'b', 'c'])
    expect(loadTracks('net2').map(t => t.id)).toEqual(['far'])
    expect(loadSwitches('net2')).toHaveLength(0)

    undo()
    expect(loadTracks('net2').map(t => t.id).sort()).toEqual(['a', 'b', 'c', 'far'])
    expect(loadSwitches('net2')).toHaveLength(1)
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

describe('the title block of a project\'s plans', () => {
  it('is kept on the project, travels with its export, and stays out of undo', () => {
    saveProject({ id: 'h1', tracks: [], switches: [] })
    // What an earlier version kept under its own key is read until the project has its own.
    localStorage.setItem('olt_planheader_h1', JSON.stringify({ subtitle: 'alt' }))
    expect(loadPlanHeader('h1').subtitle).toBe('alt')

    expect(savePlanHeader('h1', { subtitle: 'Streckenband' })).toBe(true)
    expect(loadPlanHeader('h1').subtitle).toBe('Streckenband')
    expect(localStorage.getItem('olt_planheader_h1')).toBeNull()
    const exported = exportProjectsPayload(new Set(['h1'])).projects[0]
    expect(exported.planHeader.subtitle).toBe('Streckenband')

    saveTrack('h1', { id: 'th', elements: [] })
    savePlanHeader('h1', { subtitle: 'neu' })
    expect(undo()).toBe(true)
    expect(loadTracks('h1')).toHaveLength(0)
    expect(loadPlanHeader('h1').subtitle).toBe('neu')
  })
})

describe('buffer stops and boundaries in the store', () => {
  const el = (length) => ({ elementType: 0, length, bearing: 90, startNode: [0, 0], endNode: [length, 0] })
  const setup = (id) => {
    saveProject({ id, tracks: [{ id: 't', elements: [el(10), el(20), el(30)] }], switches: [] })
    saveEndMark(id, newBufferStop('t', 'BEGIN', 4))
    saveEndMark(id, newBoundary('t', 'END'))
  }
  const where = (id) => loadEndMarks(id).map(m => [m.kind, m.trackId === 't' ? 't' : 'new', m.endpoint]).sort()

  it('keeps one mark per end, the latest', () => {
    setup('em1')
    saveEndMark('em1', newBufferStop('t', 'END', 8))
    expect(loadEndMarks('em1').map(m => [m.kind, m.endpoint]).sort())
      .toEqual([['buffer_stop', 'BEGIN'], ['buffer_stop', 'END']])
    deleteEndMark('em1', loadEndMarks('em1')[0].id)
    expect(loadEndMarks('em1')).toHaveLength(1)
  })

  it('reverses with its track', () => {
    setup('em2')
    reverseTrackDirection('em2', 't')
    expect(where('em2')).toEqual([['boundary', 't', 'BEGIN'], ['buffer_stop', 't', 'END']])
  })

  it('stays on the outer end of each half when an element is deleted', () => {
    setup('em3')
    deleteElement('em3', 't', 1)
    const tracks = loadTracks('em3')
    const marks = loadEndMarks('em3')
    const head = tracks.find(t => t.elements[0].length === 10)
    const tail = tracks.find(t => t.elements[0].length === 30)
    expect(marks.find(m => m.kind === 'buffer_stop')).toMatchObject({ trackId: head.id, endpoint: 'BEGIN' })
    expect(marks.find(m => m.kind === 'boundary')).toMatchObject({ trackId: tail.id, endpoint: 'END' })
  })

  it('goes with its track, and when a switch takes its end', () => {
    setup('em4')
    commitSwitchConnection('em4', {
      removeTrackIds: [], addTracks: [], remap: [],
      addSwitches: [{ switchId: 's', kind: 'link', portA_trackId: 't', portA_endpoint: 'END', portB_trackId: 'x', portB_endpoint: 'BEGIN' }],
    })
    expect(where('em4')).toEqual([['buffer_stop', 't', 'BEGIN']])
    deleteTrack('em4', 't')
    expect(loadEndMarks('em4')).toEqual([])
    // Undo brings back the track and the mark with it.
    undo()
    expect(loadEndMarks('em4')).toHaveLength(1)
  })
})

describe('the id log of splits and joins (decision 93)', () => {
  const el = (length) => ({ elementType: 0, length, bearing: 90, startNode: [0, 0], endNode: [length, 0] })

  it('a split logs the old id and both pieces, and undo takes the entry back', () => {
    saveProject({ id: 'log1', tracks: [{ id: 't', elements: [el(10), el(20), el(30)] }], switches: [] })
    expect(loadIdLog('log1')).toEqual([])
    deleteElement('log1', 't', 1)
    const ids = loadTracks('log1').map(t => t.id)
    expect(loadIdLog('log1')).toEqual([{ from: 't', to: ids }])
    undo()
    expect(loadIdLog('log1')).toEqual([])
  })

  it('a split at the end logs only the piece there is', () => {
    saveProject({ id: 'log2', tracks: [{ id: 't', elements: [el(10), el(20)] }], switches: [] })
    deleteElement('log2', 't', 1)
    const [only] = loadTracks('log2')
    expect(loadIdLog('log2')).toEqual([{ from: 't', to: [only.id] }])
  })

  it('a join logs the track that went into the one that stays; a flip in place is no id change', () => {
    saveProject({ id: 'log3', tracks: [{ id: 'head', elements: [el(10)] }], switches: [] })
    remapSwitchTrackIds('log3', [
      { oldId: 'tail', newId: 'head' },
      { oldId: 'head', newId: 'head', flip: true },
    ])
    expect(loadIdLog('log3')).toEqual([{ from: 'tail', to: ['head'] }])
    remapSwitchTrackIds('log3', [{ oldId: 'other', newId: 'head', flip: true }])
    expect(loadIdLog('log3')).toHaveLength(2)
    undo()
    expect(loadIdLog('log3')).toEqual([{ from: 'tail', to: ['head'] }])
  })

  it('a switch laid into a track logs the split commitSwitchConnection makes', () => {
    saveProject({ id: 'log4', tracks: [{ id: 'line', elements: [el(10)] }], switches: [] })
    commitSwitchConnection('log4', {
      removeTrackIds: ['line'],
      addTracks: [{ id: 'l1', elements: [el(4)] }, { id: 'l2', elements: [el(6)] }],
      addSwitches: [], remap: [{ oldId: 'line', newId: ['l1', 'l2'] }],
    })
    expect(loadIdLog('log4')).toEqual([{ from: 'line', to: ['l1', 'l2'] }])
  })
})
