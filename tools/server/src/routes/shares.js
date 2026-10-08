import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ApiError } from '../errors.js'
import { createStore, publicVariant } from '../store.js'
import { createCloudStore, publicCloud } from '../clouds/cloudStore.js'
import { readRanges } from '../clouds/ranges.js'

/** The longest a link may be made to last [days]; no expiry at all is asked for with null. */
const MAX_DAYS = 365
const DAY = 24 * 3600 * 1000
const LEVEL = /^L([0-4])$/
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/

const iso = (t) => new Date(t).toISOString()

/** A link as its makers see it in the list. */
const publicShare = (row) => ({
  id: row.id,
  token: row.token,
  variantId: row.variant_id ?? null,
  cloudIds: row.cloud_ids ? JSON.parse(row.cloud_ids) : null,
  label: row.label,
  createdBy: row.created_by,
  createdByName: row.created_by_name ?? null,
  createdAt: row.created_at,
  expiresAt: row.expires_at ?? null,
})

/**
 * Read-only links to a project's point clouds (the 3D view without signing
 * in). Making, listing and revoking them is the project's creator's and the
 * admins'. Under /share/:token the link gives what the 3D view reads and
 * nothing else: the clouds it names (or all ready ones), their indexes and
 * tile ranges, and the checked-in head of its variant — the current one, so
 * the link shows the tracks as they are, not as they were when it was made.
 * A link that has expired or was revoked answers 404, as one that never was.
 */
export default async function shareRoutes(api) {
  const db = api.db
  const store = createStore(db, { now: api.now })
  const clouds = createCloudStore(db, { now: api.now })
  const opts = { preHandler: api.requireUser }
  const q = {
    insert: db.prepare(`INSERT INTO share_link (token, project_id, variant_id, cloud_ids, label, created_by, created_at, expires_at)
                        VALUES (@token, @project_id, @variant_id, @cloud_ids, @label, @created_by, @created_at, @expires_at)`),
    byProject: db.prepare(`SELECT s.*, u.name AS created_by_name FROM share_link s LEFT JOIN user u ON u.id = s.created_by
                           WHERE s.project_id = ? ORDER BY s.id DESC`),
    byId: db.prepare('SELECT s.*, u.name AS created_by_name FROM share_link s LEFT JOIN user u ON u.id = s.created_by WHERE s.id = ?'),
    byToken: db.prepare('SELECT * FROM share_link WHERE token = ?'),
    remove: db.prepare('DELETE FROM share_link WHERE id = ?'),
  }

  // ── making and revoking (signed in) ──────────────────────────────────────

  const managedOr404 = (req) => {
    const p = store.project(req.params.id)
    if (!p || !store.canSee(req.user, p)) throw new ApiError(404, 'not_found')
    if (!store.canManage(req.user, p)) throw new ApiError(403, 'share_not_allowed')
    return p
  }

  api.get('/projects/:id/shares', opts, async (req) => {
    const p = managedOr404(req)
    return { shares: q.byProject.all(p.id).map(publicShare) }
  })

  api.post('/projects/:id/shares', opts, async (req, reply) => {
    const p = managedOr404(req)
    const b = req.body ?? {}
    let variantId = null
    if (b.variantId != null) {
      const v = store.variant(String(b.variantId))
      if (!v || v.project_id !== p.id) throw new ApiError(422, 'share_variant')
      variantId = v.id
    }
    let cloudIds = null
    if (b.cloudIds != null) {
      if (!Array.isArray(b.cloudIds) || !b.cloudIds.length) throw new ApiError(422, 'share_clouds')
      cloudIds = [...new Set(b.cloudIds.map(String))]
      if (!cloudIds.every(id => clouds.get(id)?.project_id === p.id)) throw new ApiError(422, 'share_clouds')
    }
    const days = b.expiresInDays == null ? null : Number(b.expiresInDays)
    if (days != null && !(Number.isInteger(days) && days >= 1 && days <= MAX_DAYS)) throw new ApiError(422, 'share_expiry')
    const t = api.now()
    const { lastInsertRowid } = q.insert.run({
      token: randomBytes(24).toString('base64url'),
      project_id: p.id, variant_id: variantId, cloud_ids: cloudIds ? JSON.stringify(cloudIds) : null,
      label: String(b.label ?? '').trim().slice(0, 200), created_by: req.user.id, created_at: iso(t),
      expires_at: days == null ? null : iso(t + days * DAY),
    })
    return reply.code(201).send({ share: publicShare(q.byId.get(lastInsertRowid)) })
  })

  api.delete('/projects/:id/shares/:sid', opts, async (req, reply) => {
    const p = managedOr404(req)
    const s = q.byId.get(Number(req.params.sid))
    if (!s || s.project_id !== p.id) throw new ApiError(404, 'not_found')
    q.remove.run(s.id)
    return reply.code(204).send()
  })

  // ── reading through a link (no session) ──────────────────────────────────

  /** The link behind a token, while it holds, with its project. */
  const shareOr404 = (req) => {
    const token = String(req.params.token ?? '')
    const s = TOKEN.test(token) ? q.byToken.get(token) : null
    if (!s || (s.expires_at && Date.parse(s.expires_at) <= api.now())) throw new ApiError(404, 'share_not_found')
    const p = store.project(s.project_id)
    if (!p) throw new ApiError(404, 'share_not_found')
    return { s, p }
  }
  const shown = (s, row) => row.status === 'ready' && (!s.cloud_ids || JSON.parse(s.cloud_ids).includes(row.id))
  const cloudOr404 = (req) => {
    if (!api.cloudStorage) throw new ApiError(503, 'clouds_unavailable')
    const { s } = shareOr404(req)
    const c = clouds.get(req.params.cid)
    if (!c || c.project_id !== s.project_id || !shown(s, c)) throw new ApiError(404, 'not_found')
    const m = LEVEL.exec(req.params.level)
    if (!m) throw new ApiError(404, 'not_found')
    return { c, level: Number(m[1]) }
  }
  // Links are seen by whoever holds them: nothing kept on the way.
  const noStore = (reply) => reply.header('cache-control', 'private, no-store')

  api.get('/share/:token', async (req, reply) => {
    const { s, p } = shareOr404(req)
    const active = clouds.activeTransforms(p.id)
    const v = s.variant_id ? store.variant(s.variant_id) : null
    noStore(reply)
    return {
      share: { projectId: p.id, projectTitle: p.title, variantName: v?.name ?? null, label: s.label, expiresAt: s.expires_at ?? null },
      clouds: clouds.list(p.id).filter(c => shown(s, c)).map(c => publicCloud(c, active.get(c.id))),
    }
  })

  api.get('/share/:token/head', async (req, reply) => {
    const { s } = shareOr404(req)
    const v = s.variant_id ? store.variant(s.variant_id) : null
    if (!v || v.project_id !== s.project_id) throw new ApiError(404, 'not_found')
    const r = store.revision(v.head_revision_id)
    noStore(reply)
    return { variant: publicVariant(v, r.meta), revision: r.meta, payload: r.payload }
  })

  api.get('/share/:token/clouds/:cid/:level/index', async (req, reply) => {
    const { c, level } = cloudOr404(req)
    noStore(reply)
    return reply.type('application/json').send(readFileSync(api.cloudStorage.index(c.project_id, c.id, level)))
  })

  api.post('/share/:token/clouds/:cid/:level/ranges', async (req, reply) => {
    const { c, level } = cloudOr404(req)
    const out = readRanges(api.cloudStorage.tiles(c.project_id, c.id, level), req.body?.ranges)
    noStore(reply)
    return reply.type('application/octet-stream').send(out)
  })
}
