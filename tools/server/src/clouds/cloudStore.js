import { randomUUID } from 'node:crypto'

/**
 * The point clouds and the queue of their jobs on the database (AP 13.1,
 * 13.3). A row is the cloud; its tiles lie on disk (storage.js).
 */
export function createCloudStore(db, { now = () => Date.now() } = {}) {
  const iso = () => new Date(now()).toISOString()
  const q = {
    list:      db.prepare('SELECT * FROM point_cloud WHERE project_id = ? ORDER BY created_at DESC'),
    all:       db.prepare('SELECT * FROM point_cloud'),
    get:       db.prepare('SELECT * FROM point_cloud WHERE id = ?'),
    insert:    db.prepare(`INSERT INTO point_cloud (id, project_id, name, file_name, file_size, format, crs, height_epsg, status,
                             keep_raw, source_points, rgb, created_by, created_at)
                           VALUES (@id, @project_id, @name, @file_name, @file_size, @format, @crs, @height_epsg, 'uploading',
                             @keep_raw, @source_points, @rgb, @created_by, @created_at)`),
    received:  db.prepare('UPDATE point_cloud SET received = ? WHERE id = ? AND received = ?'),
    queued:    db.prepare("UPDATE point_cloud SET status = 'queued', sha256 = COALESCE(?, sha256), error = NULL, progress = NULL WHERE id = ?"),
    status:    db.prepare('UPDATE point_cloud SET status = ?, progress = ?, error = ? WHERE id = ?'),
    progress:  db.prepare("UPDATE point_cloud SET progress = ? WHERE id = ? AND status = 'processing'"),
    ready:     db.prepare(`UPDATE point_cloud SET status = 'ready', progress = 1, error = NULL, points = @points, bytes = @bytes,
                             rgb = @rgb, bounds = @bounds, levels = @levels, ready_at = @ready_at WHERE id = @id`),
    remove:    db.prepare('DELETE FROM point_cloud WHERE id = ?'),
    used:      db.prepare(`SELECT COALESCE(SUM(bytes + CASE WHEN status = 'ready' AND keep_raw = 0 THEN 0 ELSE file_size END), 0)
                           FROM point_cloud WHERE project_id = ?`).pluck(),
    pending:   db.prepare(`SELECT COALESCE(SUM(source_points), 0) AS points, COALESCE(SUM(rgb), 0) AS rgb FROM point_cloud
                           WHERE project_id = ? AND status <> 'ready' AND status <> 'failed'`),
    byProject: db.prepare(`SELECT c.project_id, p.title, COUNT(*) AS clouds, SUM(c.bytes) AS bytes,
                             SUM(CASE WHEN c.status = 'ready' AND c.keep_raw = 0 THEN 0 ELSE c.file_size END) AS raw
                           FROM point_cloud c JOIN project p ON p.id = c.project_id GROUP BY c.project_id ORDER BY bytes DESC`),
    enqueue:   db.prepare(`INSERT INTO cloud_job (cloud_id, kind, status, created_by, created_at) VALUES (?, ?, 'queued', ?, ?)`),
    nextJob:   db.prepare("SELECT * FROM cloud_job WHERE status = 'queued' ORDER BY id LIMIT 1"),
    claim:     db.prepare("UPDATE cloud_job SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'"),
    job:       db.prepare('SELECT * FROM cloud_job WHERE id = ?'),
    finish:    db.prepare('UPDATE cloud_job SET status = ?, finished_at = ?, error = ? WHERE id = ?'),
    requeue:   db.prepare("UPDATE cloud_job SET status = 'queued', started_at = NULL WHERE status = 'running'"),
    requeueClouds: db.prepare("UPDATE point_cloud SET status = 'queued', progress = NULL WHERE status = 'processing'"),
    transforms: db.prepare(`SELECT t.*, u.name AS created_by_name FROM point_cloud_transform t JOIN user u ON u.id = t.created_by
                            WHERE t.cloud_id = ? ORDER BY t.id DESC`),
    transform:  db.prepare('SELECT * FROM point_cloud_transform WHERE id = ?'),
    active:     db.prepare('SELECT * FROM point_cloud_transform WHERE cloud_id = ? AND active = 1'),
    activeIn:   db.prepare(`SELECT t.* FROM point_cloud_transform t JOIN point_cloud c ON c.id = t.cloud_id
                            WHERE c.project_id = ? AND t.active = 1`),
    deactivate: db.prepare('UPDATE point_cloud_transform SET active = 0 WHERE cloud_id = ?'),
    activate:   db.prepare('UPDATE point_cloud_transform SET active = 1 WHERE id = ? AND cloud_id = ?'),
    addTransform: db.prepare(`INSERT INTO point_cloud_transform (cloud_id, matrix, params, pairs, residuals, reference_cloud_id,
                                active, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`),
  }

  return {
    list: (projectId) => q.list.all(projectId),
    all: () => q.all.all(),
    get: (id) => q.get.get(id) ?? null,

    create({ projectId, name, fileName, fileSize, format, crs, heightEpsg, keepRaw, sourcePoints, rgb, userId }) {
      const id = randomUUID()
      q.insert.run({
        id, project_id: projectId, name, file_name: fileName, file_size: fileSize, format, crs, height_epsg: heightEpsg,
        keep_raw: keepRaw ? 1 : 0, source_points: sourcePoints, rgb: rgb ? 1 : 0, created_by: userId, created_at: iso(),
      })
      return id
    },

    /** Move the received mark from `from` to `to` — only if it still is at `from`. */
    received: (id, from, to) => q.received.run(to, id, from).changes === 1,

    /** The cloud is complete (or failed and is tried again): queued, with a job for olt-cloudjobs. */
    enqueue(id, userId, sha256 = null) {
      db.transaction(() => {
        q.queued.run(sha256, id)
        q.enqueue.run(id, 'prepare', userId, iso())
      })()
    },

    setStatus: (id, status, { progress = null, error = null } = {}) => q.status.run(status, progress, error, id),
    setProgress: (id, share) => q.progress.run(share, id),
    setReady: (id, { points, bytes, rgb, bounds, levels }) => q.ready.run({
      id, points, bytes, rgb: rgb ? 1 : 0, bounds: JSON.stringify(bounds), levels: JSON.stringify(levels), ready_at: iso(),
    }),
    remove: (id) => q.remove.run(id),

    /** Bytes a project's clouds hold or are about to: tiles, and raw files still there. */
    used: (projectId) => q.used.get(projectId),
    /** Points of a project's clouds not yet processed, and how many of those have colour. */
    pending: (projectId) => q.pending.get(projectId),
    byProject: () => q.byProject.all(),

    /** The oldest queued job, now running — or null. Of two takers only one gets it. */
    claimJob() {
      return db.transaction(() => {
        const job = q.nextJob.get()
        if (!job) return null
        if (q.claim.run(iso(), job.id).changes !== 1) return null
        return q.job.get(job.id)
      }).immediate()
    },
    job: (id) => q.job.get(id) ?? null,
    finishJob: (id, status, error = null) => q.finish.run(status, iso(), error, id),
    /** After a restart: what was running starts again. */
    requeueRunning() {
      db.transaction(() => { q.requeue.run(); q.requeueClouds.run() })()
    },

    // ── re-referencing (decision 211, AP 13.13–13.14) ──────────────────────
    /** A cloud's transformations, newest first, with who made them. */
    transforms: (cloudId) => q.transforms.all(cloudId),
    transform: (id) => q.transform.get(id) ?? null,
    /** The transformation in force for a cloud, or null. */
    activeTransform: (cloudId) => q.active.get(cloudId) ?? null,
    /** The transformations in force in a project, by cloud. */
    activeTransforms: (projectId) => new Map(q.activeIn.all(projectId).map(t => [t.cloud_id, t])),
    /** A new transformation, from now on the one in force. */
    addTransform({ cloudId, matrix, params, pairs, residuals, referenceCloudId, userId }) {
      return db.transaction(() => {
        q.deactivate.run(cloudId)
        return Number(q.addTransform.run(cloudId, JSON.stringify(matrix), JSON.stringify(params), JSON.stringify(pairs),
          JSON.stringify(residuals), referenceCloudId ?? null, userId, iso()).lastInsertRowid)
      })()
    },
    /** Put an earlier transformation in force again — or none (`id` null). */
    setActiveTransform(cloudId, id) {
      return db.transaction(() => {
        q.deactivate.run(cloudId)
        return id == null || q.activate.run(id, cloudId).changes === 1
      })()
    },
  }
}

