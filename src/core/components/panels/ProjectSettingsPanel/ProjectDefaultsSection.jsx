import { updateProject } from '../../../storage'
import { LINE_CATEGORIES } from '../../../utils/identifierUtils'
import { projectLineCategory } from '../../../utils/gradientCheck'
import { crsChoices, projectEpsg, projectEpsgSetting } from '../../../utils/projectSettings'
import { crsLabel } from '../../../utils/coordinateUtils'
import { useI18n } from '../../../locales/i18nContext'
import FormSection from '../../form/FormSection'

/**
 * What the project gives every track that does not name its own: the line
 * category the Höhenplan rules judge it by (decision 320), and the coordinate
 * system a new track is laid out in (decision 318) — which leaves the tracks
 * there are where they are.
 *
 * Without a system of its own the project takes the one most of its tracks lie
 * in, and says so; the empty choice goes back to that.
 */
export default function ProjectDefaultsSection({ project }) {
  const { t, fill } = useI18n()
  const setting = projectEpsgSetting(project)
  const effective = projectEpsg(project)
  const choices = crsChoices(...(project.tracks ?? []).map(tr => tr.epsg), effective)
  const fallback = effective != null
    ? fill('project_settings_crs_from_tracks', { crs: crsLabel(effective) })
    : t('project_settings_crs_by_click')

  return (
    <FormSection title={t('project_settings_defaults')}>
      <div className="form-field">
        <label htmlFor="project-line-category">{t('line_category')}</label>
        <select id="project-line-category" value={projectLineCategory(project)}
          onChange={e => updateProject({ lineCategory: e.target.value })}>
          {LINE_CATEGORIES.map(key => <option key={key} value={key}>{t(`line_category_${key}`)}</option>)}
        </select>
        <span className="project-settings-hint">{t('project_settings_line_category_hint')}</span>
      </div>
      <div className="form-field">
        <label htmlFor="project-crs">{t('project_settings_crs')}</label>
        <select id="project-crs" value={setting ?? ''}
          onChange={e => updateProject({ epsg: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">{fallback}</option>
          {choices.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
        <span className="project-settings-hint">{t('project_settings_crs_hint')}</span>
      </div>
    </FormSection>
  )
}
