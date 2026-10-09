import { api } from '../api/client'
import { listWorkingCopies } from '../workingCopies'
import { localChanges } from '../workingCopySync'

/** Variants in tree order, each with its depth under the variant it was branched off. */
export function variantTree(variants) {
  const children = new Map()
  for (const v of variants) {
    const key = v.parentVariantId ?? null
    if (!children.has(key)) children.set(key, [])
    children.get(key).push(v)
  }
  const ids = new Set(variants.map(v => v.id))
  const out = []
  const walk = (parent, depth) => {
    for (const v of children.get(parent) ?? []) {
      out.push({ variant: v, depth })
      walk(v.id, depth + 1)
    }
  }
  walk(null, 0)
  // A variant whose parent is not listed (archived away) starts a tree of its own.
  for (const v of variants) if (v.parentVariantId && !ids.has(v.parentVariantId)) { out.push({ variant: v, depth: 0 }); walk(v.id, 1) }
  return out
}


/**
 * What the start page shows: the server's projects, and per variant the
 * number of local changes its working copy in this browser has.
 */
export async function loadHome() {
  const [{ projects }, copies] = await Promise.all([api.projects(), listWorkingCopies()])
  return { projects, local: new Map(copies.map(wc => [wc.variantId, localChanges(wc).length])) }
}
