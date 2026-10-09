import { useState } from 'react'
import { PROJECT_IMAGES, PROJECT_IMAGE_MIME, projectImagePicture } from '../utils/projectImages'
import ProjectImagePicker from '../components/collab/ProjectImagePicker'
import FormDialog from '../components/home/FormDialog'
import { useI18n } from '../locales/i18nContext'

/** The picture chosen, as the data URL a local project keeps (`image`), or null. */
async function pictureDataUrl(picture) {
  if (picture.kind === 'file') return picture.dataUrl
  const preset = picture.kind === 'preset' ? PROJECT_IMAGES.find(i => i.key === picture.key) : null
  if (!preset) return null
  const { data } = await projectImagePicture(preset)
  return `data:${PROJECT_IMAGE_MIME};base64,${data}`
}

/**
 * A project of the local build, new or to edit (Paket L): its title,
 * description and picture. `project` the summary to edit, or none for a new
 * one; `onSubmit({ title, description, image })` stores it — `image` left out
 * where the picture stays as it was.
 */
export default function LocalProjectDialog({ project = null, onCancel, onSubmit }) {
  const { t } = useI18n()
  const [title, setTitle] = useState(project?.title ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  // An edited project keeps its picture until another is chosen.
  const [picture, setPicture] = useState(project?.image ? { kind: 'file', dataUrl: project.image } : { kind: 'none' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    if (!title.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ title: title.trim(), description: description.trim(), image: await pictureDataUrl(picture) })
    } catch (err) {
      setError(err.message ?? t('collab_err_generic'))
      setBusy(false)
    }
  }
  return (
    <FormDialog title={t(project ? 'local_edit_title' : 'home_new_title')} submitLabel={t(project ? 'btn_save' : 'start_create_btn')}
      busy={busy} canSubmit={Boolean(title.trim())} error={error} onCancel={onCancel} onSubmit={submit}>
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
