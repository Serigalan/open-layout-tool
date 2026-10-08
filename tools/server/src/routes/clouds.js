import { createHash } from 'node:crypto'
import { createReadStream, existsSync, openSync, closeSync, writeSync, statSync, readFileSync } from 'node:fs'
import { ApiError } from '../errors.js'
import { mayEditClouds } from '../auth.js'
import { createStore } from '../store.js'
import { createCloudStore, publicCloud, publicTransform } from '../clouds/cloudStore.js'
import { DISK_RESERVE, DISK_WARN, PROJECT_QUOTA, estimateTileBytes } from '../clouds/storage.js'
import { readRanges } from '../clouds/ranges.js'

/** Bytes of one upload piece (AP 13.2) … */
const CHUNK_BYTES = 8 * 1024 * 1024
/** … and the body this route takes, a little more. */
const CHUNK_LIMIT = CHUNK_BYTES + 64 * 1024
/** Largest delivery accepted [bytes]. */
const FILE_LIMIT = 64 * 1024 ** 3
/** How long a session's membership of a project is believed without asking again [ms]. */
const MEMBER_TTL = 60 * 1000

const FORMATS = new Set(['las', 'laz', 'e57'])
const LEVEL = /^L([0-4])$/

const text = (v, max = 200) => String(v ?? '').trim().slice(0, max)

/**
 * Point clouds on the server (phase 13, AP 13.1, 13.2, 13.3, 13.5). Seeing a
 * cloud — its list, its tiles — is every project member's; uploading,
 * deleting and starting a job again the admins' and the users' with the right
 * (decision 203), and they must see the project too.
 *
 * An upload comes in pieces of 8 MB, each with its SHA-256, at the offset the
 * server has received up to: after a broken connection or a reloaded page it
 * goes on where it stopped. Once complete the cloud is queued for
 * olt-cloudjobs, which makes the levels of detail.
 *
 * The tiles are served from here, not by Caddy (decision 208): Caddy's
 * forward_auth asks only whether someone is signed in, not whether they may
 * see the project.
 */
