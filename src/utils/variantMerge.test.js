import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setup, signIn } from '../../tools/server/test/helpers.js'
import { commitVariantMerge, prepareVariantMerge } from './variantMerge'

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

let ctx, user
beforeEach(async () => {
  ctx = await setup()
  user = await signIn(ctx.app, 'max')
  // The browser's fetch, answered by the server in this process.
  globalThis.fetch = async (url, init = {}) => {
    const res = await ctx.app.inject({
      method: init.method ?? 'GET', url, headers: init.headers, payload: init.body,
      cookies: { olt_session: user.token },
    })
    return { status: res.statusCode, ok: res.statusCode < 400, json: async () => res.json() }
  }
})
afterEach(async () => { await ctx.app.close(); ctx.db.close() })

async function checkIn(variantId, change, message = '') {
  const head = (await user('GET', `/api/variants/${variantId}/head`)).json()
  const payload = change(structuredClone(head.payload))
  const res = await user('POST', `/api/variants/${variantId}/revisions`, { base: head.revision.id, payload, remaps: [], message })
  expect(res.statusCode).toBe(201)
  return res.json().revision
}

describe('merging one variant into another (AP 10.8)', () => {
  it('takes the source\'s changes, and the second time only the new ones', async () => {
    const created = (await user('POST', '/api/projects', { title: 'P', payload: { tracks: [straight('t1', 0)] } })).json()
    const bestand = created.variantId
    const v2030 = (await user('POST', `/api/projects/${created.projectId}/variants`, { name: '2030', fromVariant: bestand })).json().variant.id

    await checkIn(bestand, p => ({ ...p, tracks: [...p.tracks, straight('b1', 50)] }), 'Korrektur Bestand')
    await checkIn(v2030, p => ({ ...p, tracks: [...p.tracks, straight('n1', 100)] }), 'Neubau 2030')

    const first = await prepareVariantMerge(bestand, v2030)
    expect(first.result.conflicts).toEqual([])
    expect(first.result.applied.map(a => [a.kind, a.id])).toEqual([['added', 'b1']])
    expect(first.result.merged.tracks.map(t => t.id).sort()).toEqual(['b1', 'n1', 't1'])
    const merged = await commitVariantMerge(first, first.result.merged, 'Bestand → 2030')
    expect(merged.revision.mergeParentId).toBe(first.source.revision.id)

    await checkIn(bestand, p => ({ ...p, tracks: [...p.tracks, straight('b2', 150)] }), 'Noch eine Korrektur')
    const second = await prepareVariantMerge(bestand, v2030)
    expect(second.base.id).toBe(first.source.revision.id)
    expect(second.result.applied.map(a => [a.kind, a.id])).toEqual([['added', 'b2']])
    await commitVariantMerge(second, second.result.merged, 'Bestand → 2030')

    expect((await prepareVariantMerge(bestand, v2030)).upToDate).toBe(true)
    const head = (await user('GET', `/api/variants/${v2030}/head`)).json()
    expect(head.payload.tracks.map(t => t.id).sort()).toEqual(['b1', 'b2', 'n1', 't1'])
  })

  it('shows a conflict where both changed the same thing', async () => {
    const created = (await user('POST', '/api/projects', { title: 'P', payload: { tracks: [straight('t1', 0)] } })).json()
    const bestand = created.variantId
    const v2030 = (await user('POST', `/api/projects/${created.projectId}/variants`, { name: '2030', fromVariant: bestand })).json().variant.id
    await checkIn(bestand, p => ({ ...p, tracks: p.tracks.map(t => ({ ...t, name: 'Bestandsname' })) }))
    await checkIn(v2030, p => ({ ...p, tracks: p.tracks.map(t => ({ ...t, name: '2030-Name' })) }))
    const prepared = await prepareVariantMerge(bestand, v2030)
    expect(prepared.result.conflicts).toEqual([expect.objectContaining({ objectId: 't1', field: 'name', mine: '2030-Name', theirs: 'Bestandsname' })])
  })
})
