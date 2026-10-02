import { useState } from 'react'
import { api, splitDataUrl } from '../../api/client'
import { PROJECT_IMAGES, projectImagePicture } from '../../utils/projectImages'
import ProjectImagePicker from '../collab/ProjectImagePicker'
import { useI18n } from '../../locales/i18nContext'
import FormDialog from './FormDialog'
import useAction from './useAction'

export default function NewProjectDialog({ onCancel, onCreated, template = false }) {
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [picture, setPicture] = useState({ kind: 'none' })
  const { busy, error, run } = useAction(t)
  const submit = () => run(async () => {
    if (!title.trim()) return
    let payload
    const preset = picture.kind === 'preset' ? PROJECT_IMAGES.find(i => i.key === picture.key) : null
    const image = preset ? await projectImagePicture(preset)
      : picture.kind === 'file' ? splitDataUrl(picture.dataUrl) : null
    if (image) {
      const { hash } = await api.uploadImage(image.mime, image.data)
      payload = { tracks: [], switches: [], platforms: [], imageHash: hash }
    }
    await api.createProject({ title: title.trim(), description: description.trim(), template, ...(payload ? { payload } : {}) })
    await onCreated()
  })
  return (
    <FormDialog title={t(template ? 'home_new_template_title' : 'home_new_title')} submitLabel={t('start_create_btn')} busy={busy} canSubmit={Boolean(title.trim())} error={error}
      onCancel={onCancel} onSubmit={submit}>
      <label className="collab-field">
        <span>{t('start_field_title')} *</span>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('start_field_title_placeholder')} autoFocus required />
      </label>
      <label className="collab-field">
        <span>{t('start_field_description')}</span>
        <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder={t('start_field_description_placeholder')} />
      </label>
      <ProjectImagePicker value={picture} onChange={setPicture} disabled={busy} />
    </FormDialog>
  )
}
