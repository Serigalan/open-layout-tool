import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../../locales/i18nContext'
import { formatDate } from '../../locales/i18n'
import {
  bytesText, readLocalStore, deleteLocalCloud, deleteLocalFile, deleteEntry, deleteAllLocal,
} from '../../localStore'
import { extensionsOf } from '../../extensions'
import Modal from '../Modal'

/**
 * What the app keeps in this browser (localStore.js), each piece with its size
 * and a delete, and a delete of all of it. A delete asks once, in its own row;
 * a working copy with changes not checked in says how many go with it. What
 * IndexedDB holds comes as the sections of whoever keeps it there
 * (`localStoreSections`). `projects` is the start page's list, to name
 * projects and variants by. `onClose(changed)` says whether anything was deleted.
 */
export default function LocalStorageDialog({ projects, onClose }) {
  const { t, fill, language } = useI18n()
  const [store, setStore] = useState(null)
  const [asking, setAsking] = useState(null)      // the key of the row a delete waits on, or 'all'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [changed, setChanged] = useState(false)

  const reload = useCallback(() => readLocalStore().then(setStore, err => setError(err.message)), [])
  useEffect(() => { reload() }, [reload])

  const projectTitle = (id) => projects?.find(p => p.id === id)?.title ?? t('local_store_unknown_project')
  const variantOf = (id) => {
    for (const p of projects ?? []) {
      const v = p.variants?.find(x => x.id === id)
      if (v) return { project: p.title, variant: v.name }
    }
    return null
  }
  const variantText = (id, projectId) => {
    const found = variantOf(id)
    return found ? `${found.project} · ${found.variant}` : projectTitle(projectId)
  }
  // An import report is kept per variant, or per project where none was open.
  const refText = (ref) => {
    const found = variantOf(ref)
    if (found) return `${found.project} · ${found.variant}`
    return projects?.find(p => p.id === ref)?.title ?? ref
  }
  const size = (bytes, estimated = false) => (estimated ? '≈ ' : '') + bytesText(bytes, language)

  const run = async (fn, doneText = null) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
      if (doneText) setNotice(doneText)
    } catch (err) {
      setError(fill('local_store_delete_failed', { error: err.message ?? String(err) }))
    }
    setChanged(true)
    setAsking(null)
    await reload()
    setBusy(false)
  }

  const row = ({ key, title, meta = [], warn = null, bytes, estimated, ask, onDelete }) => (
    <li key={key} className="local-store-row">
      <div className="local-store-what">
        <strong>{title}</strong>
        {meta.filter(Boolean).map((m, i) => <span key={i} className="collab-muted">{m}</span>)}
        {warn && <span className="local-store-warn">{warn}</span>}
      </div>
      <span className="local-store-size">{size(bytes, estimated)}</span>
      {asking === key ? (
        <span className="local-store-ask">
          <span>{ask ?? t('local_store_delete_ask')}</span>
          <button type="button" className="collab-btn collab-btn-small collab-btn-danger" disabled={busy} onClick={() => run(onDelete)}>{t('local_store_yes')}</button>
          <button type="button" className="collab-btn collab-btn-small" disabled={busy} onClick={() => setAsking(null)}>{t('btn_cancel')}</button>
        </span>
      ) : (
        <button type="button" className="collab-btn collab-btn-small" disabled={busy || asking === 'all'} onClick={() => setAsking(key)}>{t('modal_delete')}</button>
      )}
    </li>
  )

  const section = (title, rows, hint = null) => rows.length > 0 && (
    <section className="local-store-section">
      <h3 className="collab-label">{title}</h3>
      {hint && <p className="collab-hint">{hint}</p>}
      <ul className="local-store-list">{rows}</ul>
    </section>
  )

  const entryTitle = (e) => ({
    settings: t('local_store_settings'),
    reports: t('local_store_reports'),
    hidden: t('local_store_hidden'),
  })[e.kind] ?? e.key
  const entryMeta = (e) => (e.kind === 'reports' ? refText(e.ref) : e.kind === 'hidden' ? projectTitle(e.ref) : null)

  // The sections of the extension point, as the dialog shows them.
  const ctx = { t, fill, language, projects, row, size, variantText }
  const extra = store ? extensionsOf('localStoreSections').map(s => ({ ...s.rows(store.sections[s.id] ?? [], ctx), id: s.id })) : []
  const own = extra.filter(x => x.into !== 'other')
  const intoOther = extra.filter(x => x.into === 'other').flatMap(x => x.rows)
  const empty = store && !store.clouds.length && !store.other.length && !store.entries.length && !extra.some(x => x.rows.length)
  const unsaved = store ? extensionsOf('localStoreSections').reduce((n, s) => n + (s.unsaved?.(store.sections[s.id] ?? []) ?? 0), 0) : 0

  return (
    <Modal className="collab-modal local-store" title={t('local_store_title')} onClose={() => onClose(changed)} busy={busy}
      actions={<>
        {!empty && store && asking !== 'all' && (
          <button type="button" className="modal-btn modal-btn-confirm local-store-all" disabled={busy} onClick={() => setAsking('all')}>{t('local_store_delete_all')}</button>
        )}
        <button type="button" className="modal-btn collab-btn-primary" disabled={busy} onClick={() => onClose(changed)}>{t('btn_close')}</button>
      </>}>
      <p className="collab-muted">{t('local_store_intro')}</p>
      {store?.estimate && (
        <p className="collab-muted">
          {fill('local_store_usage', { used: bytesText(store.estimate.usage, language), quota: bytesText(store.estimate.quota, language) })}
          {' '}{t(store.persisted ? 'local_store_persisted' : 'local_store_not_persisted')}
        </p>
      )}
      {error && <p className="collab-error" role="alert">{error}</p>}
      {notice && <p className="collab-ok" role="status">{notice}</p>}
      {!store && !error && <p className="collab-muted">{t('home_loading')}</p>}
      {empty && <p className="collab-muted">{t('local_store_empty')}</p>}

      {asking === 'all' && (
        <div className="local-store-confirm-all" role="alert">
          <p>{t('local_store_delete_all_ask')}</p>
          {unsaved > 0 && <p className="local-store-warn">{fill('local_store_delete_all_unsaved', { n: unsaved })}</p>}
          <div className="collab-actions">
            <button type="button" className="collab-btn" disabled={busy} onClick={() => setAsking(null)}>{t('btn_cancel')}</button>
            <button type="button" className="collab-btn collab-btn-danger" disabled={busy}
              onClick={() => run(deleteAllLocal, t('local_store_deleted_all'))}>{t('local_store_delete_all')}</button>
          </div>
        </div>
      )}

      {store && <>
        {section(t('local_store_clouds'), store.clouds.map(c => row({
          key: `cloud/${c.projectId}/${c.cloudId}`,
          title: c.hasIndex ? (c.name ?? c.cloudId) : t('local_store_cloud_unfinished'),
          meta: [projectTitle(c.projectId), formatDate(c.createdAt ?? c.lastModified, language, { time: true })],
          bytes: c.bytes,
          onDelete: () => deleteLocalCloud(c),
        })), t('local_store_clouds_hint'))}

        {own.map(x => <div key={x.id}>{section(x.title, x.rows, x.hint ?? null)}</div>)}

        {section(t('local_store_entries'), store.entries.map(e => row({
          key: `entry/${e.key}`,
          title: entryTitle(e),
          meta: [entryMeta(e)],
          bytes: e.bytes, estimated: true,
          onDelete: () => deleteEntry(e.key),
        })))}

        {section(t('local_store_other'), [
          ...intoOther,
          ...store.other.map(f => row({
            key: `file/${f.path.join('/')}`,
            title: f.path.join('/'),
            meta: [formatDate(f.lastModified, language, { time: true })],
            bytes: f.bytes,
            onDelete: () => deleteLocalFile(f),
          })),
        ])}
      </>}
    </Modal>
  )
}
