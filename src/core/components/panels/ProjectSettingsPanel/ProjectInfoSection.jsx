import { useState } from 'react'
import { updateProject } from '../../../storage'
import { provided } from '../../../extensions'
import { useI18n } from '../../../locales/i18nContext'
import FormSection from '../../form/FormSection'

/**
 * The project's title and description (decision 317). They live in the record
 * (`project.title`, `project.description`) — the plans and the exported files
 * are named by them, and the local build lists its projects by them. The
 * server build keeps them in its project list as well, and writes them there
 * first (`saveProjectMeta`): where the server refuses, the record stays as it was.
 *
 * The fields start from the record; the panel mounts this anew whenever the
 * record's title or description changes (a save, an undo), so they never show
 * an older state than the record's.
 */
export default function ProjectInfoSection({ project }) {
  const { t } = useI18n()
  const [title, setTitle] = useState(project.title ?? '')
  const [description, setDescription] = useState(project.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const dirty = title.trim() !== (project.title ?? '') || description.trim() !== (project.description ?? '')
  const save = async () => {
    const meta = { title: title.trim(), description: description.trim() }
    if (!meta.title) return
    setBusy(true)
    setError(null)
    try {
      await provided('saveProjectMeta', null)?.(meta, { t })
      updateProject(meta)
    } catch (err) {
      setError(err.message ?? t('collab_err_generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSection title={t('project_settings_info')}>
      <div className="form-field">
        <label htmlFor="project-title">{t('start_field_title')} *</label>
        <input id="project-title" type="text" value={title} required
          onChange={e => setTitle(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="project-description">{t('start_field_description')}</label>
        <textarea id="project-description" className="project-settings-description" rows={3} value={description}
          onChange={e => setDescription(e.target.value)} />
      </div>
      {error && <p className="form-error">{error}</p>}
      <button type="button" className="panel-btn panel-btn-full" onClick={save}
        disabled={busy || !dirty || !title.trim()}>
        {t('btn_save')}
      </button>
    </FormSection>
  )
}
