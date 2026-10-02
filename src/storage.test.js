import { describe, it, expect, beforeAll } from 'vitest'
import {
  withUndo, openProject, saveTrack, saveSwitch, loadTracks, loadSwitches,
  undo, canUndo, loadImportReports, saveImportReport, clearImportReports,
  loadPlanHeader, savePlanHeader, exportProjectsPayload,
  saveEndMark, loadEndMarks, deleteEndMark, deleteElement, reverseTrackDirection, deleteTrack,
  commitSwitchConnection, deleteTracks, remapSwitchTrackIds, loadIdLog,
  openWorkingCopy, currentWorkingCopy, markCheckedIn, adoptWorkingCopy, closeWorkingCopy, currentProject,
  addElementToTrack,
} from './storage'
import { newBufferStop, newBoundary } from './utils/trackEndMarks'

// Outside the browser the store keeps its project in memory; the import
// reports and the settings still go to localStorage — a stub is all the node
// environment has to offer it.
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
    openProject({ id: 'p1', tracks: [], switches: [] })
    expect(canUndo()).toBe(false)

    // The way the switch forms commit: appended leg, branch tracks, record —
    // each with its own pushUndo, which the batch suppresses.
    withUndo(() => {
      saveTrack({ id: 't1', elements: [] })
      saveTrack({ id: 't2', elements: [] })
      saveSwitch({ switchId: 'sw1' })
    })

    expect(loadTracks()).toHaveLength(2)
    expect(loadSwitches()).toHaveLength(1)

    expect(undo()).toBe(true)
    expect(loadTracks()).toHaveLength(0)
    expect(loadSwitches()).toHaveLength(0)
    // One step for the whole switch — not one per mutation.
    expect(canUndo()).toBe(false)
  })
})

describe('deleting a whole network', () => {
  it('takes its tracks and their switches in one undo step', () => {
    openProject({ id: 'net2', tracks: [], switches: [] })
    for (const id of ['a', 'b', 'c', 'far']) saveTrack({ id, elements: [] })
    saveSwitch({ switchId: 'w', portA_trackId: 'a', portA_endpoint: 'END', portB1_trackId: 'b', portB1_endpoint: 'BEGIN', portB2_trackId: 'c', portB2_endpoint: 'BEGIN' })

    deleteTracks(['a', 'b', 'c'])
    expect(loadTracks().map(t => t.id)).toEqual(['far'])
    expect(loadSwitches()).toHaveLength(0)

    undo()
    expect(loadTracks().map(t => t.id).sort()).toEqual(['a', 'b', 'c', 'far'])
    expect(loadSwitches()).toHaveLength(1)
  })
})

describe('the reports an import leaves behind', () => {
  it('keeps them newest first, per project', () => {
    openProject({ id: 'r1', tracks: [], switches: [] })
    clearImportReports()
    saveImportReport({ source: 'a.mdb', lines: ['erste'], tracks: 2, switches: 1 })
    const all = saveImportReport({ source: 'b.mdb', lines: ['zweite'] })
    expect(all.map(r => r.source)).toEqual(['b.mdb', 'a.mdb'])
    expect(loadImportReports()[1].tracks).toBe(2)
    // Another project's reports are its own.
    openProject({ id: 'r2', tracks: [], switches: [] })
    expect(loadImportReports()).toEqual([])
    openProject({ id: 'r1', tracks: [], switches: [] })
    expect(loadImportReports()).toHaveLength(2)
  })

  it('stamps each with the time it was written', () => {
    clearImportReports()
    const before = Date.now()
    const [report] = saveImportReport({ source: 'a.mdb', lines: [] })
    expect(report.at).toBeGreaterThanOrEqual(before)
  })

  it('holds the last eight and no more', () => {
    clearImportReports()
    for (let i = 1; i <= 10; i++) saveImportReport({ source: `${i}.mdb`, lines: [] })
    const all = loadImportReports()
    expect(all).toHaveLength(8)
    expect(all[0].source).toBe('10.mdb')
    expect(all[7].source).toBe('3.mdb')
  })

  it('cuts a report too long to keep and says by how much', () => {
    clearImportReports()
    const lines = Array.from({ length: 4100 }, (_, i) => `Meldung ${i}`)
    const [report] = saveImportReport({ source: 'gross.mdb', lines })
    expect(report.lines).toHaveLength(4000)
    expect(report.cut).toBe(100)
  })

  it('survives a store that cannot be read', () => {
    openProject({ id: 'r6', tracks: [], switches: [] })
    localStorage.setItem('olt_reports_r6', 'not json')
    expect(loadImportReports()).toEqual([])
  })
})

describe('the title block of a project\'s plans', () => {
  it('is kept on the project, travels with its export, and stays out of undo', () => {
    openProject({ id: 'h1', tracks: [], switches: [] })
    expect(loadPlanHeader()).toBeNull()

    expect(savePlanHeader({ subtitle: 'Streckenband' })).toBe(true)
    expect(loadPlanHeader().subtitle).toBe('Streckenband')
    const exported = exportProjectsPayload().projects[0]
    expect(exported.planHeader.subtitle).toBe('Streckenband')

    saveTrack({ id: 'th', elements: [] })
    savePlanHeader({ subtitle: 'neu' })
    expect(undo()).toBe(true)
    expect(loadTracks()).toHaveLength(0)
    expect(loadPlanHeader().subtitle).toBe('neu')
  })
})

