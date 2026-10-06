import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { discardWorkingCopy, loadWorkingCopy } from '../../storage'
import { hasLocalChanges } from '../../utils/variantMerge'
import { localChanges } from '../../utils/workingCopySync'
import './collab.css'
import { useI18n } from '../../locales/i18nContext'
import { formatDate } from '../../locales/i18n'
import Modal from '../Modal'
import ConfirmModal from '../ConfirmModal'


/**
 * The history of a variant (AP 10.10): its revisions from the head back, each
 * with author, time and comment; a merge says from which variant it came, and
 * the revisions from before the variant was branched off say whose they are.
 *
 * An older revision can be looked at (read-only), compared with the head, and
 * restored — as a new revision with that state on top of the head, never by
 * moving the head back: what came after stays in the history.
 *
 * Changes not checked in that this browser holds for the variant are named
 * above the list and can be thrown away: the next opening then starts from
 * the server's head.
 */
export default function HistoryPage({ project, variant, onBack, onView, onCompareWithHead }) {
  const { t, language, fill } = useI18n()
  const [revisions, setRevisions] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [confirm, setConfirm] = useState(null)   // the revision to restore
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState(0)          // changes not checked in, in this browser
  const [askDiscard, setAskDiscard] = useState(false)

  const countLocal = useCallback(async () => {
    const wc = await loadWorkingCopy(variant.id)
    return wc?.basePayload && wc.project ? localChanges(wc).length : 0
  }, [variant.id])
  useEffect(() => {
    let alive = true
    countLocal().then(n => { if (alive) setLocal(n) }, () => {})
    return () => { alive = false }
  }, [countLocal])

  const discardLocal = async () => {
    setBusy(true)
    setError(null)
    try {
      await discardWorkingCopy(variant.id)
      setLocal(0)
      setNotice(t('wc_discarded'))
    } catch {
      setError('generic')
    } finally {
      setBusy(false)
      setAskDiscard(false)
    }
  }

  const load = useCallback(() => api.history(variant.id).then(r => r.revisions), [variant.id])
  useEffect(() => {
    let alive = true
    load().then(list => { if (alive) setRevisions(list) }, err => { if (alive) setError(err.code) })
    return () => { alive = false }
  }, [load])

  const names = new Map(project.variants.map(v => [v.id, v.name]))
  const head = revisions?.[0] ?? null

  const restore = async (rev) => {
    setBusy(true)
    setError(null)
    try {
      const [{ payload }, now] = await Promise.all([api.revision(rev.id), api.variant(variant.id)])
      const res = await api.checkIn(variant.id, {
        base: now.variant.head.id, payload, remaps: [],
        message: fill('history_restore_message', { n: rev.number }),
      })
      if (res.stale) throw Object.assign(new Error('stale'), { code: 'stale' })
      // A working copy without changes rests on the old head: the next opening
      // starts from the restored state. One with changes is merged on update.
      if (!(await hasLocalChanges(variant.id))) await discardWorkingCopy(variant.id).catch(() => {})
      setNotice(fill('history_restored', { n: rev.number, m: res.revision.number }))
      setRevisions(await load())
      setLocal(await countLocal())
    } catch (err) {
      setError(err.body?.errors?.length ? 'invalid_record' : (err.code ?? 'generic'))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  return (
    <div className="collab-page home">
      <header className="home-top">
        <div className="collab-brand">
          <h1>{t('history_title')}</h1>
          <span className="collab-muted history-where">{project.title} › {variant.name}</span>
        </div>
        <div className="home-user">
          <button type="button" className="collab-btn" onClick={onBack}>{t('viewer_back')}</button>
        </div>
      </header>
      <main className="home-main">
        {error && <p className="collab-error" role="alert">{t(`history_err_${error}`) === `history_err_${error}` ? t('collab_err_generic') : t(`history_err_${error}`)}</p>}
        {notice && <p className="collab-ok" role="status">{notice}</p>}
        {local > 0 && (
          <p className="history-local">
            <span>● {fill('home_local_changes', { n: local })}</span>
            <button type="button" className="collab-btn collab-btn-small" disabled={busy} onClick={() => setAskDiscard(true)}>{t('wc_discard')}</button>
          </p>
        )}
        {revisions === null && !error && <p className="collab-muted">{t('home_loading')}</p>}
        <ol className="history-list">
          {(revisions ?? []).map(rev => {
            const isHead = rev.id === head?.id
            const inherited = rev.variantId !== variant.id
            return (
              <li key={rev.id} className={`history-rev ${rev.mergeParentId ? 'merge' : ''} ${inherited ? 'inherited' : ''}`}>
                <div className="history-rev-head">
                  <span className="history-rev-number">rev {rev.number}</span>
                  <span className="collab-muted">{formatDate(rev.createdAt, language, { time: true })} · {rev.author.name}</span>
                  {isHead && <span className="admin-badge active">{t('history_head')}</span>}
                  {rev.mergeParentId && <span className="admin-badge pending">{t('history_merge')}</span>}
                  {inherited && <span className="admin-badge">{fill('history_inherited', { variant: names.get(rev.variantId) ?? '?' })}</span>}
                </div>
                <div className="history-rev-message">{rev.message || <span className="collab-muted">{t('history_no_message')}</span>}</div>
                <div className="history-rev-actions">
                  <button type="button" className="collab-btn collab-btn-small" onClick={() => onView(rev)}>{t('history_view')}</button>
                  {!isHead && <button type="button" className="collab-btn collab-btn-small" onClick={() => onCompareWithHead(rev, head)}>{t('history_compare')}</button>}
                  {!isHead && <button type="button" className="collab-btn collab-btn-small" disabled={busy} onClick={() => setConfirm(rev)}>{t('history_restore')}</button>}
                </div>
              </li>
            )
          })}
        </ol>
      </main>
      {confirm && (
        <Modal className="collab-modal" title={fill('history_restore_confirm', { n: confirm.number })} onClose={() => setConfirm(null)} busy={busy}
          actions={<>
            <button type="button" className="modal-btn modal-btn-cancel" disabled={busy} onClick={() => setConfirm(null)}>{t('btn_cancel')}</button>
            <button type="button" className="modal-btn collab-btn-primary" disabled={busy} onClick={() => restore(confirm)}>{t('history_restore')}</button>
          </>}>
          <p className="collab-muted">{t('history_restore_desc')}</p>
        </Modal>
      )}
      {askDiscard && (
        <ConfirmModal message={fill('wc_discard_ask', { n: local })} confirmLabel={t('wc_discard')}
          busy={busy} onConfirm={discardLocal} onCancel={() => setAskDiscard(false)} />
      )}
    </div>
  )
}
