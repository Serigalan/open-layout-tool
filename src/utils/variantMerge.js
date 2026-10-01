import { ApiError, api } from '../api/client'
import { discardWorkingCopy, loadWorkingCopy } from '../storage'
import { mergeProject } from './merge'
import { localChanges } from './workingCopySync'

/**
 * Comparing and merging variants (AP 10.8).
 *
 * A merge takes the changes of a source variant ("Bestand") into a target
 * ("2030"): the common base is the youngest revision both have in their
 * history, so after one merge the next starts from there and brings only
 * what is new. The browser merges, the user decides the conflicts, and the
 * result is checked into the target with the source's head as its second
 * parent.
 */

/** The heads of two variants, for the comparison view: { before, after } with their records. */
export async function loadComparison(beforeVariantId, afterVariantId) {
  const [before, after] = await Promise.all([api.head(beforeVariantId), api.head(afterVariantId)])
  return { before, after }
}

/** Whether a variant has a working copy in this browser with changes not checked in. */
export async function hasLocalChanges(variantId) {
  const wc = await loadWorkingCopy(variantId)
  return Boolean(wc?.basePayload && wc.project && localChanges(wc).length)
}

/**
 * Merge `source` into `target`. Resolves { upToDate: true } when the target
 * already has everything the source has, else { source, target, base, result }
 * — the heads as GET …/head returns them, the common base's meta and the
 * mergeProject result. Refuses (ApiError 'local_changes') while the target has
 * changes not checked in in this browser: those have to go in first.
 */
export async function prepareVariantMerge(sourceVariantId, targetVariantId) {
  if (await hasLocalChanges(targetVariantId)) throw new ApiError(409, 'local_changes')
  const [source, target] = await Promise.all([api.head(sourceVariantId), api.head(targetVariantId)])
  const { base } = await api.commonBase(source.revision.id, target.revision.id)
  if (!base) throw new ApiError(422, 'no_common_base')
  if (base.id === source.revision.id) return { upToDate: true, source, target }
  const basePayload = base.id === target.revision.id ? target.payload : (await api.revision(base.id)).payload
  const [mine, theirs] = await Promise.all([api.remaps(target.revision.id, base.id), api.remaps(source.revision.id, base.id)])
  const result = mergeProject({
    base: basePayload, mine: target.payload, theirs: source.payload,
    remapsMine: mine.remaps, remapsTheirs: theirs.remaps,
  })
  return { source, target, base, result }
}

/**
 * Check the decided record into the target, the source's head as second
 * parent. Its splits and joins need no log of their own: they are the
 * source's, which the server finds through that parent. Resolves
 * { revision } or { stale: head } when the target moved on meanwhile.
 *
 * A working copy of the target in this browser without changes rests on the
 * old head; it is dropped, and the next opening starts from the merge.
 */
export async function commitVariantMerge(prepared, record, message) {
  const res = await api.checkIn(prepared.target.variant.id, {
    base: prepared.target.revision.id, mergeParent: prepared.source.revision.id,
    message, payload: record, remaps: [],
  })
  if (!res.stale && !(await hasLocalChanges(prepared.target.variant.id))) {
    await discardWorkingCopy(prepared.target.variant.id).catch(() => {})
  }
  return res
}
