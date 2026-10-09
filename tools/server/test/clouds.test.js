import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setup, signIn } from './helpers.js'
import { makeLas } from '../../../src/core/test/pointCloudFixture.js'
import { createCloudStore } from '../src/clouds/cloudStore.js'
import { createQueue } from '../src/clouds/jobs.js'
import { prepareCloud } from '../src/clouds/prepare.js'
import { decodeCloudSegment } from '../../../src/core/utils/pointCloud/tiles.js'

let ctx, root
afterEach(async () => {
  await ctx?.app.close()
  ctx?.db.close()
  if (root) rmSync(root, { recursive: true, force: true })
  ctx = root = null
})

// A small delivery with colour: 3000 points over 40 × 6 m.
const LAS = makeLas(Array.from({ length: 3000 }, (_, k) => ({
  x: 4470000 + (k % 400) * 0.1, y: 5332000 + Math.floor(k / 400) * 0.8, z: 530 + (k % 7) * 0.3,
  intensity: (k * 37) % 65536, red: (k % 256) << 8, green: 128 << 8, blue: 0,
})), { offset: [4470000, 5332000, 500], format: 3 })

async function start() {
  root = mkdtempSync(join(tmpdir(), 'olt-clouds-'))
  ctx = await setup({ cloudRoot: root })
  const max = await signIn(ctx.app, 'max')
  const ada = await signIn(ctx.app, 'ada')
  const { project } = (await ada('POST', '/api/projects', { title: 'P' })).json()
  const maxId = (await ada('GET', '/api/admin/users')).json().users.find(u => u.login === 'max').id
  return { max, ada, project, maxId }
}

const meta = (extra = {}) => ({
  name: 'Wolke', fileName: 'wolke.las', fileSize: LAS.length, format: 'las', crs: 5678, heightEpsg: 7837,
  pointCount: 3000, rgb: true, ...extra,
})

/** One piece of the upload, as the browser sends it. */
const piece = (user, url, offset, bytes, sum = createHash('sha256').update(bytes).digest('hex')) => ctx.app.inject({
  method: 'PUT', url: `${url}/raw?offset=${offset}`, cookies: { olt_session: user.token },
  headers: { 'content-type': 'application/octet-stream', 'x-olt-upload': '1', 'x-olt-sha256': sum },
  payload: Buffer.from(bytes),
})

async function upload(user, project, bytes = LAS, step = 20000) {
  const res = await user('POST', `/api/projects/${project.id}/clouds`, meta({ fileSize: bytes.length }))
  expect(res.statusCode).toBe(201)
  const { cloud } = res.json()
  const url = `/api/projects/${project.id}/clouds/${cloud.id}`
  for (let at = 0; at < bytes.length; at += step) {
    const r = await piece(user, url, at, bytes.subarray(at, at + step))
    expect(r.statusCode, r.body).toBe(200)
  }
  return { cloud, url }
}

const clouds = () => createCloudStore(ctx.db)

