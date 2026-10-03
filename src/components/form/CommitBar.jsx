import { useI18n } from '../../locales/i18nContext'
import useEscape from '../../shell/useEscape'

/**
 * Commit and Cancel at the foot of a dialog (R4.3). `disabled` locks Commit;
 * `reason` says why, on the button itself (its title) — a locked button that
 * does not say why is a dead end. Labels default to Commit/Cancel.
 */
export default function CommitBar({
  onCommit, onCancel, disabled = false, reason = null, commitLabel, cancelLabel, danger = false, className = 'mt-8',
}) {
  const { t } = useI18n()
  // Escape is Cancel (R10.2).
  useEscape(onCancel, !!onCancel)
  return (
    <div className={`commit-bar ${className}`.trim()}>
      <button type="button" className={`panel-btn panel-btn-full${danger ? ' danger' : ''}`}
        onClick={onCommit} disabled={disabled} title={disabled && reason ? reason : undefined}>
        {commitLabel ?? t('btn_commit')}
      </button>
      {onCancel && (
        <button type="button" className="panel-btn panel-btn-full secondary" onClick={onCancel}>
          {cancelLabel ?? t('btn_cancel')}
        </button>
      )}
    </div>
  )
}