describe('buffer stops and boundaries in the store', () => {
  const el = (length) => ({ elementType: 0, length, bearing: 90, startNode: [0, 0], endNode: [length, 0] })
  const setup = (id) => {
    openProject({ id, tracks: [{ id: 't', elements: [el(10), el(20), el(30)] }], switches: [] })
    saveEndMark(newBufferStop('t', 'BEGIN', 4))
    saveEndMark(newBoundary('t', 'END'))
  }
  const where = () => loadEndMarks().map(m => [m.kind, m.trackId === 't' ? 't' : 'new', m.endpoint]).sort()

  it('keeps one mark per end, the latest', () => {
    setup('em1')
    saveEndMark(newBufferStop('t', 'END', 8))
    expect(loadEndMarks().map(m => [m.kind, m.endpoint]).sort())
      .toEqual([['buffer_stop', 'BEGIN'], ['buffer_stop', 'END']])
    deleteEndMark(loadEndMarks()[0].id)
    expect(loadEndMarks()).toHaveLength(1)
  })

  it('reverses with its track', () => {
    setup('em2')
    reverseTrackDirection('t')
    expect(where('em2')).toEqual([['boundary', 't', 'BEGIN'], ['buffer_stop', 't', 'END']])
  })

  it('stays on the outer end of each half when an element is deleted', () => {
    setup('em3')
    deleteElement('t', 1)
    const tracks = loadTracks()
    const marks = loadEndMarks()
    const head = tracks.find(t => t.elements[0].length === 10)
    const tail = tracks.find(t => t.elements[0].length === 30)
    expect(marks.find(m => m.kind === 'buffer_stop')).toMatchObject({ trackId: head.id, endpoint: 'BEGIN' })
    expect(marks.find(m => m.kind === 'boundary')).toMatchObject({ trackId: tail.id, endpoint: 'END' })
  })

  it('goes with its track, and when a switch takes its end', () => {
    setup('em4')
    commitSwitchConnection({
      removeTrackIds: [], addTracks: [], remap: [],
      addSwitches: [{ switchId: 's', kind: 'link', portA_trackId: 't', portA_endpoint: 'END', portB_trackId: 'x', portB_endpoint: 'BEGIN' }],
    })
    expect(where('em4')).toEqual([['buffer_stop', 't', 'BEGIN']])
    deleteTrack('t')
    expect(loadEndMarks()).toEqual([])
    // Undo brings back the track and the mark with it.
    undo()
    expect(loadEndMarks()).toHaveLength(1)
  })
})

describe('the id log of splits and joins (decision 93)', () => {
  const el = (length) => ({ elementType: 0, length, bearing: 90, startNode: [0, 0], endNode: [length, 0] })

  it('a split logs the old id and both pieces, and undo takes the entry back', () => {
    openProject({ id: 'log1', tracks: [{ id: 't', elements: [el(10), el(20), el(30)] }], switches: [] })
    expect(loadIdLog()).toEqual([])
    deleteElement('t', 1)
    const ids = loadTracks().map(t => t.id)
    expect(loadIdLog()).toEqual([{ from: 't', to: ids }])
    undo()
    expect(loadIdLog()).toEqual([])
  })

  it('a split at the end logs only the piece there is', () => {
    openProject({ id: 'log2', tracks: [{ id: 't', elements: [el(10), el(20)] }], switches: [] })
    deleteElement('t', 1)
    const [only] = loadTracks()
    expect(loadIdLog()).toEqual([{ from: 't', to: [only.id] }])
  })

  it('a join logs the track that went into the one that stays; a flip in place is no id change', () => {
    openProject({ id: 'log3', tracks: [{ id: 'head', elements: [el(10)] }], switches: [] })
    remapSwitchTrackIds([
      { oldId: 'tail', newId: 'head' },
      { oldId: 'head', newId: 'head', flip: true },
    ])
    expect(loadIdLog()).toEqual([{ from: 'tail', to: ['head'] }])
    remapSwitchTrackIds([{ oldId: 'other', newId: 'head', flip: true }])
    expect(loadIdLog()).toHaveLength(2)
    undo()
    expect(loadIdLog()).toEqual([{ from: 'tail', to: ['head'] }])
  })

  it('a switch laid into a track logs the split commitSwitchConnection makes', () => {
    openProject({ id: 'log4', tracks: [{ id: 'line', elements: [el(10)] }], switches: [] })
    commitSwitchConnection({
      removeTrackIds: ['line'],
      addTracks: [{ id: 'l1', elements: [el(4)] }, { id: 'l2', elements: [el(6)] }],
      addSwitches: [], remap: [{ oldId: 'line', newId: ['l1', 'l2'] }],
    })
    expect(loadIdLog()).toEqual([{ from: 'line', to: ['l1', 'l2'] }])
  })
})