describe('uploading a point cloud (AP 13.2)', () => {
  it('goes in pieces, each checked, resumable where it stopped, then queued', async () => {
    const { ada, project } = await start()
    const { cloud } = (await ada('POST', `/api/projects/${project.id}/clouds`, meta())).json()
    expect(cloud).toMatchObject({ status: 'uploading', received: 0, crs: 5678, rgb: true })
    const url = `/api/projects/${project.id}/clouds/${cloud.id}`
    const a = LAS.subarray(0, 50000), b = LAS.subarray(50000)
    expect((await piece(ada, url, 0, a, 'f'.repeat(64))).json()).toMatchObject({ error: 'chunk_corrupt' })
    expect((await piece(ada, url, 50000, b)).json()).toMatchObject({ error: 'chunk_offset', received: 0 })
    expect((await piece(ada, url, 0, a)).json()).toEqual({ received: 50000 })
    expect((await piece(ada, url, 0, a)).json()).toEqual({ received: 50000 })     // sent twice: taken as done
    expect((await ada('POST', `${url}/complete`)).json()).toMatchObject({ error: 'cloud_incomplete', received: 50000 })
    // The list tells a reloaded page where to go on.
    expect((await ada('GET', `/api/projects/${project.id}/clouds`)).json().clouds[0]).toMatchObject({ received: 50000 })
    expect((await piece(ada, url, 50000, b)).json()).toEqual({ received: LAS.length })
    const done = (await ada('POST', `${url}/complete`)).json().cloud
    expect(done.status).toBe('queued')
    expect(clouds().get(cloud.id).sha256).toBe(createHash('sha256').update(LAS).digest('hex'))
    expect(readFileSync(join(root, project.id, cloud.id, 'raw.part')).equals(Buffer.from(LAS))).toBe(true)
  })

  it('a piece needs the upload header, or it is refused like any request that is not JSON', async () => {
    const { ada, project } = await start()
    const { cloud } = (await ada('POST', `/api/projects/${project.id}/clouds`, meta())).json()
    const res = await ctx.app.inject({
      method: 'PUT', url: `/api/projects/${project.id}/clouds/${cloud.id}/raw?offset=0`, cookies: { olt_session: ada.token },
      headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from(LAS.subarray(0, 10)),
    })
    expect(res.statusCode).toBe(415)
  })

  it('checks the project\'s quota and the disk before a byte is sent', async () => {
    const { ada, project } = await start()
    const res = await ada('POST', `/api/projects/${project.id}/clouds`, meta({ fileSize: 20 * 1024 ** 3, pointCount: 2e9 }))
    expect(res.statusCode).toBe(507)
    expect(res.json()).toMatchObject({ error: 'cloud_quota' })
  })
})

describe('rights (decision 203)', () => {
  it('members see the clouds, only the admin and holders of the right change them; others are told nothing is there', async () => {
    const { max, ada, project, maxId } = await start()
    const { url } = await upload(ada, project)
    expect((await max('GET', `/api/projects/${project.id}/clouds`)).statusCode).toBe(404)
    await ada('POST', `/api/projects/${project.id}/members`, { userId: maxId })
    const list = (await max('GET', `/api/projects/${project.id}/clouds`)).json()
    expect(list).toMatchObject({ mayEdit: false, clouds: [expect.objectContaining({ name: 'Wolke' })] })
    expect((await max('POST', `/api/projects/${project.id}/clouds`, meta())).json()).toMatchObject({ error: 'clouds_not_allowed' })
    expect((await max('DELETE', url)).statusCode).toBe(403)
    await ada('PATCH', `/api/admin/users/${maxId}`, { canEditClouds: true })
    expect((await max('POST', `/api/projects/${project.id}/clouds`, meta())).statusCode).toBe(201)
    expect((await max('DELETE', url)).statusCode).toBe(204)
  })
})

