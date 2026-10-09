import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { as, setup, signIn } from './helpers.js'
import { makeLas } from '../../../src/core/test/pointCloudFixture.js'
import { createCloudStore } from '../src/clouds/cloudStore.js'
import { createQueue } from '../src/clouds/jobs.js'
import { prepareCloud } from '../src/clouds/prepare.js'

let ctx, root
afterEach(async () => {
  await ctx?.app.close()
  ctx?.db.close()
  if (root) rmSync(root, { recursive: true, force: true })
  ctx = root = null
})

const LAS = makeLas(Array.from({ length: 2000 }, (_, k) => ({
  x: 4470000 + (k % 200) * 0.1, y: 5332000 + Math.floor(k / 200) * 0.8, z: 530 + (k % 7) * 0.3, intensity: k * 31,
})), { offset: [4470000, 5332000, 500] })

const track = { id: 't1', name: 't1', epsg: 25832, elements: [] }

/** A project of max's with one variant, and `n` ready clouds in it. */
async function start(n = 2) {
  root = mkdtempSync(join(tmpdir(), 'olt-shares-'))
  ctx = await setup({ cloudRoot: root })
  const max = await signIn(ctx.app, 'max')
  const ada = await signIn(ctx.app, 'ada')
  const maxId = (await ada('GET', '/api/admin/users')).json().users.find(u => u.login === 'max').id
  await ada('PATCH', `/api/admin/users/${maxId}`, { canEditClouds: true })
  const { project, variantId } = (await max('POST', '/api/projects', { title: 'Strecke', payload: { tracks: [track] } })).json()
  const ids = []
  for (let i = 0; i < n; i++) {
    const { cloud } = (await max('POST', `/api/projects/${project.id}/clouds`, {
      name: `W${i}`, fileName: 'w.las', fileSize: LAS.length, format: 'las', crs: 5678, heightEpsg: 7837, pointCount: 2000,
    })).json()
    await ctx.app.inject({
      method: 'PUT', url: `/api/projects/${project.id}/clouds/${cloud.id}/raw?offset=0`, cookies: { olt_session: max.token },
      headers: { 'content-type': 'application/octet-stream', 'x-olt-upload': '1', 'x-olt-sha256': createHash('sha256').update(LAS).digest('hex') },
      payload: Buffer.from(LAS),
    })
    await max('POST', `/api/projects/${project.id}/clouds/${cloud.id}/complete`)
    ids.push(cloud.id)
  }
  const store = createCloudStore(ctx.db)
  const queue = createQueue({
    clouds: store, poll: 1e9, log: () => {},
    run: (job) => prepareCloud({ cloudId: job.cloud_id, clouds: store, storage: ctx.app.cloudStorage }),
  })
  queue.tick()
  await queue.drain()
  return { max, ada, project, variantId, ids, anon: as(ctx.app, null) }
}

