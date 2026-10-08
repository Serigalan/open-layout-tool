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

/**
 * A track view in the address (Paket RT, decision 254): `walk` the track
 * (`track:<id>`) or route (`route:<id>`), `at` its station, and how it looks —
 * `yaw` and `pitch` [rad], `across` and `h` [m] — so the picture is the same.
 */
export function walkParams(walk) {
  if (!walk?.key || !Number.isFinite(walk.station)) return {}
  const fixed = (v, d) => (Number.isFinite(v) ? String(Number(v.toFixed(d))) : null)
  const out = {
    walk: walk.key.startsWith('route:') ? walk.key : `track:${walk.key}`,
    at: fixed(walk.station, 2),
    yaw: fixed(walk.yaw, 4), pitch: fixed(walk.pitch, 4), across: fixed(walk.across, 2), h: fixed(walk.height, 2),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null))
}

/** The track view an address names, as the key the 3D window walks by, or null. */
function walkFrom(q) {
  const m = /^(track|route):(.+)$/.exec(q.get('walk') ?? '')
  const station = Number(q.get('at'))
  if (!m || !Number.isFinite(station)) return null
  const num = (k) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined)
  return {
    key: m[1] === 'route' ? `route:${m[2]}` : m[2], station,
    yaw: num('yaw'), pitch: num('pitch'), across: num('across'), height: num('h'),
  }
}

/** The address of the 3D window — at a track view where `walk` is given. */
export function cloud3dUrl({ projectId, variantId, cloudId, walk = null }) {
  const q = new URLSearchParams({ project: projectId })
  if (variantId) q.set('variant', variantId)
  if (cloudId) q.set('cloud', cloudId)
  for (const [k, v] of Object.entries(walkParams(walk))) q.set(k, v)
  return `${location.origin}${location.pathname}#/cloud3d?${q}`
}

/** Open (or bring forward) the project's 3D window. */
export function openCloud3d(params) {
  const win = window.open(cloud3dUrl(params), `olt-cloud3d-${params.projectId}`)
  win?.focus()
  return win
}

/** The address a read-only share link opens: the 3D window under the link's token — at a track view where `walk` is given. */
export function cloud3dShareUrl(token, walk = null) {
  const q = new URLSearchParams({ share: token, ...walkParams(walk) })
  return `${location.origin}${location.pathname}#/cloud3d?${q}`
}

/**
 * The parameters of the 3D window's address, or null when this window is not
 * one — `share` the token where it was opened through a share link, `walk`
 * the track view to stand in (walkParams).
 */
export function cloud3dParams(hash = location.hash) {
  const m = /^#\/cloud3d\?(.*)$/.exec(hash)
  if (!m) return null
  const q = new URLSearchParams(m[1])
  return { projectId: q.get('project'), variantId: q.get('variant'), cloudId: q.get('cloud'), share: q.get('share'), walk: walkFrom(q) }
}