/** A transformation as the API shows it; `full` with pairs and residuals. */
export function publicTransform(row, { full = false } = {}) {
  const params = JSON.parse(row.params || '{}')
  return {
    id: row.id,
    cloudId: row.cloud_id,
    matrix: JSON.parse(row.matrix),
    crs: params.crs ?? null,
    active: Boolean(row.active),
    referenceCloudId: row.reference_cloud_id ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    ...(full ? {
      createdByName: row.created_by_name ?? null,
      params,
      pairs: JSON.parse(row.pairs || '[]'),
      residuals: JSON.parse(row.residuals || '{}'),
    } : {}),
  }
}

/** A cloud as the API shows it, with the transformation in force (`transform`, a row) if there is one. */
export function publicCloud(row, transform = null) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    file: { name: row.file_name, size: row.file_size, format: row.format },
    crs: row.crs ?? null,
    heightEpsg: row.height_epsg,
    status: row.status,
    received: row.received,
    progress: row.progress ?? null,
    error: row.error ?? null,
    keepRaw: Boolean(row.keep_raw),
    sourcePoints: row.source_points,
    points: row.points ?? null,
    bytes: row.bytes,
    rgb: Boolean(row.rgb),
    bounds: row.bounds ? JSON.parse(row.bounds) : null,
    levels: JSON.parse(row.levels || '[]'),
    createdBy: row.created_by,
    createdAt: row.created_at,
    readyAt: row.ready_at ?? null,
    transform: transform ? publicTransform(transform) : null,
  }
}
