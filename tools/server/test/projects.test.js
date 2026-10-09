import { afterEach, describe, expect, it } from 'vitest'
import { PW, setup, signIn } from './helpers.js'
import { hasPek, loadPek } from '../../../src/core/test/pekFixture.js'

let ctx
afterEach(async () => { await ctx?.app.close(); ctx?.db.close() })

const straight = (id, y = 0) => ({
  id, name: id, epsg: 25832,
  elements: [{ elementType: 0, bearing: 90, length: 100, absLength: 100, startNode: [500000, 5700000 + y], endNode: [500100, 5700000 + y] }],
})

async function start() {
  ctx = await setup()
  const max = await signIn(ctx.app, 'max')
  const ada = await signIn(ctx.app, 'ada')
  return { max, ada }
}

async function newProject(user, payload) {
  const res = await user('POST', '/api/projects', { title: 'Halle–Könnern', description: 'Test', ...(payload ? { payload } : {}) })
  expect(res.statusCode).toBe(201)
  return res.json()
}

async function head(user, variantId) {
  return (await user('GET', `/api/variants/${variantId}/head`)).json()
}

describe('projects', () => {
  it('a new project without a record has an empty "Bestand" at revision 1', async () => {
    const { max } = await start()
    const { project, variantId } = await newProject(max)
    expect(project.variants).toEqual([expect.objectContaining({ name: 'Bestand', parentVariantId: null, head: expect.objectContaining({ number: 1 }) })])
    const h = await head(max, variantId)
    expect(h.payload).toMatchObject({ id: project.id, title: 'Halle–Könnern', tracks: [] })
  })

  it.skipIf(!hasPek)('a new project with a record (an import) keeps it, under the project id', async () => {
    const { max } = await start()
    const pek = loadPek()
    const { project, variantId, errors } = await newProject(max, pek)
    expect(errors).toEqual([])
    const h = await head(max, variantId)
    expect(h.payload.id).toBe(project.id)
    expect(h.payload.tracks).toHaveLength(22)
    expect(h.payload.switches).toHaveLength(13)
  })

  it('refuses a record from before the switch model', async () => {
    const { max } = await start()
    const res = await max('POST', '/api/projects', {
      title: 'alt', payload: { tracks: [], switches: [{ name: 'switch.001' }] },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: 'invalid_payload' })
  })

  it('a project is its creator\'s and the admins\'; only they delete it', async () => {
    const { max, ada } = await start()
    const { project } = await newProject(ada)
    expect((await max('GET', '/api/projects')).json().projects).toEqual([])
    expect((await max('DELETE', `/api/projects/${project.id}`)).statusCode).toBe(404)
    const own = await newProject(max)
    expect((await ada('GET', '/api/projects')).json().projects.map(p => p.id).sort())
      .toEqual([project.id, own.project.id].sort())
    expect((await max('DELETE', `/api/projects/${own.project.id}`)).statusCode).toBe(204)
    expect((await ada('DELETE', `/api/projects/${project.id}`)).statusCode).toBe(204)
    expect((await ada('GET', '/api/projects')).json().projects).toEqual([])
  })

  it('a template is the admin\'s; everyone branches a variant of their own off it', async () => {
    const { max, ada } = await start()
    expect((await max('POST', '/api/projects', { title: 'Vorlage', template: true })).statusCode).toBe(403)
    const { project, variantId, revisionId } = (await ada('POST', '/api/projects', { title: 'Vorlage', template: true })).json()
    expect(project).toMatchObject({ template: true, variants: [expect.objectContaining({ name: 'Vorlage' })] })
    const h = await head(max, variantId)
    const edit = { base: revisionId, payload: { ...h.payload, title: 'x' }, remaps: [] }
    expect((await max('POST', `/api/variants/${variantId}/revisions`, edit)).json()).toEqual({ error: 'template_admin' })
    expect((await max('PATCH', `/api/variants/${variantId}`, { name: 'x' })).statusCode).toBe(403)
    expect((await max('PATCH', `/api/projects/${project.id}`, { title: 'x' })).statusCode).toBe(403)
    expect((await max('DELETE', `/api/projects/${project.id}`)).statusCode).toBe(403)

    const own = (await max('POST', `/api/projects/${project.id}/variants`, { name: 'Meine', fromVariant: variantId })).json().variant
    expect((await max('POST', `/api/variants/${own.id}/revisions`, edit)).statusCode).toBe(201)
    expect((await max('PATCH', `/api/variants/${own.id}`, { name: 'Meine 2' })).statusCode).toBe(200)
    expect((await ada('POST', `/api/variants/${variantId}/revisions`, edit)).statusCode).toBe(201)
  })

  it('needs a session', async () => {
    ctx = await setup()
    expect((await ctx.app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(401)
  })
})

describe('variants and revisions', () => {
  it('branching copies nothing: the new variant starts at the same revision', async () => {
    const { max } = await start()
    const { project, variantId, revisionId } = await newProject(max, { tracks: [straight('t1')] })
    const res = await max('POST', `/api/projects/${project.id}/variants`, { name: '2030', fromVariant: variantId })
    expect(res.statusCode).toBe(201)
    const v = res.json().variant
    expect(v).toMatchObject({ name: '2030', parentVariantId: variantId, head: expect.objectContaining({ id: revisionId }) })
    expect(ctx.db.prepare('SELECT COUNT(*) FROM revision').pluck().get()).toBe(1)
  })

  it('checks in on the head, and refuses a stale base with the head', async () => {
    const { max, ada } = await start()
    const { variantId, revisionId } = await newProject(max, { tracks: [straight('t1')] })
    const h = await head(max, variantId)
    const mine = { ...h.payload, tracks: [straight('t1'), straight('t2', 50)] }
    const ok = await max('POST', `/api/variants/${variantId}/revisions`, { base: revisionId, message: 'Gleis 2', payload: mine, remaps: [] })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().revision).toMatchObject({ number: 2, parentId: revisionId, message: 'Gleis 2', author: { name: 'Max Muster' } })

    const theirs = { ...h.payload, title: 'anders' }
    const stale = await ada('POST', `/api/variants/${variantId}/revisions`, { base: revisionId, message: '', payload: theirs, remaps: [] })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ error: 'stale_base', head: { id: ok.json().revision.id } })
  })

  it('refuses a record that brings new errors, with the errors', async () => {
    const { max } = await start()
    const { variantId, revisionId } = await newProject(max, { tracks: [straight('t1')] })
    const h = await head(max, variantId)
    const bad = { ...h.payload, platforms: [{ id: 'pf', trackId: 'nowhere', startStation: 0, endStation: 10 }] }
    const res = await max('POST', `/api/variants/${variantId}/revisions`, { base: revisionId, payload: bad, remaps: [] })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ error: 'invalid_record', errors: [expect.objectContaining({ code: 'platform_track_missing' })] })
  })

  it('takes errors the base already had: they are not this check-in\'s doing', async () => {
    const { max } = await start()
    const broken = { tracks: [straight('t1')], platforms: [{ id: 'pf', trackId: 'nowhere', startStation: 0, endStation: 10 }] }
    const { variantId, revisionId, errors } = await newProject(max, broken)
    expect(errors.map(e => e.code)).toEqual(['platform_track_missing'])
    const h = await head(max, variantId)
    const res = await max('POST', `/api/variants/${variantId}/revisions`, { base: revisionId, payload: { ...h.payload, title: 'x' }, remaps: [] })
    expect(res.statusCode).toBe(201)
  })

  it('of two check-ins on the same base exactly one wins', async () => {
    const { max, ada } = await start()
    const { variantId, revisionId } = await newProject(max, { tracks: [straight('t1')] })
    const h = await head(max, variantId)
    const [a, b] = await Promise.all([
      max('POST', `/api/variants/${variantId}/revisions`, { base: revisionId, payload: { ...h.payload, title: 'a' }, remaps: [] }),
      ada('POST', `/api/variants/${variantId}/revisions`, { base: revisionId, payload: { ...h.payload, title: 'b' }, remaps: [] }),
    ])
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409])
    expect(ctx.db.prepare('SELECT COUNT(*) FROM revision').pluck().get()).toBe(2)
  })

  it('refuses a record of another project', async () => {
    const { max } = await start()
    const { variantId, revisionId } = await newProject(max)
    const h = await head(max, variantId)
    const res = await max('POST', `/api/variants/${variantId}/revisions`, { base: revisionId, payload: { ...h.payload, id: 'other' }, remaps: [] })
    expect(res.json()).toEqual({ error: 'project_mismatch' })
  })

  it('finds the common base after branching, and after a merge the merge itself', async () => {
    const { max } = await start()
    const { project, variantId: bestand, revisionId: r1 } = await newProject(max, { tracks: [straight('t1')] })
    const v2030 = (await max('POST', `/api/projects/${project.id}/variants`, { name: '2030', fromVariant: bestand })).json().variant.id
    const checkIn = async (variant, base, change, extra = {}) => {
      const h = await head(max, variant)
      const res = await max('POST', `/api/variants/${variant}/revisions`, { base, payload: { ...h.payload, ...change }, remaps: [], ...extra })
      expect(res.statusCode).toBe(201)
      return res.json().revision.id
    }
    const b2 = await checkIn(bestand, r1, { description: 'Korrektur' })
    const n2 = await checkIn(v2030, r1, { title: '2030' })
    const base = (await max('GET', `/api/revisions/${b2}/base/${n2}`)).json().base
    expect(base.id).toBe(r1)

    // Bestand → 2030, the merge carrying Bestand's head as its second parent.
    const merged = await checkIn(v2030, n2, { description: 'Korrektur' }, { mergeParent: b2 })
    expect((await max('GET', `/api/revisions/${b2}/base/${merged}`)).json().base.id).toBe(b2)
    const b3 = await checkIn(bestand, b2, { description: 'Noch eine' })
    expect((await max('GET', `/api/revisions/${b3}/base/${merged}`)).json().base.id).toBe(b2)

    // How far Bestand is ahead of 2030: one revision since the merge.
    const list = (await max('GET', '/api/projects')).json().projects[0].variants
    expect(list.find(v => v.id === v2030).parentAhead).toBe(1)
  })

  it('collects the id logs a head has and a base has not', async () => {
    const { max } = await start()
    const { variantId, revisionId: r1 } = await newProject(max, { tracks: [straight('t1')] })
    const h = await head(max, variantId)
    const split = { ...h.payload, tracks: [straight('a'), straight('b', 50)] }
    const r2 = (await max('POST', `/api/variants/${variantId}/revisions`, { base: r1, payload: split, remaps: [{ from: 't1', to: ['a', 'b'] }] })).json().revision.id
    const r3 = (await max('POST', `/api/variants/${variantId}/revisions`, { base: r2, payload: { ...split, title: 'x' }, remaps: [{ from: 'b', to: ['a'] }] })).json().revision.id
    expect((await max('GET', `/api/revisions/${r3}/remaps?base=${r1}`)).json().remaps).toEqual([{ from: 't1', to: ['a', 'b'] }, { from: 'b', to: ['a'] }])
    expect((await max('GET', `/api/revisions/${r3}/remaps?base=${r2}`)).json().remaps).toEqual([{ from: 'b', to: ['a'] }])
  })

  it('lists a variant\'s history from its head back', async () => {
    const { max } = await start()
    const { variantId, revisionId: r1 } = await newProject(max)
    const h = await head(max, variantId)
    await max('POST', `/api/variants/${variantId}/revisions`, { base: r1, message: 'zwei', payload: { ...h.payload, title: 'x' }, remaps: [] })
    const list = (await max('GET', `/api/variants/${variantId}/revisions`)).json().revisions
    expect(list.map(r => [r.number, r.message])).toEqual([[2, 'zwei'], [1, '']])
  })

  it('renames and archives a variant', async () => {
    const { max } = await start()
    const { variantId } = await newProject(max)
    const res = await max('PATCH', `/api/variants/${variantId}`, { name: 'Ist', archived: true })
    expect(res.json().variant).toMatchObject({ name: 'Ist', archived: true })
  })
})

