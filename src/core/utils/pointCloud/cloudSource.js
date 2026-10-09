import { cloudTilesFile } from './cloudStore'
import { extensionsOf } from '../../extensions'

/**
 * One way to read a cloud's tile file (AP 13.6), wherever it lies:
 * `read(offset, length)` and `readMany(ranges)`, each giving bytes.
 * cloudSection, cloudSlice and clearanceCheck read through it and do not care
 * where from.
 *
 * - **Local** (a cloud read in on this device): the OPFS file, ranges close
 *   together read in one go.
 * - **Elsewhere**: a cloud a provider of the extension point `cloudProviders`
 *   (Paket L) says is its own — `sourceKey(cloud)` a key, not null — is read
 *   through its `reader(projectId, cloud)`: the server's clouds in the main
 *   build (server/cloudsOnServer.js).
 */

/** Segments closer together than this in a local tile file are read in one go [bytes]. */
const MERGE_GAP = 256 * 1024

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

const sources = new Map()

/**
 * The source of a cloud as cloudSection gets it — `cloud.source` where one is
 * given (tests), its provider's for a cloud a provider says is its own (the
 * server's for one with `server: { level }`), the local file otherwise. One
 * per cloud (and level), kept. A provider's key starts with the cloud's id.
 */
export function sourceOf(projectId, cloud) {
  if (cloud.source) return cloud.source
  const provider = extensionsOf('cloudProviders').find(p => p.sourceKey(cloud) != null)
  const key = provider ? provider.sourceKey(cloud) : `${projectId}|${cloud.id}`
  let s = sources.get(key)
  if (!s) {
    s = provider ? provider.reader(projectId, cloud) : localSource(projectId, cloud.id)
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
