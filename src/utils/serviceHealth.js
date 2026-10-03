import { optimizerReachable } from './optimizerService'

// What the app depends on, and whether it was there at the last look (R10.12):
// the project server, the optimizer service (which also converts MDB files and
// serves the DGM1 heights), and the BKG's DGM5 terrain tiles. Asked once a
// minute while someone works on the map, and at once on request.

const PROJECT_HEALTH = `${import.meta.env?.VITE_OLT_API ?? '/api'}/health`
// One tile over Germany, zoom 5 — small, and there as long as the service is.
const DGM5_PROBE = 'https://sg.geodatenzentrum.de/gdz_basemapde_3d_gelaende/dgm5_rgb_tiles/5/16/10.png'
const INTERVAL_MS = 60000

export const SERVICES = ['server', 'optimizer', 'terrain']

const reachable = async (url) => {
  try { return (await fetch(url, { method: 'GET', cache: 'no-store' })).ok } catch { return false }
}

const CHECKS = {
  server: () => reachable(PROJECT_HEALTH),
  optimizer: () => optimizerReachable(),
  terrain: () => reachable(DGM5_PROBE),
}

// { server: { ok, at }, … } — ok null until first asked.
let _state = Object.freeze(Object.fromEntries(SERVICES.map(s => [s, Object.freeze({ ok: null, at: null })])))
const _listeners = new Set()
let _timer = null
let _users = 0

/** The last look at every service. */
export const serviceHealth = () => _state

export function subscribeHealth(listener) {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

/** Ask every service (or the one named) now; resolves when the answers are in. */
export async function checkServices(only = null, checks = CHECKS) {
  const names = only ? [only] : SERVICES
  const answers = await Promise.all(names.map(async n => [n, await checks[n]()]))
  const at = new Date().toISOString()
  _state = Object.freeze({ ..._state, ...Object.fromEntries(answers.map(([n, ok]) => [n, Object.freeze({ ok, at })])) })
  for (const l of [..._listeners]) l()
  return _state
}

/** Keep asking once a minute while at least one caller wants it; returns the stop. */
export function watchServices() {
  _users++
  if (_users === 1) {
    checkServices()
    _timer = setInterval(() => checkServices(), INTERVAL_MS)
  }
  return () => {
    _users--
    if (_users === 0) { clearInterval(_timer); _timer = null }
  }
}
