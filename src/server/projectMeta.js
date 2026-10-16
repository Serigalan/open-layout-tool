import { api } from './api/client'
import { currentStoredMeta } from '../core/storage'
import { errorText } from './collab/errorText'

/**
 * The title and description of the open project on the server (decision 317):
 * the project settings write them into the record, and here into the server's
 * project list, which the start page and the working copy's bar show. The
 * server answers first — where it refuses (a template, for anyone but an
 * admin), the error comes back in words and the record is not touched.
 */

const listeners = new Set()

/** `saveProjectMeta` for core: patch the open working copy's project. */
export async function saveProjectMeta({ title, description }, { t }) {
  const projectId = currentStoredMeta()?.projectId
  if (!projectId) return
  try {
    const { project } = await api.patchProject(projectId, { title, description })
    for (const listener of listeners) listener(project)
  } catch (err) {
    throw new Error(errorText(t, err.code))
  }
}

/** Be told the server's summary of a project whose title or description was saved. Returns the unsubscribe. */
export function onProjectMeta(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
