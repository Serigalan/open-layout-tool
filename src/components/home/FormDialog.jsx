import { useI18n } from '../../locales/i18nContext'
import Modal from '../Modal'

/** A small modal form: title, the fields, cancel and submit, an error line. */
export default function FormDialog({ title, submitLabel, busy, error, onCancel, onSubmit, children, danger = false, canSubmit = true }) {
  const { t } = useI18n()
  return (
    <Modal className="collab-modal" title={title} onClose={onCancel} busy={busy} onSubmit={() => { onSubmit() }}
      actions={<>
        <button type="button" className="modal-btn modal-btn-cancel" onClick={onCancel} disabled={busy}>{t('btn_cancel')}</button>
        <button type="submit" className={`modal-btn ${danger ? 'modal-btn-confirm' : 'collab-btn-primary'}`} disabled={busy || !canSubmit}>{submitLabel}</button>
      </>}>
      {children}
      {error && <p className="collab-error" role="alert">{error}</p>}
    </Modal>
  )
}
