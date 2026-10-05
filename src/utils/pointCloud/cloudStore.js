/**
 * Where point clouds live: the Origin Private File System of this browser,
 * one directory per project, one per cloud in it (Entscheidungen 115, 119).
 * Nothing about a cloud is in the project record — another device simply has
 * none.
 *
 *     pointclouds/<projectId>/<cloudId>/tiles.bin    segments, back to back
 *     pointclouds/<projectId>/<cloudId>/index.json   written last
 *
 * The index is what makes a cloud exist: it is written once every tile is,
 * so a directory without one is an import that was aborted or died — it is
 * cleared away, and is never listed.
 */

const ROOT = 'pointclouds'
export const INDEX_FILE = 'index.json'
export const TILES_FILE = 'tiles.bin'
/** A directory without an index older than this is left over from a dead import [ms]. */
const STALE_AFTER = 60 * 60 * 1000

export const opfsAvailable = () => typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory

export async function projectDir(projectId, create = false) {
  const root = await navigator.storage.getDirectory()
  const all = await root.getDirectoryHandle(ROOT, { create })
  return all.getDirectoryHandle(String(projectId), { create })
}

/** Ask the browser not to evict the clouds under storage pressure. Best effort. */
export async function persistStorage() {
  try {
    if (await navigator.storage.persisted?.()) return true
    return (await navigator.storage.persist?.()) ?? false
  } catch {
    return false
  }
}

/**
 * Bytes a file of `pointCount` points will take once imported: 2-cm voxels
 * keep about 28 % of mobile-mapping points at 3.9 bytes each (measured on the
 * sample, ~1.1 bytes per point read), with some room for a denser survey. The
 * original resolution keeps every point, about 4.0 bytes each on a millimetre
 * grid (the sample); each tenfold finer `step` [m] may add some ten bits of
 * noise a point.
 */
export function estimateCloudBytes(pointCount, { original = false, step = 0.001 } = {}) {
  if (!original) return Math.round(pointCount * 1.25)
  return Math.round(pointCount * (4.5 + 1.25 * Math.max(0, Math.log10(0.001 / step))))
}

/** Whether the browser has promised to keep this origin's storage. */
export async function storagePersisted() {
  try {
    return (await navigator.storage.persisted?.()) ?? false
  } catch {
    return false
  }
}

/** Space used and offered to this origin [bytes], or null where the browser does not say. */
export async function storageEstimate() {
  try {
    const { usage, quota } = await navigator.storage.estimate()
    return { usage, quota, free: Math.max(0, quota - usage) }
  } catch {
    return null
  }
}

/**
 * The clouds of a project, each its index plus `id` — newest first. Leftovers
 * of dead imports are removed on the way.
 */
export async function listClouds(projectId) {
  if (!opfsAvailable()) return []
  let dir
  try {
    dir = await projectDir(projectId)
  } catch {
    return []   // no cloud was ever imported for this project
  }
  const clouds = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'directory') continue
    try {
      const file = await (await handle.getFileHandle(INDEX_FILE)).getFile()
      clouds.push({ ...JSON.parse(await file.text()), id: name })
    } catch {
      try {
        const tiles = await (await handle.getFileHandle(TILES_FILE)).getFile()
        if (Date.now() - tiles.lastModified > STALE_AFTER) await dir.removeEntry(name, { recursive: true })
      } catch {
        await dir.removeEntry(name, { recursive: true }).catch(() => {})
      }
    }
  }
  return clouds.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

export async function deleteCloud(projectId, cloudId) {
  const dir = await projectDir(projectId)
  await dir.removeEntry(cloudId, { recursive: true })
}

/** The tile file of a cloud, as a File to slice segments out of. */
export async function cloudTilesFile(projectId, cloudId) {
  const dir = await (await projectDir(projectId)).getDirectoryHandle(cloudId)
  return (await dir.getFileHandle(TILES_FILE)).getFile()
}
