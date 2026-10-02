import { useState } from 'react'
import { api } from '../../api/client'
import { useI18n } from '../../locales/i18nContext'
import FormDialog from './FormDialog'
import useAction from './useAction'

/** Rename a variant, or archive it (and take it back). */
export default function VariantDialog({ variant, onCancel, onDone }) {
  const { t } = useI18n()
  const [name, setName] = useState(variant.name)
  const [archived, setArchived] = useState(variant.archived)
  const { busy, error, run } = useAction(t)
  return (
    <FormDialog title={t('home_variant_menu')} submitLabel={t('btn_save')} busy={busy} canSubmit={Boolean(name.trim())} error={error} onCancel={onCancel}
      onSubmit={() => run(async () => { await api.patchVariant(variant.id, { name: name.trim(), archived }); await onDone() })}>
      <label className="collab-field">
        <span>{t('home_variant_name')}</span>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus required />
      </label>
      <label className="collab-check">
        <input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />
        {t('home_variant_archived')}
      </label>
    </FormDialog>
  )
}
