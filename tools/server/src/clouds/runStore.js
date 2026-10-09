/** How long a finished run and what it found are kept [ms] (decision 238). */
const RUN_KEEP = 7 * 24 * 3600 * 1000

/**
 * The long runs over a project's clouds on the database (AP 13.7): the
 * clearance check along a track and the rail trace, queued for olt-cloudjobs
 * like a preparation, each with what the browser sent and what it found.
 */
export function createRunStore(db, { now = () => Date.now() } = {}) {
  const iso = () => new Date(now()).toISOString()
  const q = {
    insert:   db.prepare(`INSERT INTO cloud_run (project_id, kind, status, subject, params, clouds, created_by, created_at)
                          VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)`),
    get:      db.prepare('SELECT * FROM cloud_run WHERE id = ?'),
    list:     db.prepare(`SELECT id, project_id, kind, status, subject, clouds, progress, error, created_by, created_at,
                            started_at, finished_at FROM cloud_run WHERE project_id = ? ORDER BY id DESC LIMIT ?`),
    active:   db.prepare("SELECT COUNT(*) FROM cloud_run WHERE project_id = ? AND status IN ('queued', 'running')").pluck(),
    next:     db.prepare("SELECT id FROM cloud_run WHERE status = 'queued' ORDER BY id LIMIT 1").pluck(),
    claim:    db.prepare("UPDATE cloud_run SET status = 'running', started_at = ?, progress = 0 WHERE id = ? AND status = 'queued'"),
    progress: db.prepare("UPDATE cloud_run SET progress = ? WHERE id = ? AND status = 'running'"),
    done:     db.prepare(`UPDATE cloud_run SET status = 'done', progress = 1, result = ?, finished_at = ?
                          WHERE id = ? AND status = 'running'`),
    finish:   db.prepare(`UPDATE cloud_run SET status = ?, error = ?, finished_at = ?
                          WHERE id = ? AND status IN ('queued', 'running')`),
    requeue:  db.prepare("UPDATE cloud_run SET status = 'queued', started_at = NULL, progress = NULL WHERE status = 'running'"),
    remove:   db.prepare('DELETE FROM cloud_run WHERE id = ?'),
    prune:    db.prepare("DELETE FROM cloud_run WHERE status NOT IN ('queued', 'running') AND created_at < ?"),
  }

  return {
    create({ projectId, kind, subject, params, clouds, userId }) {
      return Number(q.insert.run(projectId, kind, JSON.stringify(subject ?? {}), JSON.stringify(params),
        JSON.stringify(clouds), userId, iso()).lastInsertRowid)
    },
    get: (id) => q.get.get(id) ?? null,
    list: (projectId, limit = 20) => q.list.all(projectId, limit),
    /** Runs of a project queued or running. */
    active: (projectId) => q.active.get(projectId),

    /** The oldest queued run, now running — or null. Of two takers only one gets it. */
    claim() {
      return db.transaction(() => {
        const id = q.next.get()
        if (id == null || q.claim.run(iso(), id).changes !== 1) return null
        return q.get.get(id)
      }).immediate()
    },
    setProgress: (id, share) => q.progress.run(share, id),
    /** Done, with what it found — unless it was cancelled meanwhile. */
    done: (id, result) => q.done.run(JSON.stringify(result), iso(), id).changes === 1,
    /** Failed or cancelled; a run already finished stays as it is. */
    finish: (id, status, error = null) => q.finish.run(status, error, iso(), id).changes === 1,
    remove: (id) => q.remove.run(id),
    /** After a restart: what was running starts again (decision 224). */
    requeueRunning: () => q.requeue.run(),
    /** Forget finished runs older than RUN_KEEP. */
    prune: () => q.prune.run(new Date(now() - RUN_KEEP).toISOString()).changes,
  }
}

/** A run as the API shows it; `result` only where asked for. */
export function publicRun(row, { withResult = false } = {}) {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    status: row.status,
    subject: JSON.parse(row.subject || '{}'),
    clouds: JSON.parse(row.clouds || '[]'),
    progress: row.progress ?? null,
    error: row.error ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    ...(withResult ? { result: row.result ? JSON.parse(row.result) : null } : {}),
  }
}
