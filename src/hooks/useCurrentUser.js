import { useSyncExternalStore } from 'react'

// Who is signed in, for the parts of the app below the shell that need to
// know what they may offer — the point cloud panel above all (decision 203).
// useSession keeps it; nothing else writes it.

let current = null
const listeners = new Set()

export function setCurrentUser(user) {
  if (user === current) return
  current = user
  for (const fn of listeners) fn()
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const read = () => current

/** The signed-in user as /api/me states them, or null. */
const useCurrentUser = () => useSyncExternalStore(subscribe, read, read)

/**
 * Whether `user` may change point clouds — upload, read in locally, delete,
 * re-reference, start server jobs, save or delete measured axes: an admin, or
 * a user with the right (decision 203). The server checks it again.
 */
const mayEditClouds = (user) => Boolean(user && (user.role === 'admin' || user.canEditClouds))

/** The same, for the signed-in user. */
export const useMayEditClouds = () => mayEditClouds(useCurrentUser())
