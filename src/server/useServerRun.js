import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api/client'

/**
 * Long runs over a project's clouds on the server (AP 13.7) as the panels
 * see them: the clearance check along a track and the rail trace, started
 * with what the browser's working copy says, followed by asking every few
 * seconds, and found again after the page was reloaded or closed.
 */

/** How often a run on the server is asked for [ms]. */
const POLL = 2000

const ACTIVE = new Set(['queued', 'running'])
export const runIsActive = (run) => ACTIVE.has(run?.status)

/**
 * Whether a long run goes to the server (decision 237): when the user may
 * start one (decision 203) and every cloud it reads lies there. A cloud only
 * on this device, or a user without the right, keeps it in the browser.
 */
export const runsOnServer = (clouds, mayEdit) => Boolean(mayEdit) && clouds.length > 0 && clouds.every(c => c.server)

/**
 * The latest run of `kind` on the server whose subject has the fields of
 * `subject` (`{ trackId }` say), kept up to date while it runs, with its
 * result once it is done — and `start`, `cancel` and `forget`. `enabled`
 * false leaves the server alone (a project without clouds there). `run` is
 * null where there is none.
 */
export default function useServerRun(projectId, kind, subject, enabled) {
  // What was found belongs to what was asked for: asked for something else,
  // the panel sees nothing until that is found.
  const want = JSON.stringify(subject ?? {})
  const key = `${projectId}|${kind}|${want}|${enabled ? 1 : 0}`
  const [state, setState] = useState({ key: null, run: null, error: null })
  const mine = state.key === key
  const run = mine ? state.run : null
  const error = mine ? state.error : null
  const put = useCallback((change) => setState(s => ({ ...(s.key === key ? s : { run: null, error: null }), key, ...change })), [key])
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  const load = useCallback(async (id) => {
    const { run: r } = await api.run(projectId, id)
    if (live.current) put({ run: r })
    return r
  }, [projectId, put])

  // The latest matching run, whenever what to match changes.
  useEffect(() => {
    if (!enabled) return undefined
    let stale = false
    api.runs(projectId).then(({ runs }) => {
      if (stale) return
      const fields = Object.entries(JSON.parse(want))
      const found = runs.find(r => r.kind === kind && r.status !== 'cancelled'
        && fields.every(([k, v]) => r.subject?.[k] === String(v)))
      if (found) load(found.id).catch(() => {})
    }).catch(() => {})
    return () => { stale = true }
  }, [projectId, kind, enabled, want, load])

  // While it runs, it is asked for again.
  const active = runIsActive(run)
  const runId = run?.id
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => { load(runId).catch(() => {}) }, POLL)
    return () => clearInterval(timer)
  }, [active, runId, load])

  const start = async (params, about) => {
    put({ error: null })
    try {
      const { run: r } = await api.startRun(projectId, { kind, params, subject: about })
      put({ run: r })
    } catch (err) {
      put({ error: err })
    }
  }
  const cancel = async () => {
    if (!run) return
    try { put({ run: (await api.cancelRun(projectId, run.id)).run }) } catch (err) { put({ error: err }) }
  }
  /** Forget a finished run on the server — its result was taken over. */
  const forget = async () => {
    if (!run) return
    const id = run.id
    put({ run: null })
    await api.cancelRun(projectId, id).catch(() => {})
  }
  return { run, error, start, cancel, forget }
}
