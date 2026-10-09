import { describe, it, expect, beforeAll } from 'vitest'
import { sleeperAtX, xAtMain } from './test/turnoutFixture'
import {
  withUndo, openProject, saveTrack, saveSwitch, loadTracks, loadSwitches,
  undo, canUndo, loadImportReports, saveImportReport, clearImportReports,
  loadPlanHeader, savePlanHeader, exportProjectsPayload,
  saveEndMark, loadEndMarks, deleteEndMark, deleteElement, deleteElements, reverseTrackDirection, deleteTrack,
  commitSwitchConnection, deleteTracks, remapSwitchTrackIds, loadIdLog,
  openWorkingCopy, currentWorkingCopy, markCheckedIn, adoptWorkingCopy, closeWorkingCopy, currentProject,
  addElementToTrack, redo, canRedo, undoStep, redoStep, hiddenTracks, setTracksHidden, subscribe,
  setTrackHeights, setHeightsForTracks, commitReconnect, loadPlatforms, updateSwitch, lastStep,
} from './storage'
import { newBufferStop, newBoundary } from './utils/trackEndMarks'
import { endPointCurvedUtm, endPointStraightUtm } from './utils/elementUtils'

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

describe('deleting several elements at once', () => {
  // Five straights of 100 m end to end, climbing 1 m per 100 m; one point at
  // 250 m rounds a change from 10 to 20 per mille with R 10000 (T = 50 m).
  const el = (i) => ({ elementType: 0, length: 100, bearing: 90, startNode: [i * 100, 0], endNode: [i * 100 + 100, 0] })
  const heights = [{ station: 0, z: 100 }, { station: 250, z: 102.5, rv: 10000 }, { station: 500, z: 107.5 }]
  const setup = (id, extra = {}) => openProject({
    id, tracks: [{ id: 't', name: '5550.00200', elements: [0, 1, 2, 3, 4].map(el), heights }], switches: [], ...extra,
  })

  it('leaves the runs between them as tracks, in one undo step', () => {
    setup('md1')
    deleteElements([{ trackId: 't', elementIndex: 1 }, { trackId: 't', elementIndex: 3 }])
    const tracks = loadTracks()
    expect(tracks.map(t => t.elements.length)).toEqual([1, 1, 1])
    expect(tracks[0].name).toBe('5550.00200')
    expect(new Set(tracks.map(t => t.name)).size).toBe(3)
    undo()
    expect(loadTracks().map(t => t.id)).toEqual(['t'])
  })

  it('gives each run a height point at its cuts, on the gradient as built', () => {
    setup('md2')
    deleteElements([{ trackId: 't', elementIndex: 1 }, { trackId: 't', elementIndex: 3 }])
    const [a, b, c] = loadTracks()
    expect(a.heights).toEqual([{ station: 0, z: 100 }, { station: 100, z: 101 }])
    // 200–300 m: the curve from 200 to 300 m, cut at both of its tangent points.
    expect(b.heights[0]).toEqual({ station: 0, z: 102 })
    expect(b.heights.at(-1).station).toBe(100)
    expect(b.heights.at(-1).z).toBeCloseTo(103.5, 9)
    expect(b.heights.some(p => p.rv === 10000)).toBe(true)
    expect(c.heights).toEqual([{ station: 0, z: expect.closeTo(105.5, 9) }, { station: 100, z: 107.5 }])
  })

  it('takes the switch at a deleted end with it, and moves a platform onto its run', () => {
    setup('md3', {
      tracks: [
        { id: 't', name: 'a.001', elements: [0, 1, 2].map(el) },
        { id: 'b', elements: [{ ...el(3), switchBranch: true, switchId: 'w', switchRoute: 'branch' }] },
      ],
      platforms: [{ id: 'pl', trackId: 't', startStation: 220, endStation: 280 }, { id: 'p2', trackId: 't', startStation: 50, endStation: 150 }],
    })
    saveSwitch({ switchId: 'w', kind: 'turnout', portA_trackId: 't', portA_endpoint: 'END', portB1_trackId: 'b', portB1_endpoint: 'BEGIN', portB2_trackId: 'x', portB2_endpoint: 'BEGIN' })
    deleteElements([{ trackId: 't', elementIndex: 1 }])
    expect(loadSwitches()).toHaveLength(1)
    deleteElements([{ trackId: loadTracks().find(t => t.elements[0].startNode[0] === 200).id, elementIndex: 0 }])
    // The switch stood at the end that went: it goes with its branch.
    expect(loadSwitches()).toEqual([])
    expect(loadTracks().map(t => t.elements[0].startNode[0])).toEqual([0])
    undo()
    const plat = currentProject().platforms
    expect(plat).toEqual([{ id: 'pl', trackId: loadTracks().find(t => t.elements[0].startNode[0] === 200).id, startStation: 20, endStation: 80 }])
  })
})

