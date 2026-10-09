import { api } from './api/client'
import { cacheGet, cachePut } from '../core/utils/pointCloud/cloudCache'

/**
 * The project's clouds on the server (AP 13.6) as core reads clouds
 * (extension point `cloudProviders`, Paket L): those that are ready and lie
 * in a known system — each one level of detail, its index fetched once. A
 * server cloud carries `server: { level }`, which tells cloudSource to read
 * it here, and its re-referencing in force as `transform` (AP 13.15), which
 * every reader applies (cloudCrs.cloudToPlane).
 *
 * Read: the cache first (cloudCache), the rest in collective requests of up
 * to 64 ranges each — one per cross section mostly — and what came kept in
 * the cache.
 */

/** Ranges a collective request may ask for (the server's MAX_RANGES). */
const PER_REQUEST = 64
/** Bytes a collective request asks for at most. */
const BYTES_PER_REQUEST = 32 * 1024 * 1024

function serverSource(projectId, cloudId, level) {
  const keyOf = ([offset, length]) => `${cloudId}|L${level}|${offset}|${length}`
  // Ranges asked for and not yet come: a second reader of the same segment
  // (the rail search beside the section) waits for the first.
  const inflight = new Map()   // key → Promise<Uint8Array>
  const readMany = async (ranges) => {
    const keys = ranges.map(keyOf)
    const cached = await cacheGet(keys)
    const waiting = []
    const missing = []
    ranges.forEach((r, k) => {
      if (cached.has(keys[k])) return
      if (inflight.has(keys[k])) waiting.push([k, inflight.get(keys[k])])
      else missing.push(k)
    })
    const settle = new Map()
    for (const k of missing) {
      let done
      inflight.set(keys[k], new Promise((resolve, reject) => { done = { resolve, reject } }))
      inflight.get(keys[k]).catch(() => {})
      settle.set(k, done)
    }
    const batches = []
    let cur = [], bytes = 0
    for (const k of missing) {
      if (cur.length === PER_REQUEST || (cur.length && bytes + ranges[k][1] > BYTES_PER_REQUEST)) {
        batches.push(cur); cur = []; bytes = 0
      }
      cur.push(k); bytes += ranges[k][1]
    }
    if (cur.length) batches.push(cur)
    try {
      await Promise.all(batches.map(async (ks) => {
        const body = await api.cloudRanges(projectId, cloudId, level, ks.map(k => ranges[k]))
        const items = []
        let at = 0
        for (const k of ks) {
          const part = body.slice(at, at + ranges[k][1])
          at += ranges[k][1]
          cached.set(keys[k], part)
          settle.get(k).resolve(part)
          items.push([keys[k], part])
        }
        cachePut(items)
      }))
    } catch (err) {
      for (const k of missing) settle.get(k).reject(err)
      throw err
    } finally {
      for (const k of missing) inflight.delete(keys[k])
    }
    for (const [k, pending] of waiting) cached.set(keys[k], await pending)
    return keys.map(k => cached.get(k))
  }
  return { readMany, read: async (offset, length) => (await readMany([[offset, length]]))[0] }
}

const indexes = new Map()   // "cloudId|level|readyAt" → Promise<index>

/** The re-referencing of a cloud as the readers take it. */
const transformOf = (row) => (row.transform ? { id: row.transform.id, matrix: row.transform.matrix, crs: row.transform.crs } : null)

/** The index of one level of a server cloud (`row` as the API lists it), fetched once. */
export function serverLevel(projectId, row, level) {
  const key = `${row.id}|${level}|${row.readyAt}`
  if (!indexes.has(key)) {
    indexes.set(key, api.cloudIndex(projectId, row.id, level)
      .catch((err) => { indexes.delete(key); throw err }))
  }
  return indexes.get(key).then(index => ({ ...index, id: row.id, server: { level }, transform: transformOf(row) }))
}

/**
 * A server cloud the cross section can read: ready, and in a system the
 * tracks can be put into — its own, or the one a re-referencing put it in.
 */
export const readableOnServer = (row) => row.status === 'ready' && (row.crs != null || row.transform != null)

/** The server's clouds at `level` (1 the 2-cm voxel, 0 the original); none where the server cannot be reached. */
async function listOnServer(projectId, { level = 1 } = {}) {
  const rows = await api.clouds(projectId).then(r => r.clouds).catch(() => [])
  const remote = await Promise.all(rows.filter(readableOnServer).map(r => serverLevel(projectId, r, level).catch(() => null)))
  return remote.filter(Boolean)
}

export const serverClouds = {
  id: 'server',
  list: listOnServer,
  sourceKey: (cloud) => (cloud.server ? `${cloud.id}|L${cloud.server.level}` : null),
  reader: (projectId, cloud) => serverSource(projectId, cloud.id, cloud.server.level),
}
