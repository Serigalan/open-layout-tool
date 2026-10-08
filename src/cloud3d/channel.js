/**
 * The 3D window and the main window talk over a BroadcastChannel of the
 * project (AP 13.10, decision 210):
 *
 *   3D → main   { type: 'hello' }                    send me the project and the section
 *               { type: 'ping' }                     are you there?
 *               { type: 'station', trackId, station } a double click in 3D: show the section here
 *   main → 3D   { type: 'project', data }            tracks, switches, measured axes, gauge profile
 *               { type: 'section', at }              the cross section shown ({ trackId, station } or null)
 *               { type: 'pong' }
 *
 * The 3D window works without the main window too: it then reads the
 * variant's checked-in head and says so.
 */

const channelName = (projectId) => `olt-cloud3d-${projectId}`

/** A channel of the project, `onMessage(data)` for what comes; null where the browser has none. */
export function openChannel(projectId, onMessage) {
  if (typeof BroadcastChannel === 'undefined' || !projectId) return null
  const ch = new BroadcastChannel(channelName(projectId))
  ch.onmessage = (e) => onMessage(e.data)
  return ch
}

/** The address of the 3D window. */
function cloud3dUrl({ projectId, variantId, cloudId }) {
  const q = new URLSearchParams({ project: projectId })
  if (variantId) q.set('variant', variantId)
  if (cloudId) q.set('cloud', cloudId)
  return `${location.origin}${location.pathname}#/cloud3d?${q}`
}

/** Open (or bring forward) the project's 3D window. */
export function openCloud3d(params) {
  const win = window.open(cloud3dUrl(params), `olt-cloud3d-${params.projectId}`)
  win?.focus()
  return win
}

/** The parameters of the 3D window's address, or null when this window is not one. */
export function cloud3dParams(hash = location.hash) {
  const m = /^#\/cloud3d\?(.*)$/.exec(hash)
  if (!m) return null
  const q = new URLSearchParams(m[1])
  return { projectId: q.get('project'), variantId: q.get('variant'), cloudId: q.get('cloud') }
}