export default async function cloudRoutes(api) {
  const storage = api.cloudStorage
  const store = createStore(api.db, { now: api.now })
  const clouds = createCloudStore(api.db, { now: api.now })
  const opts = { preHandler: api.requireUser }
  // Membership by session and project, believed for a minute: a cross section
  // asks for tiles a few times a second.
  const seen = new Map()
  const busy = new Set()   // clouds a piece is being written to

  const available = () => {
    if (!storage) throw new ApiError(503, 'clouds_unavailable')
  }

  const projectOr404 = (req) => {
    available()
    const key = `${req.cookies?.olt_session ?? ''}|${req.user.id}|${req.params.id}`
    const until = seen.get(key)
    const t = api.now()
    if (until && until > t) return { id: req.params.id }
    const p = store.project(req.params.id)
    if (!p || !store.canSee(req.user, p)) throw new ApiError(404, 'not_found')
    if (seen.size > 10000) seen.clear()
    seen.set(key, t + MEMBER_TTL)
    return p
  }
  const editor = (req) => {
    if (!mayEditClouds(req.user)) throw new ApiError(403, 'clouds_not_allowed')
  }
  const cloudOr404 = (req) => {
    const p = projectOr404(req)
    const c = clouds.get(req.params.cid)
    if (!c || c.project_id !== p.id) throw new ApiError(404, 'not_found')
    return c
  }
  const levelOr404 = (req, c) => {
    const m = LEVEL.exec(req.params.level)
    if (!m || c.status !== 'ready') throw new ApiError(404, 'not_found')
    return Number(m[1])
  }

  api.get('/projects/:id/clouds', opts, async (req) => {
    const p = projectOr404(req)
    const active = clouds.activeTransforms(p.id)
    return { clouds: clouds.list(p.id).map(c => publicCloud(c, active.get(c.id))), mayEdit: mayEditClouds(req.user) }
  })

  // A new cloud, empty: what the browser read from the file's header, and the
  // datums the user chose. The space it will need is checked here, before a
  // byte is sent.
  api.post('/projects/:id/clouds', opts, async (req, reply) => {
    const p = projectOr404(req)
    editor(req)
    const b = req.body ?? {}
    const name = text(b.name) || text(b.fileName)
    const fileName = text(b.fileName, 255)
    const fileSize = Number(b.fileSize)
    const format = String(b.format ?? '')
    const crs = b.crs == null ? null : Number(b.crs)
    const heightEpsg = Number(b.heightEpsg)
    const sourcePoints = Number(b.pointCount ?? 0)
    if (!name || !fileName) throw new ApiError(422, 'name_required')
    if (!FORMATS.has(format)) throw new ApiError(422, 'cloud_format')
    if (!Number.isInteger(fileSize) || fileSize <= 0 || fileSize > FILE_LIMIT) throw new ApiError(422, 'cloud_size')
    if (crs != null && !Number.isInteger(crs)) throw new ApiError(422, 'cloud_crs')
    if (!Number.isInteger(heightEpsg)) throw new ApiError(422, 'cloud_height')
    if (!Number.isFinite(sourcePoints) || sourcePoints < 0) throw new ApiError(422, 'cloud_points')

    const pending = clouds.pending(p.id)
    const needed = fileSize + estimateTileBytes(sourcePoints, Boolean(b.rgb))
    const used = clouds.used(p.id) + estimateTileBytes(pending.points)
    if (used + needed > PROJECT_QUOTA) {
      throw new ApiError(507, 'cloud_quota', { needed, used, quota: PROJECT_QUOTA })
    }
    const { free } = storage.disk()
    if (free - needed < DISK_RESERVE) throw new ApiError(507, 'cloud_disk', { needed, free })

    const id = clouds.create({
      projectId: p.id, name, fileName, fileSize, format, crs, heightEpsg, keepRaw: Boolean(b.keepRaw),
      sourcePoints, rgb: Boolean(b.rgb), userId: req.user.id,
    })
    storage.ensure(p.id, id)
    closeSync(openSync(storage.raw(p.id, id), 'w'))
    return reply.code(201).send({ cloud: publicCloud(clouds.get(id)), chunkBytes: CHUNK_BYTES })
  })

  // One piece of the upload, at `offset`. A piece already received (sent
  // twice after a lost answer) is taken as done; one past the mark is refused
  // with the mark, so the browser knows where to go on.
  api.register(async (raw) => {
    raw.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: CHUNK_LIMIT },
      (req, body, done) => done(null, body))
    raw.put('/projects/:id/clouds/:cid/raw', { ...opts, bodyLimit: CHUNK_LIMIT }, async (req) => {
      const c = cloudOr404(req)
      editor(req)
      if (c.status !== 'uploading') throw new ApiError(409, 'cloud_not_uploading')
      const offset = Number(req.query?.offset)
      const body = req.body
      if (!Buffer.isBuffer(body) || !body.length) throw new ApiError(422, 'chunk_empty')
      if (!Number.isInteger(offset) || offset < 0) throw new ApiError(422, 'chunk_offset')
      if (offset + body.length > c.file_size) throw new ApiError(422, 'chunk_past_end')
      const sum = createHash('sha256').update(body).digest('hex')
      if (String(req.headers['x-olt-sha256'] ?? '') !== sum) throw new ApiError(422, 'chunk_corrupt')
      if (offset + body.length <= c.received) return { received: c.received }
      if (offset !== c.received) throw new ApiError(409, 'chunk_offset', { received: c.received })
      if (busy.has(c.id)) throw new ApiError(409, 'chunk_busy', { received: c.received })
      busy.add(c.id)
      try {
        const fd = openSync(storage.raw(c.project_id, c.id), 'r+')
        try { writeSync(fd, body, 0, body.length, offset) } finally { closeSync(fd) }
        if (!clouds.received(c.id, c.received, offset + body.length)) throw new ApiError(409, 'chunk_offset')
      } finally {
        busy.delete(c.id)
      }
      return { received: offset + body.length }
    })
  })

  // The last piece is in: the whole file's SHA-256 is kept with the cloud, and
  // the cloud waits for its job.
  api.post('/projects/:id/clouds/:cid/complete', opts, async (req) => {
    const c = cloudOr404(req)
    editor(req)
    if (c.status !== 'uploading') throw new ApiError(409, 'cloud_not_uploading')
    if (c.received !== c.file_size) throw new ApiError(409, 'cloud_incomplete', { received: c.received })
    const sha256 = await new Promise((resolve, reject) => {
      const h = createHash('sha256')
      createReadStream(storage.raw(c.project_id, c.id)).on('data', d => h.update(d))
        .on('end', () => resolve(h.digest('hex'))).on('error', reject)
    })
    clouds.enqueue(c.id, req.user.id, sha256)
    return { cloud: publicCloud(clouds.get(c.id)) }
  })

  // A failed preparation, tried again — as long as the file is still there.
  api.post('/projects/:id/clouds/:cid/retry', opts, async (req) => {
    const c = cloudOr404(req)
    editor(req)
    if (c.status !== 'failed') throw new ApiError(409, 'cloud_not_failed')
    if (!existsSync(storage.raw(c.project_id, c.id))) throw new ApiError(409, 'cloud_raw_gone')
    clouds.enqueue(c.id, req.user.id)
    return { cloud: publicCloud(clouds.get(c.id)) }
  })

  // Deleting a cloud takes its files with it; a job on it notices and stops.
  api.delete('/projects/:id/clouds/:cid', opts, async (req, reply) => {
    const c = cloudOr404(req)
    editor(req)
    clouds.remove(c.id)
    storage.remove(c.project_id, c.id)
    return reply.code(204).send()
  })

  // ── re-referencing (decision 211, AP 13.13–13.14) ──────────────────────
  // A cloud's transformations stand outside the revisions, with a history of
  // their own: the newest is in force, an earlier one can be put back, or none.

  api.get('/projects/:id/clouds/:cid/transforms', opts, async (req) => {
    const c = cloudOr404(req)
    return { transforms: clouds.transforms(c.id).map(t => publicTransform(t, { full: true })) }
  })

  api.post('/projects/:id/clouds/:cid/transforms', opts, async (req, reply) => {
    const c = cloudOr404(req)
    editor(req)
    if (c.status !== 'ready') throw new ApiError(409, 'cloud_not_ready')
    const b = req.body ?? {}
    const m = b.matrix
    if (!Array.isArray(m) || m.length !== 16 || !m.every(Number.isFinite)) throw new ApiError(422, 'transform_matrix')
    if (!Number.isInteger(b.crs)) throw new ApiError(422, 'transform_crs')
    const ref = b.referenceCloudId == null ? null : clouds.get(String(b.referenceCloudId))
    if (b.referenceCloudId != null && (!ref || ref.project_id !== c.project_id || ref.id === c.id)) {
      throw new ApiError(422, 'transform_reference')
    }
    const pairs = Array.isArray(b.pairs) ? b.pairs.slice(0, 500) : []
    const id = clouds.addTransform({
      cloudId: c.id, matrix: m, params: { ...(b.params ?? {}), crs: b.crs }, pairs,
      residuals: b.residuals ?? {}, referenceCloudId: ref?.id ?? null, userId: req.user.id,
    })
    return reply.code(201).send({ transform: publicTransform(clouds.transform(id), { full: true }) })
  })

  // Put an earlier transformation in force again, or none (`id: null`).
  api.post('/projects/:id/clouds/:cid/transforms/active', opts, async (req) => {
    const c = cloudOr404(req)
    editor(req)
    const id = req.body?.id ?? null
    if (id != null && clouds.transform(Number(id))?.cloud_id !== c.id) throw new ApiError(404, 'not_found')
    clouds.setActiveTransform(c.id, id == null ? null : Number(id))
    return { cloud: publicCloud(clouds.get(c.id), clouds.activeTransform(c.id)) }
  })

  // ── serving the tiles (AP 13.5) ──────────────────────────────────────────

  const immutable = (reply, etag) => {
    reply.header('cache-control', 'private, max-age=31536000, immutable')
    reply.header('etag', etag)
  }

  api.get('/projects/:id/clouds/:cid/:level/index', opts, async (req, reply) => {
    const c = cloudOr404(req)
    const level = levelOr404(req, c)
    const etag = `"${c.id}-L${level}-${c.ready_at}"`
    if (req.headers['if-none-match'] === etag) return reply.code(304).send()
    immutable(reply, etag)
    return reply.type('application/json').send(readFileSync(storage.index(c.project_id, c.id, level)))
  })

  // The tile file, whole or a range of it (bytes=a-b, one range).
  api.get('/projects/:id/clouds/:cid/:level/tiles', opts, async (req, reply) => {
    const c = cloudOr404(req)
    const level = levelOr404(req, c)
    const path = storage.tiles(c.project_id, c.id, level)
    const size = statSync(path).size
    const etag = `"${c.id}-L${level}-${size}"`
    if (req.headers['if-none-match'] === etag) return reply.code(304).send()
    immutable(reply, etag)
    reply.header('accept-ranges', 'bytes')
    reply.type('application/octet-stream')
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
    if (!range) return reply.send(createReadStream(path))
    let start = range[1] === '' ? size - Number(range[2]) : Number(range[1])
    let end = range[1] === '' || range[2] === '' ? size - 1 : Number(range[2])
    end = Math.min(end, size - 1)
    if (!(start >= 0) || start > end) {
      reply.header('content-range', `bytes */${size}`)
      return reply.code(416).send()
    }
    start = Math.max(0, start)
    reply.code(206)
    reply.header('content-range', `bytes ${start}-${end}/${size}`)
    reply.header('content-length', end - start + 1)
    return reply.send(createReadStream(path, { start, end }))
  })

  // Up to 64 ranges in one answer, back to back in the order asked — a cross
  // section is one request.
  api.post('/projects/:id/clouds/:cid/:level/ranges', opts, async (req, reply) => {
    const c = cloudOr404(req)
    const level = levelOr404(req, c)
    const out = readRanges(storage.tiles(c.project_id, c.id, level), req.body?.ranges)
    reply.header('cache-control', 'private, no-store')
    return reply.type('application/octet-stream').send(out)
  })

  // ── the disk, for the admin view (AP 13.16) ─────────────────────────────

  api.get('/admin/clouds', { preHandler: api.requireAdmin }, async () => {
    available()
    const disk = storage.disk()
    return { disk: { ...disk, warn: disk.free < DISK_WARN, warnBelow: DISK_WARN }, quota: PROJECT_QUOTA, projects: clouds.byProject() }
  })
}
