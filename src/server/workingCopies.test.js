import { describe, it, expect, beforeAll } from 'vitest'
import { canUndo, currentProject, deleteElement, saveImportReport, saveTrack } from '../core/storage'
import { adoptWorkingCopy, closeWorkingCopy, currentWorkingCopy, markCheckedIn, openWorkingCopy } from './workingCopies'

// Outside the browser the working copy lives in memory; the import reports
// still go to localStorage — a stub is all the node environment has to offer.
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

