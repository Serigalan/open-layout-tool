import { createHash } from 'node:crypto'
import { ApiError } from '../errors.js'
import { checkRecord, freshErrors } from '../checks.js'
import { createStore, publicVariant } from '../store.js'

/** Largest image [bytes]. */
const IMAGE_LIMIT = 5 * 1024 * 1024

const text = (v, max = 500) => (v == null ? undefined : String(v).trim().slice(0, max))

/**
 * Projects, variants, revisions and images (AP 10.5). A project is seen and
 * edited by its creator, its members and the admins (decision 127); deleting
 * one is the admin's or its creator's. A template is the admin's alone — the project and its root
 * variants; everyone branches variants of their own off it and edits those.
 */
export default async function projectRoutes(api) {
  const store = createStore(api.db, { now: api.now })
  api.decorate('store', store)
  const opts = { preHandler: api.requireUser }

  // Whoever may not see a project is told it is not there — not that it is
  // someone else's (decision 127).
  const projectOr404 = (id, user) => {
    const p = store.project(id)
    if (!p || !store.canSee(user, p)) throw new ApiError(404, 'not_found')
    return p
  }
  const variantOr404 = (id, user) => {
    const v = store.variant(id)
    if (!v) throw new ApiError(404, 'not_found')
    projectOr404(v.project_id, user)
    return v
  }
  // The template itself: a template project, or one of its root variants.
  const adminForTemplate = (user, project, variant = null) => {
    if (project.template && (!variant || !variant.parent_variant_id) && user.role !== 'admin') {
      throw new ApiError(403, 'template_admin')
    }
  }
  const revisionOr404 = (id, user) => {
    const r = store.revisionMeta(Number(id))
    if (!r) throw new ApiError(404, 'not_found')
    projectOr404(r.projectId, user)
    return r
  }
  const listed = (user, id) => store.projectSummary(user, id)

  api.get('/projects', opts, async (req) => ({ projects: store.listProjects(req.user) }))

  // A new project, empty or with a record (an import): its first variant
  // "Bestand" at revision 1. An imported record may bring errors along — it
  // is what there is — and they are reported, not refused; what a later
  // check-in adds to them is.
  api.post('/projects', opts, async (req, reply) => {
    const title = text(req.body?.title, 200)
    if (!title) throw new ApiError(422, 'title_required')
    const description = text(req.body?.description, 4000) ?? ''
    const template = Boolean(req.body?.template)
    if (template && req.user.role !== 'admin') throw new ApiError(403, 'template_admin')
    const given = req.body?.payload
    const { record, errors, warnings } = checkRecord(given ?? { tracks: [], switches: [], platforms: [] })
    const ids = store.createProject({
      title, description, payload: record, authorId: req.user.id, errorKeys: errors.map(e => e.key),
      variantName: text(req.body?.variantName, 100) || (template ? 'Vorlage' : 'Bestand'), template,
    })
    const project = listed(req.user, ids.projectId)
    return reply.code(201).send({ project, ...ids, errors, warnings })
  })

  api.patch('/projects/:id', opts, async (req) => {
    adminForTemplate(req.user, projectOr404(req.params.id, req.user))
    const title = text(req.body?.title, 200)
    if (title === '') throw new ApiError(422, 'title_required')
    store.patchProject(req.params.id, { title, description: text(req.body?.description, 4000) })
    return { project: listed(req.user, req.params.id) }
  })

  api.delete('/projects/:id', opts, async (req, reply) => {
    const p = projectOr404(req.params.id, req.user)
    adminForTemplate(req.user, p)
    if (req.user.role !== 'admin' && p.created_by !== req.user.id) throw new ApiError(403, 'not_allowed')
    store.deleteProject(p.id)
    return reply.code(204).send()
  })

  // Who works on a project besides its creator (decision 127). Everyone who
  // sees the project sees the list; its creator and the admins change it.
  // A template has none: it is open to everyone anyway.
  const managedOr403 = (req) => {
    const p = projectOr404(req.params.id, req.user)
    if (p.template) throw new ApiError(422, 'template_members')
    if (!store.canManage(req.user, p)) throw new ApiError(403, 'not_allowed')
    return p
  }

  api.get('/projects/:id/members', opts, async (req) => {
    const p = projectOr404(req.params.id, req.user)
    return { members: store.members(p.id), canManage: store.canManage(req.user, p) && !p.template }
  })

  api.post('/projects/:id/members', opts, async (req, reply) => {
    const p = managedOr403(req)
    const user = api.auth.userById(Number(req.body?.userId))
    if (!user || !user.active) throw new ApiError(422, 'user_not_found')
    if (user.id === p.created_by) throw new ApiError(422, 'member_is_creator')
    store.addMember(p.id, user.id, req.user.id)
    return reply.code(201).send({ members: store.members(p.id) })
  })

  api.delete('/projects/:id/members/:userId', opts, async (req) => {
    const p = managedOr403(req)
    store.removeMember(p.id, Number(req.params.userId))
    return { members: store.members(p.id) }
  })

  // An image, stored once by the hash of its bytes; the record names the hash.
  // Not bound to a project: a new project brings its picture along at once.
  api.put('/blobs', opts, async (req) => {
    const { mime, data } = req.body ?? {}
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(String(mime))) throw new ApiError(422, 'image_type')
    const bytes = Buffer.from(String(data ?? ''), 'base64')
    if (!bytes.length) throw new ApiError(422, 'image_empty')
    if (bytes.length > IMAGE_LIMIT) throw new ApiError(413, 'too_large')
    const hash = createHash('sha256').update(bytes).digest('hex')
    store.putBlob({ hash, mime, data: bytes, authorId: req.user.id })
    return { hash }
  })

  api.get('/blobs/:hash', opts, async (req, reply) => {
    const b = /^[0-9a-f]{64}$/.test(req.params.hash) ? store.blob(req.params.hash) : null
    if (!b) throw new ApiError(404, 'not_found')
    // An SVG is served as a download-only image: no script runs from it.
    reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    reply.header('x-content-type-options', 'nosniff')
    reply.header('cache-control', 'private, max-age=31536000, immutable')
    return reply.type(b.mime).send(b.data)
  })

  api.post('/projects/:id/variants', opts, async (req, reply) => {
    const p = projectOr404(req.params.id, req.user)
    const name = text(req.body?.name, 100)
    if (!name) throw new ApiError(422, 'name_required')
    const from = variantOr404(req.body?.fromVariant, req.user)
    if (from.project_id !== p.id) throw new ApiError(422, 'variant_mismatch')
    let at = from.head_revision_id
    if (req.body?.fromRevision != null) {
      const r = revisionOr404(req.body.fromRevision, req.user)
      if (r.projectId !== p.id) throw new ApiError(422, 'revision_mismatch')
      at = r.id
    }
    const id = store.branch({ projectId: p.id, name, fromVariantId: from.id, fromRevisionId: at, authorId: req.user.id })
    return reply.code(201).send({ variant: publicVariant(store.variant(id), store.revisionMeta(at)) })
  })

  api.patch('/variants/:id', opts, async (req) => {
    const v = variantOr404(req.params.id, req.user)
    adminForTemplate(req.user, store.project(v.project_id), v)
    const name = text(req.body?.name, 100)
    if (name === '') throw new ApiError(422, 'name_required')
    if (name) store.renameVariant(v.id, name)
    if (req.body?.archived !== undefined) store.archiveVariant(v.id, Boolean(req.body.archived))
    const now = store.variant(v.id)
    return { variant: publicVariant(now, store.revisionMeta(now.head_revision_id)) }
  })

  // A variant without its record — what the open app polls to tell whether
  // the server has moved on.
  api.get('/variants/:id', opts, async (req) => {
    const v = variantOr404(req.params.id, req.user)
    return { variant: publicVariant(v, store.revisionMeta(v.head_revision_id)) }
  })

  api.get('/variants/:id/head', opts, async (req) => {
    const v = variantOr404(req.params.id, req.user)
    const r = store.revision(v.head_revision_id)
    return { variant: publicVariant(v, r.meta), revision: r.meta, payload: r.payload }
  })

  api.get('/variants/:id/revisions', opts, async (req) => {
    const v = variantOr404(req.params.id, req.user)
    return { revisions: store.history(v, Math.min(Number(req.query?.limit ?? 500), 2000)) }
  })

  api.get('/revisions/:id', opts, async (req) => {
    const meta = revisionOr404(req.params.id, req.user)
    const r = store.revision(meta.id)
    return { revision: r.meta, payload: r.payload, remaps: r.remaps }
  })

  api.get('/revisions/:a/base/:b', opts, async (req) => {
    const a = revisionOr404(req.params.a, req.user), b = revisionOr404(req.params.b, req.user)
    if (a.projectId !== b.projectId) throw new ApiError(422, 'project_mismatch')
    const base = store.commonBase(a.projectId, a.id, b.id)
    return { base: base == null ? null : store.revisionMeta(base) }
  })

  // The id logs `id` has that `base` does not — the other side's splits and
  // joins, for carrying references over in a merge.
  api.get('/revisions/:id/remaps', opts, async (req) => {
    const head = revisionOr404(req.params.id, req.user)
    const base = req.query?.base != null ? revisionOr404(req.query.base, req.user) : null
    if (base && base.projectId !== head.projectId) throw new ApiError(422, 'project_mismatch')
    return { remaps: store.remapsBetween(head.projectId, base?.id ?? null, head.id) }
  })

  // Check in: only on the current head (decision 97). The server never
  // merges; on a stale base it answers 409 with the head, and the browser
  // merges and comes back. A record that adds errors to the ones its base
  // already had is refused with them (422).
  api.post('/variants/:id/revisions', opts, async (req, reply) => {
    const v = variantOr404(req.params.id, req.user)
    adminForTemplate(req.user, store.project(v.project_id), v)
    const { base, mergeParent, message, payload, remaps } = req.body ?? {}
    if (!Number.isInteger(base)) throw new ApiError(422, 'base_required')
    if (base !== v.head_revision_id) return reply.code(409).send({ error: 'stale_base', head: store.revisionMeta(v.head_revision_id) })
    if (mergeParent != null) {
      const mp = revisionOr404(mergeParent, req.user)
      if (mp.projectId !== v.project_id) throw new ApiError(422, 'project_mismatch')
    }
    if (!Array.isArray(remaps ?? [])) throw new ApiError(422, 'invalid_remaps')
    const { record, errors, warnings } = checkRecord(payload)
    if (record.id !== v.project_id) throw new ApiError(422, 'project_mismatch')
    const known = store.revision(base).errorKeys
    const fresh = freshErrors(errors, known)
    if (fresh.length) return reply.code(422).send({ error: 'invalid_record', errors: fresh })
    const result = store.checkIn({
      variant: v, base, mergeParent: mergeParent ?? null, authorId: req.user.id,
      message: text(message, 2000) ?? '', payload: record, errorKeys: errors.map(e => e.key),
      remaps: (remaps ?? []).filter(e => e && typeof e.from === 'string' && Array.isArray(e.to))
        .map(e => ({ from: e.from, to: e.to.map(String) })),
    })
    if (result.conflict) return reply.code(409).send({ error: 'stale_base', head: store.revisionMeta(result.conflict) })
    return reply.code(201).send({ revision: store.revisionMeta(result.revisionId), warnings })
  })
}