describe('reconnecting a stretch (Paket N)', () => {
  it('writes the track back and re-stations the platforms along it, in one undo step', () => {
    const el = (i) => ({ elementType: 0, length: 100, bearing: 90, startNode: [i * 100, 0], endNode: [i * 100 + 100, 0] })
    openProject({
      id: 'rc1', tracks: [{ id: 't', name: 't', elements: [0, 1, 2].map(el) }, { id: 'u', name: 'u', elements: [el(5)] }],
      switches: [],
      platforms: [{ id: 'p', trackId: 't', startStation: 220, endStation: 280 }, { id: 'q', trackId: 'u', startStation: 10, endStation: 20 }],
    })
    const map = (s) => (s > 200 ? s + 0.5 : s)
    commitReconnect({ id: 't', name: 't', elements: [el(0), el(1), { ...el(2), length: 100.5 }] }, map)
    expect(loadTracks().find(t => t.id === 't').elements[2].length).toBe(100.5)
    expect(loadPlatforms().map(p => [p.startStation, p.endStation])).toEqual([[220.5, 280.5], [10, 20]])
    undo()
    expect(loadTracks().find(t => t.id === 't').elements[2].length).toBe(100)
    expect(loadPlatforms()[0].startStation).toBe(220)
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

describe('redo (R10.1)', () => {
  const tr = (id) => ({ id, name: id, epsg: 25832, elements: [] })

  it('brings back what undo took, and a new step forgets it', () => {
    openProject({ id: 'p', title: 'P', tracks: [], switches: [], platforms: [] })
    saveTrack(tr('a'))
    saveTrack(tr('b'))
    const withB = currentProject()
    expect(undo()).toBe(true)
    expect(loadTracks().map(t => t.id)).toEqual(['a'])
    expect(canRedo()).toBe(true)
    expect(redoStep()).toEqual({ before: currentProject(), after: withB })
    expect(redo()).toBe(true)
    expect(currentProject()).toBe(withB)
    expect(canRedo()).toBe(false)
    undo()
    saveTrack(tr('c'))
    expect(canRedo()).toBe(false)
    expect(redo()).toBe(false)
    expect(loadTracks().map(t => t.id)).toEqual(['a', 'c'])
  })

  it('walks back and forth over several steps', () => {
    openProject({ id: 'p', title: 'P', tracks: [], switches: [], platforms: [] })
    saveTrack(tr('a')); saveTrack(tr('b')); saveTrack(tr('c'))
    undo(); undo()
    expect(loadTracks().map(t => t.id)).toEqual(['a'])
    redo()
    expect(loadTracks().map(t => t.id)).toEqual(['a', 'b'])
    redo()
    expect(loadTracks().map(t => t.id)).toEqual(['a', 'b', 'c'])
    expect(canUndo()).toBe(true)
  })

  it('names the step it would take, the same object while nothing changes', () => {
    openProject({ id: 'p', title: 'P', tracks: [], switches: [], platforms: [] })
    expect(undoStep()).toBe(null)
    saveTrack(tr('a'))
    const step = undoStep()
    expect(step.after.tracks.map(t => t.id)).toEqual(['a'])
    expect(step.before.tracks).toEqual([])
    expect(undoStep()).toBe(step)
  })
})

describe('tracks hidden on the map', () => {
  it('are kept per project on this device, outside the record and the undo', () => {
    openProject({ id: 'h1', tracks: [{ id: 'a', elements: [] }, { id: 'b', elements: [] }], switches: [] })
    expect(hiddenTracks().size).toBe(0)
    let told = 0
    const stop = subscribe(() => { told++ })
    setTracksHidden(['a', 'b'], true)
    setTracksHidden(['b'], false)
    stop()
    expect([...hiddenTracks()]).toEqual(['a'])
    expect(told).toBe(2)
    // The same set until it changes, as a subscription wants it.
    expect(hiddenTracks()).toBe(hiddenTracks())
    expect(canUndo()).toBe(false)
    expect(currentProject().hiddenTracks).toBeUndefined()

    openProject({ id: 'h2', tracks: [], switches: [] })
    expect(hiddenTracks().size).toBe(0)
    openProject({ id: 'h1', tracks: [], switches: [] })
    expect([...hiddenTracks()]).toEqual(['a'])
    setTracksHidden(['a'], false)
    expect(localStorage.getItem('olt_hidden_tracks_h1')).toBeNull()
  })
})

describe('the gradient of a turnout is coupled', () => {
  // A 500 – 1:12 laid at (1000, 1000), its body 30 m long: the main route
  // straight east, the branch on R 500 to the left. The catalogue puts the
  // ldS 6.334 m behind WE.
  const START = { easting: 1000, northing: 1000, zone: 5684 }
  const node = (p) => [p.easting, p.northing]
  const WE = endPointStraightUtm(START, 90, 30)
  const BE = endPointCurvedUtm(START, 90, 30, -500)
  const turned = 90 - (30 / 500) * 180 / Math.PI
  // The ldS sleeper leans with the bisector (decision 256): it meets the
  // branch LDS.branch along it, LDS.q[1] to the left and LDS.q[0] east of WA.
  const LDS = sleeperAtX(xAtMain(36.334))
  const project = () => ({
    id: 'coupled',
    tracks: [
      { id: 'm', epsg: 5684, elements: [
        { elementType: 0, startNode: node(START), endNode: node(WE), bearing: 90, length: 30, cant: 60,
          switchId: 's1', switchRoute: 'main' },
        { elementType: 0, startNode: node(WE), endNode: node(endPointStraightUtm(WE, 90, 30)), bearing: 90,
          length: 30, cant: 60 },
      ], heights: [{ station: 0, z: 100 }, { station: 60, z: 100.6 }] },
      { id: 'b', epsg: 5684, elements: [
        { elementType: 1, startNode: node(START), endNode: node(BE), bearing: 90, endBearing: turned, radius: -500,
          length: 30, switchId: 's1', switchRoute: 'branch' },
        { elementType: 1, startNode: node(BE), endNode: node(endPointCurvedUtm(BE, turned, 30, -500)),
          bearing: turned, radius: -500, length: 30 },
      ], heights: [{ station: 0, z: 100 }, { station: 60, z: 100.2 }] },
    ],
    switches: [{
      switchId: 's1', kind: 'turnout', label: '500 – 1:12',
      portB1_trackId: 'b', portB1_endpoint: 'BEGIN', portB2_trackId: 'm', portB2_endpoint: 'BEGIN',
    }],
  })
  const branch = () => loadTracks().find(t => t.id === 'b').heights
  const expected = (slope) => 100 + slope * LDS.q[0] + 0.06 * LDS.q[1] / 1.5

  it('follows a height edited on the main route, and undoes with it in one step', () => {
    openProject(project())
    expect(branch()).toHaveLength(2)          // opened as it was: nothing written yet
    setTrackHeights('m', [{ station: 0, z: 100 }, { station: 60, z: 101.2 }])
    const ldsPoint = branch()[1]
    expect(ldsPoint.station).toBeCloseTo(LDS.branch, 2)
    expect(ldsPoint.z).toBeCloseTo(expected(1.2 / 60), 3)
    undo()
    expect(branch()).toHaveLength(2)
    expect(loadTracks().find(t => t.id === 'm').heights[1].z).toBe(100.6)
  })

  it('moves the main route along when the branch is edited there, and undoes both in one step', () => {
    openProject(project())
    // A write to the branch reaches the turnout as well: it is paired at once.
    setHeightsForTracks(new Map([['b', [{ station: 0, z: 100 }, { station: 60, z: 100.2 }]]]))
    const coupled = branch()
    expect(coupled).toHaveLength(3)
    const main = () => loadTracks().find(t => t.id === 'm').heights
    setHeightsForTracks(new Map([['b', coupled.map((p, i) => (i === 1 ? { ...p, z: p.z + 0.05 } : p))]]))
    expect(branch()[1].z).toBeCloseTo(expected(0.6 / 60) + 0.05, 3)
    // The main route gets a point on the ldS, 50 mm up as well.
    expect(main()).toHaveLength(3)
    expect(main()[1].station).toBeCloseTo(36.334, 3)
    // Rounded to the mm on the branch and again on the main route.
    expect(Math.abs(main()[1].z - (100 + 0.01 * 36.334 + 0.05))).toBeLessThan(0.0011)
    undo()
    expect(main()).toHaveLength(2)
    expect(branch()[1].z).toBeCloseTo(expected(0.6 / 60), 3)
  })

  it('refuses a write that would change the heights of a locked turnout, and says which', () => {
    openProject(project())
    setHeightsForTracks(new Map([['b', [{ station: 0, z: 100 }, { station: 60, z: 100.2 }]]]))
    updateSwitch('s1', { name: 'W1', heightsLocked: true })
    const was = currentProject()
    const undoable = canUndo()
    expect(setTrackHeights('m', [{ station: 0, z: 100 }, { station: 20, z: 100.5 }, { station: 60, z: 100.6 }])).toBe(false)
    expect(currentProject()).toBe(was)
    expect(lastStep()).toMatchObject({ kind: 'refused', refused: ['W1'] })
    expect(canUndo()).toBe(undoable)
    // Beyond the turnout's stretch the track is as free as ever.
    expect(setTrackHeights('m', [{ station: 0, z: 100 }, { station: 60, z: 100.7 }])).toBe(false)
    expect(setTrackHeights('b', [...branch().slice(0, 2), { station: 60, z: 100.3 }])).toBe(true)
    // Unlocked, the same write goes through.
    updateSwitch('s1', { heightsLocked: undefined })
    expect(setTrackHeights('m', [{ station: 0, z: 100 }, { station: 20, z: 100.5 }, { station: 60, z: 100.6 }])).toBe(true)
  })
})

