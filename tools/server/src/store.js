import { randomUUID } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'

/** The schema version every stored record has (persistenceUtils.SCHEMA_VERSION). */
export const SCHEMA_VERSION = 2

const pack = (payload) => gzipSync(Buffer.from(JSON.stringify(payload)))
const unpack = (buf) => JSON.parse(gunzipSync(buf).toString('utf8'))

/**
 * Projects, variants and revisions on one database (AP 10.5).
 *
 * A variant is a name and a head: branching one off another writes a variant
 * whose head is the revision the other is at, and copies nothing. A revision
 * holds the whole dehydrated record (decision 98). The graph of revisions —
 * each with its parent and, for a merge, a second parent — is small enough to
 * be walked in memory for the common base and the logs between two of them.
 */
export function createStore(db, { now = () => Date.now() } = {}) {
  const iso = () => new Date(now()).toISOString()
  const q = {
    projects:      db.prepare(`SELECT p.*, u.name AS creator_name FROM project p JOIN user u ON u.id = p.created_by
                               WHERE p.deleted_at IS NULL ORDER BY p.title COLLATE NOCASE`),
    project:       db.prepare('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL'),
    insertProject: db.prepare('INSERT INTO project (id, title, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)'),
    patchProject:  db.prepare('UPDATE project SET title = COALESCE(?, title), description = COALESCE(?, description) WHERE id = ?'),
    deleteProject: db.prepare('UPDATE project SET deleted_at = ? WHERE id = ?'),
    variants:      db.prepare('SELECT * FROM variant WHERE project_id = ? ORDER BY created_at, rowid'),
    variant:       db.prepare('SELECT * FROM variant WHERE id = ?'),
    insertVariant: db.prepare(`INSERT INTO variant (id, project_id, name, parent_variant_id, head_revision_id, created_by, created_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?)`),
    setHead:       db.prepare('UPDATE variant SET head_revision_id = ? WHERE id = ? AND head_revision_id = ?'),
    renameVariant: db.prepare('UPDATE variant SET name = ? WHERE id = ?'),
    archiveVariant: db.prepare('UPDATE variant SET archived = ? WHERE id = ?'),
    revisionMeta:  db.prepare(`SELECT r.id, r.project_id, r.number, r.variant_id, r.parent_id, r.merge_parent_id, r.author_id,
                                      r.created_at, r.message, u.name AS author_name
                               FROM revision r JOIN user u ON u.id = r.author_id WHERE r.id = ?`),
    revisionFull:  db.prepare('SELECT * FROM revision WHERE id = ?'),
    graph:         db.prepare('SELECT id, parent_id, merge_parent_id, remaps FROM revision WHERE project_id = ?'),
    nextNumber:    db.prepare('SELECT COALESCE(MAX(number), 0) + 1 FROM revision WHERE project_id = ?').pluck(),
    insertRevision: db.prepare(`INSERT INTO revision (project_id, number, variant_id, parent_id, merge_parent_id, author_id, created_at,
                                                      message, schema_version, payload, remaps, error_keys)
                                VALUES (@project_id, @number, @variant_id, @parent_id, @merge_parent_id, @author_id, @created_at,
                                        @message, @schema_version, @payload, @remaps, @error_keys)`),
    blob:          db.prepare('SELECT * FROM blob WHERE hash = ?'),
    insertBlob:    db.prepare('INSERT OR IGNORE INTO blob (hash, mime, size, data, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  }

  const revisionMeta = (id) => {
    const r = q.revisionMeta.get(id)
    if (!r) return null
    return {
      id: r.id, projectId: r.project_id, number: r.number, variantId: r.variant_id,
      parentId: r.parent_id, mergeParentId: r.merge_parent_id,
      author: { id: r.author_id, name: r.author_name }, createdAt: r.created_at, message: r.message,
    }
  }

  /** Every ancestor of a revision, itself included, through both parents. */
  const ancestors = (graph, id) => {
    const seen = new Set()
    const stack = [id]
    while (stack.length) {
      const cur = stack.pop()
      if (cur == null || seen.has(cur)) continue
      seen.add(cur)
      const node = graph.get(cur)
      if (node) stack.push(node.parent_id, node.merge_parent_id)
    }
    return seen
  }
  const graphOf = (projectId) => new Map(q.graph.all(projectId).map(r => [r.id, r]))

  function insertRevision({ projectId, variantId, parentId, mergeParentId = null, authorId, message, payload, remaps = [], errorKeys = [] }) {
    const { lastInsertRowid } = q.insertRevision.run({
      project_id: projectId, number: q.nextNumber.get(projectId), variant_id: variantId,
      parent_id: parentId, merge_parent_id: mergeParentId, author_id: authorId, created_at: iso(),
      message: String(message ?? ''), schema_version: SCHEMA_VERSION, payload: pack(payload),
      remaps: JSON.stringify(remaps ?? []), error_keys: JSON.stringify(errorKeys),
    })
    return Number(lastInsertRowid)
  }

  return {
    revisionMeta,

    project: (id) => q.project.get(id),
    variant: (id) => q.variant.get(id),

    /** A revision with its record, or null. */
    revision(id) {
      const r = q.revisionFull.get(id)
      if (!r) return null
      return { meta: revisionMeta(id), payload: unpack(r.payload), remaps: JSON.parse(r.remaps), errorKeys: JSON.parse(r.error_keys) }
    },

    /** The projects with their variants, each variant with its head and how far its parent is ahead. */
    listProjects() {
      return q.projects.all().map(p => {
        const graph = graphOf(p.id)
        const rows = q.variants.all(p.id)
        const byId = new Map(rows.map(v => [v.id, v]))
        const variants = rows.map(v => {
          const parent = v.parent_variant_id ? byId.get(v.parent_variant_id) : null
          let parentAhead = 0
          if (parent) {
            const mine = ancestors(graph, v.head_revision_id)
            for (const id of ancestors(graph, parent.head_revision_id)) if (!mine.has(id)) parentAhead++
          }
          return publicVariant(v, revisionMeta(v.head_revision_id), parentAhead)
        })
        return {
          id: p.id, title: p.title, description: p.description ?? '',
          createdBy: { id: p.created_by, name: p.creator_name }, createdAt: p.created_at, variants,
        }
      })
    },

    /** A new project with its first variant "Bestand" at revision 1, holding `payload`. */
    createProject({ title, description, payload, authorId, errorKeys, variantName = 'Bestand' }) {
      const projectId = randomUUID()
      const variantId = randomUUID()
      const record = { ...payload, id: projectId, title, ...(description ? { description } : {}) }
      return db.transaction(() => {
        q.insertProject.run(projectId, title, description ?? null, authorId, iso())
        const revisionId = insertRevision({
          projectId, variantId, parentId: null, authorId, message: '', payload: record, errorKeys,
        })
        q.insertVariant.run(variantId, projectId, variantName, null, revisionId, authorId, iso())
        return { projectId, variantId, revisionId }
      })()
    },

    patchProject: (id, { title, description }) => q.patchProject.run(title ?? null, description ?? null, id),
    deleteProject: (id) => q.deleteProject.run(iso(), id),

    /** Branch a variant off another, at its head or at one of the project's revisions. */
    branch({ projectId, name, fromVariantId, fromRevisionId, authorId }) {
      const id = randomUUID()
      q.insertVariant.run(id, projectId, name, fromVariantId, fromRevisionId, authorId, iso())
      return id
    },

    renameVariant: (id, name) => q.renameVariant.run(name, id),
    archiveVariant: (id, archived) => q.archiveVariant.run(archived ? 1 : 0, id),

    /**
     * Write a revision as the variant's new head — only if the head is still
     * `base`. Checking and setting happen in one transaction: of two
     * check-ins on the same base exactly one wins, the other gets the head.
     * Returns { revisionId } or { conflict: headId }.
     */
    checkIn({ variant, base, mergeParent, authorId, message, payload, remaps, errorKeys }) {
      return db.transaction(() => {
        const current = q.variant.get(variant.id)
        if (current.head_revision_id !== base) return { conflict: current.head_revision_id }
        const revisionId = insertRevision({
          projectId: variant.project_id, variantId: variant.id, parentId: base, mergeParentId: mergeParent ?? null,
          authorId, message, payload, remaps, errorKeys,
        })
        const { changes } = q.setHead.run(revisionId, variant.id, base)
        if (changes !== 1) throw new Error('head moved during check-in')
        return { revisionId }
      }).immediate()
    },

    /** The history of a variant: its head and the first parents back from it. */
    history(variant, limit = 500) {
      const out = []
      let id = variant.head_revision_id
      while (id != null && out.length < limit) {
        const m = revisionMeta(id)
        if (!m) break
        out.push(m)
        id = m.parentId
      }
      return out
    },

    /**
     * The youngest revision both have in their history — the highest id among
     * the common ancestors, which no other common ancestor descends from.
     */
    commonBase(projectId, a, b) {
      const graph = graphOf(projectId)
      const ofA = ancestors(graph, a)
      let best = null
      for (const id of ancestors(graph, b)) if (ofA.has(id) && (best == null || id > best)) best = id
      return best
    },

    /**
     * The id logs of every revision `head` has and `base` has not, oldest
     * first — what the other side of a merge needs to carry references over.
     */
    remapsBetween(projectId, base, head) {
      const graph = graphOf(projectId)
      const known = base == null ? new Set() : ancestors(graph, base)
      return [...ancestors(graph, head)].filter(id => !known.has(id)).sort((x, y) => x - y)
        .flatMap(id => JSON.parse(graph.get(id).remaps))
    },

    isAncestor(projectId, ancestorId, id) {
      return ancestors(graphOf(projectId), id).has(ancestorId)
    },

    blob: (hash) => q.blob.get(hash),
    putBlob: ({ hash, mime, data, authorId }) => q.insertBlob.run(hash, mime, data.length, data, authorId, iso()),
  }
}

export function publicVariant(v, head, parentAhead = 0) {
  return {
    id: v.id, projectId: v.project_id, name: v.name, parentVariantId: v.parent_variant_id,
    archived: Boolean(v.archived), createdAt: v.created_at, head, parentAhead,
  }
}