describe('images', () => {
  it('are stored once by hash and served back', async () => {
    const { max } = await start()
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    const put = await max('PUT', '/api/blobs', { mime: 'image/png', data: png.toString('base64') })
    expect(put.statusCode).toBe(200)
    const { hash } = put.json()
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect((await max('PUT', '/api/blobs', { mime: 'image/png', data: png.toString('base64') })).json().hash).toBe(hash)
    const get = await max('GET', `/api/blobs/${hash}`)
    expect(get.headers['content-type']).toBe('image/png')
    expect(get.rawPayload.equals(png)).toBe(true)
    expect((await max('PUT', '/api/blobs', { mime: 'text/html', data: 'PGI+' })).statusCode).toBe(422)

    // A project whose record names it shows it in the list.
    await newProject(max, { tracks: [], imageHash: hash })
    expect((await max('GET', '/api/projects')).json().projects[0].imageHash).toBe(hash)
  })

  it('a variant can be asked for its head without the record', async () => {
    const { max } = await start()
    const { variantId, revisionId } = await newProject(max)
    const res = (await max('GET', `/api/variants/${variantId}`)).json()
    expect(res.variant.head.id).toBe(revisionId)
    expect(res.payload).toBeUndefined()
  })
})

describe('project members (decision 127)', () => {
  async function three() {
    const { max, ada } = await start()
    await ctx.app.auth.createUser({ login: 'eva', name: 'Eva Extern', password: PW, role: 'user', mustChangePassword: false })
    const eva = await signIn(ctx.app, 'eva')
    const userId = (login) => ctx.app.auth.userByLogin(login).id
    return { max, ada, eva, userId }
  }

  it('someone else\'s project is not there for an outsider — list, records, check-in alike', async () => {
    const { max, eva } = await three()
    const { project, variantId, revisionId } = await newProject(max, { tracks: [straight('t1')] })
    const h = await head(max, variantId)
    expect((await eva('GET', '/api/projects')).json().projects).toEqual([])
    for (const url of [
      `/api/variants/${variantId}`, `/api/variants/${variantId}/head`, `/api/variants/${variantId}/revisions`,
      `/api/revisions/${revisionId}`, `/api/revisions/${revisionId}/remaps`, `/api/projects/${project.id}/members`,
    ]) {
      expect((await eva('GET', url)).statusCode, url).toBe(404)
    }
    const edit = { base: revisionId, payload: { ...h.payload, title: 'x' }, remaps: [] }
    expect((await eva('POST', `/api/variants/${variantId}/revisions`, edit)).statusCode).toBe(404)
    expect((await eva('POST', `/api/projects/${project.id}/variants`, { name: 'x', fromVariant: variantId })).statusCode).toBe(404)
    expect((await eva('PATCH', `/api/projects/${project.id}`, { title: 'x' })).statusCode).toBe(404)
  })

  it('the creator adds a member, who then sees and edits the project but does not manage it', async () => {
    const { max, eva, ada, userId } = await three()
    const { project, variantId, revisionId } = await newProject(max, { tracks: [straight('t1')] })
    const add = await max('POST', `/api/projects/${project.id}/members`, { userId: userId('eva') })
    expect(add.statusCode).toBe(201)
    expect(add.json().members).toEqual([{ id: userId('eva'), login: 'eva', name: 'Eva Extern', active: true }])

    const listed = (await eva('GET', '/api/projects')).json().projects
    expect(listed.map(p => p.id)).toEqual([project.id])
    expect(listed[0].members.map(m => m.login)).toEqual(['eva'])
    const h = await head(eva, variantId)
    const edit = { base: revisionId, payload: { ...h.payload, tracks: [straight('t1'), straight('t2', 10)] }, remaps: [] }
    expect((await eva('POST', `/api/variants/${variantId}/revisions`, edit)).statusCode).toBe(201)

    // A member works on the project; who else does is the creator's and the admins' to say.
    expect((await eva('GET', `/api/projects/${project.id}/members`)).json().canManage).toBe(false)
    expect((await eva('POST', `/api/projects/${project.id}/members`, { userId: userId('ada') })).statusCode).toBe(403)
    expect((await eva('DELETE', `/api/projects/${project.id}`)).statusCode).toBe(403)
    expect((await ada('GET', `/api/projects/${project.id}/members`)).json().canManage).toBe(true)

    // Taken off again, the project is gone for them.
    expect((await max('DELETE', `/api/projects/${project.id}/members/${userId('eva')}`)).json().members).toEqual([])
    expect((await eva('GET', '/api/projects')).json().projects).toEqual([])
    expect((await eva('GET', `/api/variants/${variantId}/head`)).statusCode).toBe(404)
  })

  it('the admin sees every project and may add members to any', async () => {
    const { max, ada, userId } = await three()
    const { project } = await newProject(max)
    expect((await ada('GET', '/api/projects')).json().projects.map(p => p.id)).toEqual([project.id])
    expect((await ada('POST', `/api/projects/${project.id}/members`, { userId: userId('eva') })).statusCode).toBe(201)
  })

  it('refuses the creator, unknown and deactivated users as members, and members on a template', async () => {
    const { max, ada, userId } = await three()
    const { project } = await newProject(max)
    const add = (id) => max('POST', `/api/projects/${project.id}/members`, { userId: id })
    expect((await add(userId('max'))).json()).toEqual({ error: 'member_is_creator' })
    expect((await add(9999)).json()).toEqual({ error: 'user_not_found' })
    await ada('PATCH', `/api/admin/users/${userId('eva')}`, { active: false })
    expect((await add(userId('eva'))).json()).toEqual({ error: 'user_not_found' })
    const template = (await ada('POST', '/api/projects', { title: 'Vorlage', template: true })).json()
    expect((await ada('POST', `/api/projects/${template.projectId}/members`, { userId: userId('max') })).json())
      .toEqual({ error: 'template_members' })
    // …and a template is everyone's to see.
    expect((await max('GET', '/api/projects')).json().projects.map(p => p.id)).toContain(template.projectId)
  })

  it('finds active users by name or login, and nothing else about them', async () => {
    const { max, ada, userId } = await three()
    expect((await max('GET', '/api/users?q=e')).json()).toEqual({ error: 'query_too_short' })
    expect((await max('GET', '/api/users?q=EXT')).json().users).toEqual([{ id: userId('eva'), login: 'eva', name: 'Eva Extern' }])
    expect((await max('GET', '/api/users?q=ev')).json().users.map(u => u.login)).toEqual(['eva'])
    // LIKE wildcards are taken literally.
    expect((await max('GET', '/api/users?q=%25%25')).json().users).toEqual([])
    await ada('PATCH', `/api/admin/users/${userId('eva')}`, { active: false })
    expect((await max('GET', '/api/users?q=eva')).json().users).toEqual([])
    expect((await ctx.app.inject({ method: 'GET', url: '/api/users?q=eva' })).statusCode).toBe(401)
  })
})
