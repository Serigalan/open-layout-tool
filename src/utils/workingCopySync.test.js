import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { closeWorkingCopy, currentWorkingCopy, loadIdLog, openWorkingCopy, saveTrack, undo } from '../storage'
import { checkIn, localChanges, prepareUpdate, revertToHead } from './workingCopySync'

beforeAll(() => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i] ?? null, get length() { return store.size },
  }
})

const straight = (id, y) => ({
  id, name: id, epsg: 25832,
  elements: [{ elementType: 0, bearing: 90, length: 100, absLength: 100, startNode: [500000, 5700000 + y], endNode: [500100, 5700000 + y] }],
})
const base = { id: 'p', title: 'P', tracks: [straight('t1', 0)], switches: [], platforms: [] }

/** A fetch that answers from a table of `METHOD path` → [status, body], and records what it was sent. */
function serve(routes) {
  const sent = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`
    sent.push({ key, body: init.body ? JSON.parse(init.body) : undefined })
    const [status, body] = routes[key] ?? [404, { error: 'not_found' }]
    return { status, ok: status < 400, json: async () => body }
  })
  return sent
}

afterEach(async () => { await closeWorkingCopy() })

describe('checking the working copy in', () => {
  it('sends the record, its base and its id log, and rests on the new revision after', async () => {
    openWorkingCopy({ variantId: 'v', project: base, base: { id: 1, number: 1 }, basePayload: base })
    saveTrack(straight('t2', 50))
    expect(localChanges().map(e => [e.kind, e.id])).toEqual([['added', 't2']])
    const sent = serve({ 'POST /api/variants/v/revisions': [201, { revision: { id: 2, number: 2 } }] })
    const res = await checkIn('neu')
    expect(res.revision.id).toBe(2)
    expect(sent[0].body).toMatchObject({ base: 1, message: 'neu', remaps: [], payload: { id: 'p' } })
    expect(sent[0].body.payload.tracks.map(t => t.id)).toEqual(['t1', 't2'])
    expect(currentWorkingCopy().base.id).toBe(2)
    expect(localChanges()).toEqual([])
  })

  it('reports a stale base instead of failing, and the update merges the head in', async () => {
    openWorkingCopy({ variantId: 'v', project: base, base: { id: 1, number: 1 }, basePayload: base })
    saveTrack(straight('mine', 50))
    const theirs = { ...base, tracks: [...base.tracks, straight('theirs', 100)] }
    serve({
      'POST /api/variants/v/revisions': [409, { error: 'stale_base', head: { id: 3 } }],
      'GET /api/variants/v': [200, { variant: { head: { id: 3, number: 3 } } }],
      'GET /api/revisions/3': [200, { revision: { id: 3, number: 3, author: { name: 'Schulz' } }, payload: theirs }],
      'GET /api/revisions/3/remaps?base=1': [200, { remaps: [] }],
    })
    expect(await checkIn('x')).toEqual({ stale: true })
    const prepared = await prepareUpdate()
    expect(prepared.head.id).toBe(3)
    expect(prepared.result.conflicts).toEqual([])
    expect(prepared.result.merged.tracks.map(t => t.id).sort()).toEqual(['mine', 't1', 'theirs'])
  })
})

describe('throwing the local changes away', () => {
  it('makes the working copy the server head, with no changes, no id log and nothing to undo', async () => {
    openWorkingCopy({ variantId: 'v', project: base, base: { id: 1, number: 1 }, basePayload: base,
      idLog: [{ from: 't1', to: ['t1a', 't1b'] }] })
    saveTrack(straight('mine', 50))
    const theirs = { ...base, tracks: [...base.tracks, straight('theirs', 100)] }
    serve({ 'GET /api/variants/v/head': [200, { revision: { id: 3, number: 3 }, payload: theirs }] })
    const revision = await revertToHead()
    expect(revision.id).toBe(3)
    expect(currentWorkingCopy().base.id).toBe(3)
    expect(currentWorkingCopy().project.tracks.map(t => t.id)).toEqual(['t1', 'theirs'])
    expect(localChanges()).toEqual([])
    expect(loadIdLog()).toEqual([])
    undo()
    expect(currentWorkingCopy().project.tracks.map(t => t.id)).toEqual(['t1', 'theirs'])
  })
})