describe('read-only share links to the 3D view', () => {
  it('are made by the project\'s creator, open clouds and tracks without a session, and nothing else', async () => {
    const { max, project, variantId, ids, anon } = await start()
    const made = await max('POST', `/api/projects/${project.id}/shares`, { variantId, cloudIds: [ids[0]], expiresInDays: 7, label: 'Bauherr' })
    expect(made.statusCode, made.body).toBe(201)
    const { share } = made.json()
    expect(share).toMatchObject({ variantId, cloudIds: [ids[0]], label: 'Bauherr', expiresAt: '2026-10-08T08:00:00.000Z' })
    expect(share.token.length).toBeGreaterThan(20)

    const base = `/api/share/${share.token}`
    const open = (await anon('GET', base)).json()
    expect(open.share).toMatchObject({ projectTitle: 'Strecke', variantName: 'Bestand', label: 'Bauherr' })
    expect(open.clouds.map(c => c.id)).toEqual([ids[0]])            // only the cloud named
    expect((await anon('GET', `${base}/head`)).json().payload.tracks[0].id).toBe('t1')
    const index = (await anon('GET', `${base}/clouds/${ids[0]}/L1/index`)).json()
    expect(index.level).toBe(1)
    const seg = index.tiles[0][2][0]
    const ranges = await anon('POST', `${base}/clouds/${ids[0]}/L1/ranges`, { ranges: [[seg[0], seg[1]]] })
    expect(ranges.statusCode).toBe(200)
    expect(ranges.rawPayload.length).toBe(seg[1])
    expect((await anon('GET', `${base}/clouds/${ids[1]}/L1/index`)).statusCode).toBe(404)   // not shared
    // The link opens no door to the project's own routes.
    expect((await anon('GET', `/api/projects/${project.id}/clouds`)).statusCode).toBe(401)
  })

  it('without clouds named shows all ready ones; without expiry it holds', async () => {
    const { max, project, ids, anon } = await start()
    const { share } = (await max('POST', `/api/projects/${project.id}/shares`, {})).json()
    expect(share.expiresAt).toBe(null)
    const open = (await anon('GET', `/api/share/${share.token}`)).json()
    expect(open.clouds.map(c => c.id).sort()).toEqual([...ids].sort())
    expect((await anon('GET', `/api/share/${share.token}/head`)).statusCode).toBe(404)   // no variant, no tracks
    ctx.clock.t += 400 * 24 * 3600 * 1000
    expect((await anon('GET', `/api/share/${share.token}`)).statusCode).toBe(200)
  })

  it('stops at its expiry and once revoked', async () => {
    const { max, project, anon } = await start(1)
    const { share } = (await max('POST', `/api/projects/${project.id}/shares`, { expiresInDays: 1 })).json()
    expect((await anon('GET', `/api/share/${share.token}`)).statusCode).toBe(200)
    ctx.clock.t += 24 * 3600 * 1000
    expect((await anon('GET', `/api/share/${share.token}`)).json()).toEqual({ error: 'share_not_found' })

    const { share: other } = (await max('POST', `/api/projects/${project.id}/shares`, { expiresInDays: 30 })).json()
    expect((await max('GET', `/api/projects/${project.id}/shares`)).json().shares.map(s => s.id)).toEqual([other.id, share.id])
    expect((await max('DELETE', `/api/projects/${project.id}/shares/${other.id}`)).statusCode).toBe(204)
    expect((await anon('GET', `/api/share/${other.token}`)).statusCode).toBe(404)
    expect((await anon('GET', '/api/share/nonsense')).statusCode).toBe(404)
  })

  it('may be made by the creator and the admins only, within the bounds', async () => {
    const { max, ada, project, variantId } = await start(0)
    expect((await ada('POST', `/api/projects/${project.id}/shares`, { variantId })).statusCode).toBe(201)
    expect((await max('POST', `/api/projects/${project.id}/shares`, { expiresInDays: 0 })).json()).toMatchObject({ error: 'share_expiry' })
    expect((await max('POST', `/api/projects/${project.id}/shares`, { expiresInDays: 366 })).json()).toMatchObject({ error: 'share_expiry' })
    expect((await max('POST', `/api/projects/${project.id}/shares`, { cloudIds: ['nope'] })).json()).toMatchObject({ error: 'share_clouds' })
    expect((await max('POST', `/api/projects/${project.id}/shares`, { variantId: 'nope' })).json()).toMatchObject({ error: 'share_variant' })
    // A member who did not make the project sees it, but does not hand it out.
    const { project: adas } = (await ada('POST', '/api/projects', { title: 'Ada' })).json()
    const maxId = (await ada('GET', '/api/admin/users')).json().users.find(u => u.login === 'max').id
    await ada('POST', `/api/projects/${adas.id}/members`, { userId: maxId })
    expect((await max('POST', `/api/projects/${adas.id}/shares`, {})).json()).toMatchObject({ error: 'share_not_allowed' })
    expect((await max('GET', `/api/projects/${adas.id}/shares`)).statusCode).toBe(403)
  })
})
