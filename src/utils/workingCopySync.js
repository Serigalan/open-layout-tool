import { api } from '../api/client'
import {
  adoptWorkingCopy, clearUndo, currentWorkingCopy, loadWorkingCopy, markCheckedIn, openWorkingCopy,
} from '../storage'
import { diffEntries, diffProject, mergeProject } from './merge'

/**
 * The working copy against the server (AP 10.6): opening a variant, the list
 * of one's own changes, checking in, and bringing in what others checked in.
 *
 * The server never merges (decision 97). Checking in on a stale base comes
 * back as `stale`; the caller then lets prepareUpdate merge the head into the
 * working copy, shows the result (conflict dialog), adopts it, and checks in
 * again — so nothing is stored that nobody has seen.
 */

/**
 * Open a variant: its stored working copy if there is one, else its head.
 * Returns the hydrated project.
 */
export async function openVariant(variantId) {
  const stored = await loadWorkingCopy(variantId)
  if (stored?.project && stored.base && stored.basePayload) return openWorkingCopy(stored)
  const { revision, payload } = await api.head(variantId)
  return openWorkingCopy({ variantId, project: payload, base: revision, basePayload: payload, idLog: [] })
}

/** What the working copy changed against its base, as diffEntries lists it. */
export function localChanges(wc = currentWorkingCopy()) {
  if (!wc) return []
  return diffEntries(diffProject(wc.basePayload, wc.project))
}

/** The variant's head as the server has it now (meta only). */
export async function serverHead(variantId) {
  return (await api.variant(variantId)).variant.head
}

/**
 * Merge the variant's head into the working copy, against their common base —
 * the revision the working copy rests on. Null when the working copy is on
 * the head already. Otherwise { head, headPayload, result } with the
 * mergeProject result for the conflict dialog.
 */
export async function prepareUpdate() {
  const wc = currentWorkingCopy()
  if (!wc) return null
  const head = await serverHead(wc.variantId)
  if (head.id === wc.base.id) return null
  const [{ payload: headPayload, revision }, { remaps }] = await Promise.all([
    api.revision(head.id), api.remaps(head.id, wc.base.id),
  ])
  const result = mergeProject({
    base: wc.basePayload, mine: wc.project, theirs: headPayload,
    remapsMine: wc.idLog, remapsTheirs: remaps,
  })
  return { head: revision, headPayload, result }
}

/**
 * Take the decided merge as the working copy, resting on the head now. The
 * own id log stays: those splits are still not on the server. Undo starts
 * afresh — a step back must not take back the other side's changes.
 */
export function adoptUpdate(prepared, record) {
  adoptWorkingCopy({ project: record, base: prepared.head, basePayload: prepared.headPayload })
  clearUndo()
}

/**
 * Throw the working copy's own changes away: it becomes the variant's head as
 * the server has it now, with an empty id log and an empty undo. Resolves the
 * head's revision (meta).
 */
export async function revertToHead() {
  const wc = currentWorkingCopy()
  if (!wc) return null
  const { revision, payload } = await api.head(wc.variantId)
  adoptWorkingCopy({ project: payload, base: revision, basePayload: payload, idLog: [] })
  return revision
}

/**
 * Check the working copy in. Resolves { revision, warnings }, or { stale: true }
 * when the head moved on. A record the server refuses (422) throws an
 * ApiError whose body names the errors.
 */
export async function checkIn(message, { mergeParent = null } = {}) {
  const wc = currentWorkingCopy()
  const res = await api.checkIn(wc.variantId, {
    base: wc.base.id, message, payload: wc.project, remaps: wc.idLog,
    ...(mergeParent != null ? { mergeParent } : {}),
  })
  if (res.stale) return { stale: true }
  markCheckedIn({ base: res.revision, basePayload: wc.project })
  return { revision: res.revision, warnings: res.warnings ?? [] }
}
