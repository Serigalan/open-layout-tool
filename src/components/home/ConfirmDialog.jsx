import { useI18n } from '../../locales/i18nContext'
import FormDialog from './FormDialog'
import useAction from './useAction'

export default function ConfirmDialog({ message, confirmLabel, onConfirm, onCancel, danger }) {
  const { t } = useI18n()
  const { busy, error, run } = useAction(t)
  return (
    <FormDialog title={message} submitLabel={confirmLabel} busy={busy} error={error} danger={danger}
      onCancel={onCancel} onSubmit={() => run(onConfirm)} />
  )
}
