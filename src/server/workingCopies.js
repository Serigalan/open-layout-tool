import * as idb from './workingCopyDb'
import {
  closeStoredProject, currentStoredMeta, currentStoredProject, openStoredProject, replaceStoredProject, setStoredMeta,
} from '../core/storage'

/**
 * The working copy of a variant (phase 10) on top of the project store of
 * core (Paket L): the open project kept in IndexedDB under its variant, with
 * the revision it rests on and that revision's record beside it —
 * { variantId, projectId, base, basePayload } as the store's meta. Where
 * IndexedDB is unavailable the copy lives in memory only.
 */

let _db = null   // null until initWorkingCopies, then whether IndexedDB opened

/** Open the working copies' database — await this once before rendering the app. */
export async function initWorkingCopies() {
  if (_db !== null) return
  try {
    await idb.openDb()
    _db = true
  } catch (err) {
    console.error('IndexedDB unavailable – the working copy is kept in memory only', err)
    _db = false
  }
}

const saveWorkingCopy = (record) => idb.putWorkingCopy(record)

/**
 * Make a variant's working copy the open project: `project` its record
 * (dehydrated), `base` the revision it rests on and `basePayload` that
 * revision's record, `idLog` the splits and joins since. Undo starts empty.
 */
export function openWorkingCopy({ variantId, project, base, basePayload, idLog = [] }) {
  return openStoredProject({
    project, idLog, key: variantId,
    meta: { variantId, projectId: project.id, base, basePayload },
    save: _db ? saveWorkingCopy : null,
  })
}

/** The open working copy: { variantId, projectId, base, basePayload, project (dehydrated), idLog }, or null. */
export const currentWorkingCopy = () => (currentStoredMeta()?.variantId ? currentStoredProject() : null)

/** The variant whose working copy is open, or null — cheaper than currentWorkingCopy where only that is wanted. */
export const currentVariantId = () => currentStoredMeta()?.variantId ?? null

/**
 * Put a merged record in place of the working copy, resting on `base` now.
 * Undo is emptied: a step back must not take back the other side's changes.
 */
export function adoptWorkingCopy({ project, base, basePayload, idLog }) {
  const meta = currentStoredMeta()
  if (!meta?.variantId) return null
  return replaceStoredProject({ project, meta: { ...meta, base, basePayload }, idLog })
}

/** The working copy was checked in as `base`: it rests on it now, and its id log is spent. */
export function markCheckedIn({ base, basePayload }) {
  const meta = currentStoredMeta()
  if (!meta?.variantId) return
  setStoredMeta({ ...meta, base, basePayload }, { clearIdLog: true })
}

/** Close the open working copy (it stays in IndexedDB). */
export const closeWorkingCopy = () => closeStoredProject()

/** A variant's stored working copy, or null. */
export async function loadWorkingCopy(variantId) {
  if (!_db) return null
  try { return await idb.getWorkingCopy(variantId) } catch { return null }
}

/** Every stored working copy (for the start page's status). */
export async function listWorkingCopies() {
  if (!_db) return []
  try { return await idb.getAllWorkingCopies() } catch { return [] }
}

/** Throw a variant's working copy away. */
export async function discardWorkingCopy(variantId) {
  if (currentVariantId() === variantId) await closeWorkingCopy()
  if (_db) await idb.deleteWorkingCopy(variantId)
}
