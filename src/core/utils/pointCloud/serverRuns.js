import { provided } from '../../extensions'

/**
 * Long runs over a project's clouds on the server (AP 13.7) as the panels of
 * core see them. The runs themselves are the server's (`useServerRun`,
 * provided by server/useServerRun.js, Paket L); without it every run is the
 * browser's.
 */

const ACTIVE = new Set(['queued', 'running'])
export const runIsActive = (run) => ACTIVE.has(run?.status)

/**
 * Whether a long run goes to the server (decision 237): when the user may
 * start one (decision 203) and every cloud it reads lies there. A cloud only
 * on this device, or a user without the right, keeps it in the browser.
 */
export const runsOnServer = (clouds, mayEdit) => Boolean(mayEdit) && clouds.length > 0 && clouds.every(c => c.server)

const NO_RUN = Object.freeze({
  run: null, error: null,
  start: async () => {}, cancel: async () => {}, forget: async () => {},
})
const useNoServerRun = () => NO_RUN

/**
 * The hook behind a panel's run on the server:
 *   useServerRun(projectId, kind, subject, enabled) → { run, error, start, cancel, forget }
 * (see server/useServerRun.js) — one that never finds a run without the server.
 */
export const serverRunHook = () => provided('useServerRun', useNoServerRun)
