import { formatDate } from '../core/locales/i18n'
import { storedBytes } from '../core/localStore'
import * as idb from './workingCopyDb'
import { discardWorkingCopy } from './workingCopies'
import { localChanges } from './workingCopySync'

/**
 * What the main build keeps in IndexedDB, as sections of the local storage
 * dialog (core/localStore.js, extension point `localStoreSections`): the
 * working copies, one per variant opened here, with the changes not checked
 * in yet — and, among the other things, what the stores of version 1 still
 * hold (workingCopyDb.js).
 */

async function readWorkingCopies() {
  const copies = await idb.getAllWorkingCopies()
  return copies.map(wc => {
    let changes = null
    try { changes = localChanges(wc).length } catch { /* a record this version cannot read */ }
    return { variantId: wc.variantId, projectId: wc.projectId, updatedAt: wc.updatedAt ?? null, changes, bytes: storedBytes(wc) }
  }).sort((a, b) => b.bytes - a.bytes)
}

export const workingCopiesSection = {
  id: 'workingCopies',
  read: readWorkingCopies,
  async deleteAll() {
    for (const wc of await idb.getAllWorkingCopies()) await discardWorkingCopy(wc.variantId)
  },
  unsaved: (items) => items.filter(wc => wc.changes).length,
  rows(items, { t, fill, language, row, variantText }) {
    const changesText = (n) => (n == null ? t('local_store_wc_unknown') : n ? fill('home_local_changes', { n }) : t('local_store_wc_clean'))
    return {
      title: t('local_store_working_copies'),
      hint: t('local_store_working_copies_hint'),
      rows: items.map(wc => row({
        key: `wc/${wc.variantId}`,
        title: variantText(wc.variantId, wc.projectId),
        meta: [formatDate(wc.updatedAt, language, { time: true }), wc.changes ? null : changesText(wc.changes)],
        warn: wc.changes ? changesText(wc.changes) : null,
        bytes: wc.bytes, estimated: true,
        ask: wc.changes ? fill('local_store_delete_wc_ask', { n: wc.changes }) : null,
        onDelete: () => discardWorkingCopy(wc.variantId),
      })),
    }
  },
}

export const legacySection = {
  id: 'legacy',
  read: async () => {
    const legacy = await idb.legacyContents()
    return legacy.records ? [legacy] : []
  },
  deleteAll: () => idb.clearLegacyStores(),
  rows: (items, { t, fill, row }) => ({
    into: 'other',
    rows: items.map(legacy => row({
      key: 'legacy',
      title: t('local_store_legacy'),
      meta: [fill('local_store_legacy_line', { n: legacy.records })],
      bytes: legacy.bytes, estimated: true,
      onDelete: () => idb.clearLegacyStores(),
    })),
  }),
}
