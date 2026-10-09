import { listClouds } from './cloudStore'
import { extensionsOf } from '../../extensions'

/**
 * The clouds of a project as the cross section, the clearance check and the
 * rail trace read them (AP 13.6): those the providers of the extension point
 * `cloudProviders` list (Paket L: the server's in the main build) and those
 * read in on this device (Entscheidung 204). A provider is
 *   { id, list(projectId, { level }) → clouds, sourceKey(cloud), reader(projectId, cloud) }
 * (see cloudSource). A provider that cannot be reached leaves the local ones.
 */
export async function readableClouds(projectId, { level = 1 } = {}) {
  const [local, ...remote] = await Promise.all([
    listClouds(projectId).catch(() => []),
    ...extensionsOf('cloudProviders').map(p => p.list(projectId, { level }).catch(() => [])),
  ])
  return [...remote.flat(), ...local]
}