describe('preparing a cloud (AP 13.3) and serving it (AP 13.5)', () => {
  it('makes five levels in the file\'s plane, drops the raw file, and serves index, ranges and collections', async () => {
    const { ada, project } = await start()
    const { cloud, url } = await upload(ada, project)
    await ada('POST', `${url}/complete`)
    const store = clouds()
    const queue = createQueue({
      clouds: store, poll: 1e9, log: () => {},
      run: (job) => prepareCloud({ cloudId: job.cloud_id, clouds: store, storage: ctx.app.cloudStorage }),
    })
    queue.tick()
    await queue.drain()
    const ready = (await ada('GET', `/api/projects/${project.id}/clouds`)).json().clouds[0]
    expect(ready).toMatchObject({ status: 'ready', rgb: true, crs: 5678, points: expect.any(Number) })
    expect(ready.levels.map(l => l.level)).toEqual([0, 1, 2, 3, 4])
    expect(ready.levels[0].points).toBe(3000)
    expect(existsSync(join(root, project.id, cloud.id, 'raw.part'))).toBe(false)

    const index = (await ada('GET', `${url}/L1/index`)).json()
    expect(index).toMatchObject({ version: 3, level: 1, crs: 5678, sourceCrs: 5678, heightEpsg: 7837, rgb: true, name: 'Wolke' })
    const file = readFileSync(join(root, project.id, cloud.id, 'tiles-L1.bin'))
    const segs = index.tiles.flatMap(t => t[2]).slice(0, 5)

    const ranged = await ctx.app.inject({
      method: 'GET', url: `${url}/L1/tiles`, cookies: { olt_session: ada.token },
      headers: { range: `bytes=${segs[1][0]}-${segs[1][0] + segs[1][1] - 1}` },
    })
    expect(ranged.statusCode).toBe(206)
    expect(ranged.headers['content-range']).toBe(`bytes ${segs[1][0]}-${segs[1][0] + segs[1][1] - 1}/${file.length}`)
    expect(ranged.rawPayload.equals(file.subarray(segs[1][0], segs[1][0] + segs[1][1]))).toBe(true)
    expect(ranged.headers.etag).toBeTruthy()

    const many = await ada('POST', `${url}/L1/ranges`, { ranges: segs.map(s => [s[0], s[1]]) })
    expect(many.statusCode).toBe(200)
    expect(many.rawPayload.equals(Buffer.concat(segs.map(s => file.subarray(s[0], s[0] + s[1]))))).toBe(true)
    // A segment decoded from the answer carries its colour.
    const seg = decodeCloudSegment(index, new Uint8Array(many.rawPayload.subarray(0, segs[0][1])), segs[0][2])
    expect(seg.r).toHaveLength(segs[0][2])

    expect((await ada('POST', `${url}/L1/ranges`, { ranges: Array(65).fill([0, 1]) })).statusCode).toBe(422)
    expect((await ada('GET', `${url}/L7/index`)).statusCode).toBe(404)
  })

  it('a file that cannot be read fails with the reason, and can be started again', async () => {
    const { ada, project } = await start()
    const junk = new Uint8Array(5000).fill(7)
    const { cloud, url } = await upload(ada, project, junk)
    await ada('POST', `${url}/complete`)
    const store = clouds()
    const queue = createQueue({
      clouds: store, poll: 1e9, log: () => {},
      run: (job) => prepareCloud({ cloudId: job.cloud_id, clouds: store, storage: ctx.app.cloudStorage }),
    })
    queue.tick()
    await queue.drain()
    const failed = (await ada('GET', `/api/projects/${project.id}/clouds`)).json().clouds[0]
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringContaining('not a LAS file') })
    expect(existsSync(join(root, project.id, cloud.id, 'raw.part'))).toBe(true)
    expect((await ada('POST', `${url}/retry`)).json().cloud).toMatchObject({ status: 'queued', error: null })
  })

  it('a job cut off by stopping the service is not failed, and runs again at the next start', async () => {
    const { ada, project } = await start()
    const { url, cloud } = await upload(ada, project)
    await ada('POST', `${url}/complete`)
    const store = clouds()
    let release
    const queue = createQueue({
      clouds: store, poll: 1e9, log: () => {},
      run: () => new Promise((_, reject) => { release = () => reject(new Error('killed by SIGTERM')) }),
    })
    queue.tick()
    const stopping = queue.stop()
    release()
    await stopping
    expect(store.get(cloud.id).status).not.toBe('failed')
    store.requeueRunning()
    expect(store.claimJob()).toMatchObject({ cloud_id: cloud.id })
  })

  it('a job that was running when the service stopped is queued again', async () => {
    const { ada, project } = await start()
    const { url, cloud } = await upload(ada, project)
    await ada('POST', `${url}/complete`)
    const store = clouds()
    const job = store.claimJob()
    store.setStatus(cloud.id, 'processing', { progress: 0.4 })
    store.requeueRunning()
    expect(store.job(job.id).status).toBe('queued')
    expect(store.get(cloud.id).status).toBe('queued')
  })
})

describe('the admin\'s view of the disk (AP 13.16)', () => {
  it('says how much is free and what each project takes', async () => {
    const { ada, max, project } = await start()
    await upload(ada, project)
    const res = (await ada('GET', '/api/admin/clouds')).json()
    expect(res.disk.free).toBeGreaterThan(0)
    expect(res.projects[0]).toMatchObject({ project_id: project.id, clouds: 1 })
    expect((await max('GET', '/api/admin/clouds')).statusCode).toBe(403)
  })
})