describe('deleting a track with a switch on it', () => {
  it('leaves no element on the tracks that stay naming the switch that went', () => {
    const el = (props = {}) => ({ elementType: 0, length: 10, bearing: 90, startNode: [0, 0], endNode: [10, 0], ...props })
    openProject({ id: 'unmark', tracks: [
      { id: 'a', elements: [el()] },
      { id: 'b', elements: [el({ switchBranch: true, switchId: 'w', switchRoute: 'branch' })] },
      { id: 'c', elements: [el({ switchBranch: true, switchId: 'w', switchRoute: 'main' }), el()] },
    ], switches: [] })
    saveSwitch({ switchId: 'w', kind: 'turnout', portA_trackId: 'a', portA_endpoint: 'END', portB1_trackId: 'b', portB1_endpoint: 'BEGIN', portB2_trackId: 'c', portB2_endpoint: 'BEGIN' })
    deleteTrack('a')
    expect(loadSwitches()).toEqual([])
    // b was nothing but the switch's own geometry and goes with it; c stays, unmarked.
    expect(loadTracks().map(t => t.id)).toEqual(['c'])
    expect(loadTracks()[0].elements.some(e => e.switchId || e.switchBranch)).toBe(false)
  })
})

describe('the working copy of a variant (AP 10.6)', () => {
  const el = (length) => ({ elementType: 0, length, absLength: length, bearing: 90, startNode: [0, 0], endNode: [length, 0] })
  const record = () => ({ id: 'wp', title: 'P', tracks: [{ id: 't', epsg: 25832, elements: [el(10), el(20)] }], switches: [] })
  const base = { id: 7, number: 3 }

  it('is the one open project, rests on its base, and knows its own changes and splits', async () => {
    await closeWorkingCopy()
    openWorkingCopy({ variantId: 'v1', project: record(), base, basePayload: record() })
    expect(currentProject().id).toBe("wp")
    expect(canUndo()).toBe(false)
    deleteElement('t', 1)
    const wc = currentWorkingCopy()
    expect(wc).toMatchObject({ variantId: 'v1', projectId: 'wp', base })
    expect(wc.project.tracks.map(t => t.id)).not.toContain('t')
    expect(wc.project.tracks[0].elements[0].geometry).toBeUndefined()   // dehydrated
    expect(wc.idLog).toEqual([{ from: 't', to: [wc.project.tracks[0].id] }])
  })

  it('once checked in rests on the new revision, and its id log is spent', () => {
    const wc = currentWorkingCopy()
    markCheckedIn({ base: { id: 8, number: 4 }, basePayload: wc.project })
    expect(currentWorkingCopy()).toMatchObject({ base: { id: 8 }, idLog: [] })
  })

  it('takes a merged record in place, without undo into the other side\'s changes', () => {
    saveTrack({ id: 'x', elements: [] })
    expect(canUndo()).toBe(true)
    const merged = { ...record(), title: 'merged' }
    adoptWorkingCopy({ project: merged, base: { id: 9, number: 5 }, basePayload: merged })
    expect(currentProject().title).toBe('merged')
    expect(currentWorkingCopy().base.id).toBe(9)
    expect(canUndo()).toBe(false)
  })

  it('keeps the import reports per variant', () => {
    saveImportReport({ source: 'mdb', lines: [] })
    expect(localStorage.getItem('olt_reports_v1')).not.toBeNull()
    expect(localStorage.getItem('olt_reports_wp')).toBeNull()
  })
})

describe('the store works on the open project, immutably (R1.3)', () => {
  it('writes nothing and keeps no undo step while no project is open', async () => {
    await closeWorkingCopy()
    expect(currentProject()).toBeNull()
    expect(saveTrack({ id: 'x', elements: [] })).toBe(false)
    expect(deleteElement('x', 0)).toBe(false)
    expect(canUndo()).toBe(false)
  })

  it('makes a new project per write and leaves the old one as it was', () => {
    const el = { elementType: 0, length: 10, bearing: 90, startNode: [0, 0], endNode: [10, 0] }
    openProject({ id: 'imm', tracks: [{ id: 't', elements: [el] }], switches: [] })
    const before = currentProject()
    addElementToTrack('t', { ...el, startNode: [10, 0], endNode: [20, 0] })
    const after = currentProject()
    expect(after).not.toBe(before)
    expect(before.tracks[0].elements).toHaveLength(1)
    expect(after.tracks[0].elements).toHaveLength(2)
    expect(after.tracks[0].elements[1].absLength).toBe(20)
    // What a caller is handed cannot be changed behind the store's back.
    expect(() => { after.tracks[0].elements.push(el) }).toThrow(TypeError)
  })

  it('a write that finds nothing to change is no undo step', () => {
    openProject({ id: 'noop', tracks: [], switches: [] })
    deleteElement('missing', 0)
    reverseTrackDirection('missing')
    expect(canUndo()).toBe(false)
  })
})
