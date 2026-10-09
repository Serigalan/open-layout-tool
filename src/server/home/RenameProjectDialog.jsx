import { useState } from 'react'
import { api } from '../api/client'
import { useI18n } from '../../core/locales/i18nContext'
import FormDialog from '../../core/components/home/FormDialog'
import useAction from './useAction'

export default function RenameProjectDialog({ project, onCancel, onDone }) {
  const { t } = useI18n()
  const [title, setTitle] = useState(project.title)
  const [description, setDescription] = useState(project.description ?? '')
  const { busy, error, run } = useAction(t)
  return (
    <FormDialog title={t('home_rename')} submitLabel={t('btn_save')} busy={busy} canSubmit={Boolean(title.trim())} error={error} onCancel={onCancel}
      onSubmit={() => run(async () => { await api.patchProject(project.id, { title: title.trim(), description: description.trim() }); await onDone() })}>
      <label className="collab-field">
        <span>{t('start_field_title')} *</span>
        <input value={title} onChange={e => setTitle(e.target.value)} autoFocus required />
      </label>
      <label className="collab-field">
        <span>{t('start_field_description')}</span>
        <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} />
      </label>
    </FormDialog>
  )
}
