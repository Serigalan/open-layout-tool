import { mkdirSync, rmSync, statfsSync } from 'node:fs'
import { join } from 'node:path'

/** Largest share of the disk a project's clouds may take [bytes] (AP 13.1). */
export const PROJECT_QUOTA = 25 * 1024 ** 3
/** Free space an upload must leave on the disk [bytes]. */
export const DISK_RESERVE = 5 * 1024 ** 3
/** Below this much free space the admin view warns [bytes] (AP 13.16). */
export const DISK_WARN = 20 * 1024 ** 3

const SAFE = /^[0-9a-f-]{36}$/

/**
 * Where the clouds lie on disk (AP 13.1): one directory per project, one per
 * cloud in it —
 *
 *     <root>/<project>/<cloud>/raw.part         the upload, until it is processed
 *     <root>/<project>/<cloud>/tiles-L<n>.bin   segments of level n, back to back
 *     <root>/<project>/<cloud>/index-L<n>.json  the index of level n
 *
 * Ids are uuids the server made; anything else never becomes a path.
 */
export function cloudStorage(root) {
  const dir = (projectId, cloudId) => {
    if (!SAFE.test(projectId) || !SAFE.test(cloudId)) throw new Error('bad id')
    return join(root, projectId, cloudId)
  }
  return {
    root,
    dir,
    ensure(projectId, cloudId) {
      const d = dir(projectId, cloudId)
      mkdirSync(d, { recursive: true })
      return d
    },
    raw: (projectId, cloudId) => join(dir(projectId, cloudId), 'raw.part'),
    tiles: (projectId, cloudId, level) => join(dir(projectId, cloudId), `tiles-L${level}.bin`),
    index: (projectId, cloudId, level) => join(dir(projectId, cloudId), `index-L${level}.json`),
    remove(projectId, cloudId) {
      rmSync(dir(projectId, cloudId), { recursive: true, force: true })
    },
    /** Free and total bytes of the disk the clouds lie on. */
    disk() {
      mkdirSync(root, { recursive: true })
      const s = statfsSync(root)
      return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }
    },
  }
}

/**
 * Bytes the tiles of a delivery of `points` points will take on all five
 * levels: about 4.5 a point for the original, 1.25 for the 2-cm voxel and
 * a little for the coarse levels (measured on 5550L, roadmap phase 13); colour
 * adds some 2 bytes a point.
 */
export const estimateTileBytes = (points, rgb = false) => Math.round(points * (5.9 + (rgb ? 2 : 0)))
