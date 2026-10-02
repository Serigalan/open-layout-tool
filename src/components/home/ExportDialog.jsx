import { useState } from 'react'
import { api, blobUrl } from '../../api/client'
import { SCHEMA_VERSION } from '../../utils/persistenceUtils'
import { downloadJSON } from '../../utils/fileUtils'
import { useI18n } from '../../locales/i18nContext'
import FormDialog from './FormDialog'
import useAction from './useAction'

async function imageAsDataUrl(hash) {
  const res = await fetch(blobUrl(hash), { credentials: 'same-origin' })
  if (!res.ok) return null
  const blob = await res.blob()
  return await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

/** Export the head of one variant as a self-contained backup file, its picture embedded. */
export default function ExportDialog({ project, onCancel, onDone }) {
  const { t } = useI18n()
  const variants = project.variants.filter(v => !v.archived)
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '')
  const { busy, error, run } = useAction(t)
  const submit = () => run(async () => {
    const { payload, variant } = await api.head(variantId)
    const { imageHash, ...record } = payload
    const image = imageHash ? await imageAsDataUrl(imageHash) : null
    const exported = { ...record, title: project.title, ...(image ? { image } : {}) }
    downloadJSON({ version: SCHEMA_VERSION, projects: [exported] }, `${project.title} – ${variant.name}.json`)
    onDone()
  })
  return (
    <FormDialog title={t('home_export_title')} submitLabel={t('start_export')} busy={busy} error={error} onCancel={onCancel} onSubmit={submit}>
      <label className="collab-field">
        <span>{t('home_variant')}</span>
        <select value={variantId} onChange={e => setVariantId(e.target.value)}>
          {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
    </FormDialog>
  )
}
