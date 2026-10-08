import { api } from '../../api/client'
import { listClouds } from './cloudStore'

/**
 * The clouds of a project as the cross section, the clearance check and the
 * rail trace read them (AP 13.6): those on the server that are ready and lie
 * in a known system — each one level of detail, its index fetched once — and
 * those read in on this device (Entscheidung 204). A server cloud carries
 * `server: { level }`, which tells cloudSource where to read it.
 */

const indexes = new Map()   // "cloudId|level|readyAt" → Promise<index>

/** The index of one level of a server cloud (`row` as the API lists it), fetched once. */
export function serverLevel(projectId, row, level) {
  const key = `${row.id}|${level}|${row.readyAt}`
  if (!indexes.has(key)) {
    indexes.set(key, api.cloudIndex(projectId, row.id, level)
      .then(index => ({ ...index, id: row.id, server: { level } }))
      .catch((err) => { indexes.delete(key); throw err }))
  }
  return indexes.get(key)
}

/** A server cloud the cross section can read: ready, and in a system the tracks can be put into. */
export const readableOnServer = (row) => row.status === 'ready' && row.crs != null

/**
 * The server's clouds at `level` (1 the 2-cm voxel, 0 the original) and this
 * device's. A server that cannot be reached leaves the local ones.
 */
export async function readableClouds(projectId, { level = 1 } = {}) {
  const [local, rows] = await Promise.all([
    listClouds(projectId).catch(() => []),
    api.clouds(projectId).then(r => r.clouds).catch(() => []),
  ])
  const remote = await Promise.all(rows.filter(readableOnServer).map(r => serverLevel(projectId, r, level).catch(() => null)))
  return [...remote.filter(Boolean), ...local]
}
