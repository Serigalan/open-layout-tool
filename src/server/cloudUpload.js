import { api } from './api/client'

/**
 * Uploading a delivery to the server (AP 13.2): in pieces of 8 MB, each with
 * its SHA-256, at the offset the server has received up to. A broken
 * connection is tried again a few times; after a reload of the page the same
 * file, chosen again, goes on where the server's mark stands (resumeKey tells
 * the file apart from another of the same name).
 *
 * The browser hashes each piece; the server checks it before it writes, and
 * hashes the whole file once it is complete.
 */

const PIECE = 8 * 1024 * 1024
/** Waits between tries after a failed piece [s]. */
const RETRIES = [2, 5, 10, 20, 30]
const KEY = 'olt.cloudUploads'

const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
const wait = (s, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, s * 1000)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
})

/** What tells a chosen file from another: name, size and date. */
const fileKey = (file) => `${file.name}|${file.size}|${file.lastModified}`

function remembered() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}
function remember(cloudId, file) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...remembered(), [cloudId]: fileKey(file) })) } catch { /* only resuming needs it */ }
}
function forgetUpload(cloudId) {
  try {
    const all = remembered()
    delete all[cloudId]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* nothing to forget */ }
}

/** Whether `file` is the one an unfinished upload of `cloud` began with. */
export const sameFile = (cloud, file) => remembered()[cloud.id] === fileKey(file)
  || (cloud.file.name === file.name && cloud.file.size === file.size && !(cloud.id in remembered()))

/**
 * Upload `file` into `cloud` (created already, `{ id, received }`) from the
 * server's mark on. `onProgress({ sent, total, rate, remaining })` after each
 * piece — rate [bytes/s], remaining [s]. Resolves the cloud as the server has
 * it once complete; rejects with an AbortError on `signal`.
 */
async function uploadFile({ projectId, cloud, file, signal, onProgress }) {
  remember(cloud.id, file)
  let at = cloud.received ?? 0
  const started = performance.now(), from = at
  while (at < file.size) {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    const piece = new Uint8Array(await file.slice(at, Math.min(file.size, at + PIECE)).arrayBuffer())
    const sum = hex(await crypto.subtle.digest('SHA-256', piece))
    let tries = 0
    for (;;) {
      try {
        const { received } = await api.uploadCloudPiece(projectId, cloud.id, at, piece, sum)
        at = received
        break
      } catch (err) {
        // A connection lost or a server restarting: try again a few times.
        if (!(err.status === 0 || err.status >= 500) || tries >= RETRIES.length) throw err
        await wait(RETRIES[tries++], signal)
      }
    }
    const s = (performance.now() - started) / 1000
    const rate = s > 0 ? (at - from) / s : null
    onProgress?.({ sent: at, total: file.size, rate, remaining: rate ? (file.size - at) / rate : null })
  }
  const { cloud: done } = await api.completeCloud(projectId, cloud.id)
  forgetUpload(cloud.id)
  return done
}

// ── uploads running in this tab ─────────────────────────────────────────────
// Kept outside any component: closing the panel does not stop an upload, and
// opening it again shows it running.

let running = []            // [{ cloudId, projectId, name, progress, abort }]
const listeners = new Set()
const changed = (next) => { running = next; for (const fn of listeners) fn() }

export const subscribeUploads = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const runningUploads = () => running

/**
 * Run an upload in the background of this tab: `cloud` is the server's row
 * (new, or one to resume). Resolves the cloud once complete, null when
 * aborted — an aborted upload is deleted on the server, nothing stays.
 */
export async function runUpload({ projectId, cloud, file }) {
  const ctl = new AbortController()
  changed([...running.filter(u => u.cloudId !== cloud.id),
    { cloudId: cloud.id, projectId, name: cloud.name, progress: { sent: cloud.received ?? 0, total: file.size }, abort: () => ctl.abort() }])
  const update = (progress) => changed(running.map(u => (u.cloudId === cloud.id ? { ...u, progress } : u)))
  try {
    return await uploadFile({ projectId, cloud, file, signal: ctl.signal, onProgress: update })
  } catch (err) {
    if (err?.name !== 'AbortError') throw err
    forgetUpload(cloud.id)
    await api.deleteCloud(projectId, cloud.id).catch(() => {})
    return null
  } finally {
    changed(running.filter(u => u.cloudId !== cloud.id))
  }
}

/** A new cloud on the server for `file`, with what its header says and the datums chosen. */
export async function createServerCloud({ projectId, file, header, name, crs, heightEpsg, keepRaw }) {
  const format = header.format === 'e57' ? 'e57' : header.compressed ? 'laz' : 'las'
  const { cloud } = await api.createCloud(projectId, {
    name, fileName: file.name, fileSize: file.size, format, crs, heightEpsg, keepRaw,
    pointCount: header.pointCount, rgb: !!header.rgb,
  })
  return cloud
}
