import { useState } from 'react'
import { COMPARE_COLORS } from '../../core/utils/compareLayer'
import { entryText, findingText } from '../../core/components/collab/mergeText'
import '../../core/components/collab/collab.css'
import { useI18n } from '../../core/locales/i18nContext'
import Modal from '../../core/components/Modal'

/**
 * Checking in (AP 10.6): a comment and the list of one's own changes against
 * the base. `errors` are what the server refused the record for (422), listed
 * where the change list is so the user sees what to mend.
 */
export default function CheckInDialog({ changes, errors = [], busy, onSubmit, onCancel }) {
  const { t, fill } = useI18n()
  const [message, setMessage] = useState('')
  return (
    <Modal className="collab-modal" title={t('checkin_title')} onClose={onCancel} busy={busy} onSubmit={() => { onSubmit(message.trim()) }}
      actions={<>
        <button type="button" className="modal-btn modal-btn-cancel" onClick={onCancel} disabled={busy}>{t('btn_cancel')}</button>
        <button type="submit" className="modal-btn collab-btn-primary" disabled={busy || !changes.length}>{t('checkin_submit')}</button>
      </>}>
      <label className="collab-field">
        <span>{t('checkin_message')}</span>
        <textarea rows={3} value={message} onChange={e => setMessage(e.target.value)} placeholder={t('checkin_message_placeholder')} autoFocus />
      </label>
      <div className="collab-modal-list">
        <span className="collab-label">{fill('checkin_changes', { n: changes.length })}</span>
        <ul className="collab-list collab-list-plain">
          {changes.map(e => (
            <li key={`${e.collection}|${e.id}|${e.kind}`}>
              <span className="collab-badge" style={{ '--badge': COMPARE_COLORS[e.kind] }}>{t(`compare_${e.kind}`)}</span>
              <span className="collab-row-text">{entryText(t, e)}</span>
            </li>
          ))}
        </ul>
      </div>
      {errors.length > 0 && (
        <div className="collab-error-box" role="alert">
          <strong>{t('checkin_refused')}</strong>
          <ul>{errors.map(f => <li key={f.key}>{`${f.label ?? ''}: ${findingText(t, f)}`}</li>)}</ul>
        </div>
      )}
    </Modal>
  )
}
