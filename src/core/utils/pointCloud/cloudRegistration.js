import { provided } from '../../extensions'

/**
 * A re-referencing the 3D window runs (AP 13.14), as the cross section and
 * the point cloud panel see it — the 3D window is the server's (decision
 * 280), so the hook is too (`useCloudRegistration`, provided by
 * server/cloud3d/useCloudRegistration.js, Paket L):
 *
 *   useCloudRegistration(projectId, level?) → {
 *     session        the reference cloud, the cloud to fit, the plane and the
 *                    transformation being fitted, or null
 *     cloudsVersion  counts the re-referencings kept or put back — read the clouds anew
 *     sendPair(pair) a pair picked in the section, into the 3D window's list
 *     key, clouds    with `level`: the two clouds of the session at that level,
 *                    each in its colour, and what they were read for
 *   }
 *
 * Without the server: never a session.
 */
const NO_REGISTRATION = Object.freeze({ session: null, cloudsVersion: 0, sendPair: () => {}, key: null, clouds: [] })
const useNoRegistration = () => NO_REGISTRATION

export const registrationHook = () => provided('useCloudRegistration', useNoRegistration)
