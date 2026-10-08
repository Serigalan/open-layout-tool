import { api } from '../../api/client'
import { cloudTilesFile } from './cloudStore'
import { cacheGet, cachePut } from './cloudCache'

/**
 * One way to read a cloud's tile file (AP 13.6), whether it lies in this
 * browser or on the server: `read(offset, length)` and `readMany(ranges)`,
 * each giving bytes. cloudSection, cloudSlice and clearanceCheck read through
 * it and do not care which.
 *
 * - **Local** (a cloud read in on this device): the OPFS file, ranges close
 *   together read in one go.
 * - **Server**: the cache first (cloudCache), the rest in collective requests
 *   of up to 64 ranges each — one per cross section mostly — and what came
 *   kept in the cache.
 */

/** Segments closer together than this in a local tile file are read in one go [bytes]. */
const MERGE_GAP = 256 * 1024
/** Ranges a collective request may ask for (the server's MAX_RANGES). */
const PER_REQUEST = 64
/** Bytes a collective request asks for at most. */
const BYTES_PER_REQUEST = 32 * 1024 * 1024

function localSource(projectId, cloudId) {
  let file = null
  const readMany = async (ranges) => {
    file ??= cloudTilesFile(projectId, cloudId)
    const f = await file
    const order = ranges.map((r, k) => k).sort((a, b) => ranges[a][0] - ranges[b][0])
    const groups = []
    for (const k of order) {
      const [offset, length] = ranges[k]
      const last = groups[groups.length - 1]
      if (last && offset - last.end <= MERGE_GAP) { last.ks.push(k); last.end = Math.max(last.end, offset + length) }
      else groups.push({ start: offset, end: offset + length, ks: [k] })
    }
    const out = new Array(ranges.length)
    await Promise.all(groups.map(async ({ start, end, ks }) => {
      const bytes = new Uint8Array(await f.slice(start, end).arrayBuffer())
      for (const k of ks) out[k] = bytes.subarray(ranges[k][0] - start, ranges[k][0] - start + ranges[k][1])
    }))
    return out
  }
  return { readMany, read: async (offset, length) => (await readMany([[offset, length]]))[0] }
}

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

const sources = new Map()

/**
 * The source of a cloud as cloudSection gets it — `cloud.source` where one is
 * given (tests), the server's for a cloud with `server` (`{ level }`), the
 * local file otherwise. One per cloud and level, kept.
 */
export function sourceOf(projectId, cloud) {
  if (cloud.source) return cloud.source
  const key = cloud.server ? `${cloud.id}|L${cloud.server.level}` : `${projectId}|${cloud.id}`
  let s = sources.get(key)
  if (!s) {
    s = cloud.server ? serverSource(projectId, cloud.id, cloud.server.level) : localSource(projectId, cloud.id)
    sources.set(key, s)
  }
  return s
}

/** Forget the source of a cloud — after it was deleted. */
export function forgetSource(cloudId) {
  for (const key of [...sources.keys()]) if (key.startsWith(`${cloudId}|`) || key.endsWith(`|${cloudId}`)) sources.delete(key)
}

/** Forget every source. */
export const forgetSources = () => sources.clear()
