import { useI18n } from '../locales/i18nContext'
export default function ConfirmModal({ message, onConfirm, onCancel, confirmLabel, cancelLabel }) {
  const { t } = useI18n()
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button className="modal-btn modal-btn-cancel" onClick={onCancel}>
            {cancelLabel ?? t('btn_cancel')}
          </button>
          <button className="modal-btn modal-btn-confirm" onClick={onConfirm}>
            {confirmLabel ?? t('modal_delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
