import { afterEach, describe, expect, it } from 'vitest'
import { setup, signIn } from './helpers.js'

let ctx
afterEach(async () => { await ctx?.app.close(); ctx?.db.close() })

const survey = (id, n = 2) => ({
  id, name: id, epsg: 25832, rail: '60E2',
  points: {
    st: Array.from({ length: n }, (_, k) => k), de: Array(n).fill(0), dn: Array(n).fill(0),
    zl: Array(n).fill(0), zr: Array(n).fill(0), ga: Array(n).fill(1435), q: Array(n).fill(1),
  },
})

async function start() {
  ctx = await setup()
  const max = await signIn(ctx.app, 'max')
  const ada = await signIn(ctx.app, 'ada')
  const res = await max('POST', '/api/projects', { title: 'P', payload: { tracks: [], switches: [], platforms: [], axisSurveys: [survey('a')] } })
  const { project, variantId, revisionId } = res.json()
  const users = (await ada('GET', '/api/admin/users')).json().users
  return { max, ada, project, variantId, revisionId, maxId: users.find(u => u.login === 'max').id }
}

const record = (project, axisSurveys) => ({ id: project.id, title: project.title, tracks: [], switches: [], platforms: [], axisSurveys })

describe('the right "Punktwolken bearbeiten" (decisions 203, 216)', () => {
  it('is off for a new user, set by the admin, and told by /me', async () => {
    const { max, ada, maxId } = await start()
    expect((await max('GET', '/api/me')).json().user.canEditClouds).toBe(false)
    expect((await ada('GET', '/api/me')).json().user.canEditClouds).toBe(false)
    expect((await max('PATCH', `/api/admin/users/${maxId}`, { canEditClouds: true })).statusCode).toBe(403)
    const res = await ada('PATCH', `/api/admin/users/${maxId}`, { canEditClouds: true })
    expect(res.json().user.canEditClouds).toBe(true)
    expect((await max('GET', '/api/me')).json().user.canEditClouds).toBe(true)
  })

  it('a check-in that changes measured axes needs it; one that leaves them as they were does not', async () => {
    const { max, ada, project, variantId, revisionId, maxId } = await start()
    const added = await max('POST', `/api/variants/${variantId}/revisions`, { base: revisionId, payload: record(project, [survey('a'), survey('b')]) })
    expect(added.statusCode).toBe(403)
    expect(added.json()).toMatchObject({ error: 'clouds_not_allowed', message: expect.stringContaining('Punktwolken bearbeiten') })
    expect((await max('POST', `/api/variants/${variantId}/revisions`, { base: revisionId, payload: record(project, []) })).statusCode).toBe(403)
    expect((await max('POST', `/api/variants/${variantId}/revisions`, { base: revisionId, payload: record(project, [survey('a', 3)]) })).statusCode).toBe(403)

    const same = await max('POST', `/api/variants/${variantId}/revisions`, { base: revisionId, payload: { ...record(project, [survey('a')]), tracks: [] } })
    expect(same.statusCode).toBe(201)

    await ada('PATCH', `/api/admin/users/${maxId}`, { canEditClouds: true })
    const now = same.json().revision.id
    expect((await max('POST', `/api/variants/${variantId}/revisions`, { base: now, payload: record(project, [survey('a'), survey('b')]) })).statusCode).toBe(201)
  })

  it('a merge may bring the other side\'s measured axes along without the right', async () => {
    const { max, ada, project, variantId, revisionId } = await start()
    const branch = (await ada('POST', `/api/projects/${project.id}/variants`, { name: 'B', fromVariant: variantId })).json().variant
    const theirs = (await ada('POST', `/api/variants/${branch.id}/revisions`, { base: revisionId, payload: record(project, [survey('a'), survey('b')]) })).json().revision
    const merged = await max('POST', `/api/variants/${variantId}/revisions`, {
      base: revisionId, mergeParent: theirs.id, payload: record(project, [survey('a'), survey('b')]),
    })
    expect(merged.statusCode).toBe(201)
  })
})
