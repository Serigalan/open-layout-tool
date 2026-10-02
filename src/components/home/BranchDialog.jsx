import { useState } from 'react'
import { api } from '../../api/client'
import { useI18n } from '../../locales/i18nContext'
import FormDialog from './FormDialog'
import useAction from './useAction'

/** Branch a new variant off one of the project's variants, at its head. */
export default function BranchDialog({ project, onCancel, onDone }) {
  const { t } = useI18n()
  const variants = project.variants.filter(v => !v.archived)
  const [name, setName] = useState('')
  const [from, setFrom] = useState(variants[0]?.id ?? '')
  const { busy, error, run } = useAction(t)
  return (
    <FormDialog title={t('home_branch_title')} submitLabel={t('home_branch_submit')} busy={busy} canSubmit={Boolean(name.trim())} error={error} onCancel={onCancel}
      onSubmit={() => run(async () => { await api.branch(project.id, { name: name.trim(), fromVariant: from }); await onDone() })}>
      <label className="collab-field">
        <span>{t('home_branch_name')} *</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="2030" autoFocus required />
      </label>
      <label className="collab-field">
        <span>{t('home_branch_from')}</span>
        <select value={from} onChange={e => setFrom(e.target.value)}>
          {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
    </FormDialog>
  )
}
