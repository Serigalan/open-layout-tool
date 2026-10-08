import { ApiError } from '../errors.js'
import { mayEditClouds } from '../auth.js'
import { createStore } from '../store.js'
import { createCloudStore } from '../clouds/cloudStore.js'
import { createRunStore, publicRun } from '../clouds/runStore.js'

/** Runs a project may have queued or running at once. */
const ACTIVE_LIMIT = 4

const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const isRing = (v) => Array.isArray(v) && v.length >= 3 && v.every(p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite))
const isTrack = (t) => isObject(t) && t.id != null && Array.isArray(t.elements) && Number.isInteger(Number(t.epsg))

/** What a run needs, checked for its shape; the run's own code reads the rest. */
function checkParams(kind, p) {
  if (!isObject(p)) return false
  if (kind === 'clearance') {
    return isTrack(p.track) && isRing(p.ring) && (p.areas == null || Array.isArray(p.areas))
      && Array.isArray(p.tracks ?? []) && Array.isArray(p.switches ?? [])
  }
  if (kind === 'trace') {
    const g = p.guide
    if (typeof p.rail !== 'string' || !isObject(g)) return false
    if (g.kind === 'track') return isTrack(g.track)
    if (g.kind === 'line') {
      return Number.isInteger(g.epsg) && Array.isArray(g.vertices) && g.vertices.length >= 2
        && g.vertices.every(v => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite))
    }
  }
  return false
}

/**
 * Long runs over a project's clouds on the server (AP 13.7): the clearance
 * check along a whole track and the trace of a track's rail heads, as jobs of
 * olt-cloudjobs over the project's ready clouds (decision 209). The browser
 * sends what it needs of its working copy — the track, the guide; the clouds
 * are those on the server. Seeing runs and their results is every member's,
 * starting and cancelling them the admins' and the users' with the right
 * (decision 203).
 */
export default async function runRoutes(api) {
  const store = createStore(api.db, { now: api.now })
  const clouds = createCloudStore(api.db, { now: api.now })
  const runs = createRunStore(api.db, { now: api.now })
  const opts = { preHandler: api.requireUser }

  const projectOr404 = (req) => {
    if (!api.cloudStorage) throw new ApiError(503, 'clouds_unavailable')
    const p = store.project(req.params.id)
    if (!p || !store.canSee(req.user, p)) throw new ApiError(404, 'not_found')
    return p
  }
  const editor = (req) => {
    if (!mayEditClouds(req.user)) throw new ApiError(403, 'clouds_not_allowed')
  }
  const runOr404 = (req) => {
    const p = projectOr404(req)
    const r = runs.get(Number(req.params.rid))
    if (!r || r.project_id !== p.id) throw new ApiError(404, 'not_found')
    return r
  }

  api.get('/projects/:id/runs', opts, async (req) => {
    const p = projectOr404(req)
    return { runs: runs.list(p.id).map(r => publicRun(r)), mayEdit: mayEditClouds(req.user) }
  })

  api.post('/projects/:id/runs', opts, async (req, reply) => {
    const p = projectOr404(req)
    editor(req)
    const { kind, params, subject } = req.body ?? {}
    if (kind !== 'clearance' && kind !== 'trace') throw new ApiError(422, 'run_kind')
    if (!checkParams(kind, params)) throw new ApiError(422, 'run_params')
    // The clouds in a known system — their own, or one a re-referencing put them in.
    const placed = clouds.activeTransforms(p.id)
    const ready = clouds.list(p.id).filter(c => c.status === 'ready' && (c.crs != null || placed.has(c.id))).map(c => c.id)
    if (!ready.length) throw new ApiError(409, 'run_no_clouds')
    if (runs.active(p.id) >= ACTIVE_LIMIT) throw new ApiError(429, 'runs_busy', { limit: ACTIVE_LIMIT })
    runs.prune()
    const id = runs.create({
      projectId: p.id, kind, params, clouds: ready, userId: req.user.id,
      subject: isObject(subject) ? Object.fromEntries(Object.entries(subject).slice(0, 8).map(([k, v]) => [k, String(v).slice(0, 200)])) : {},
    })
    return reply.code(201).send({ run: publicRun(runs.get(id)) })
  })

  api.get('/projects/:id/runs/:rid', opts, async (req) => ({ run: publicRun(runOr404(req), { withResult: true }) }))

  // A run queued or running is cancelled — the job notices at its next step;
  // a finished one is forgotten.
  api.delete('/projects/:id/runs/:rid', opts, async (req, reply) => {
    const r = runOr404(req)
    editor(req)
    if (r.status === 'queued' || r.status === 'running') {
      runs.finish(r.id, 'cancelled')
      return { run: publicRun(runs.get(r.id)) }
    }
    runs.remove(r.id)
    return reply.code(204).send()
  })
}
