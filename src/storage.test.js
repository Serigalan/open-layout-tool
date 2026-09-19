import { describe, it, expect, beforeAll } from 'vitest'
import {
  withUndo, saveProject, saveTrack, saveSwitch, loadTracks, loadSwitches,
  undo, canUndo,
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
