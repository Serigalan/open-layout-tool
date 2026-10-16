import { useProject } from '../../../hooks/useStore'
import { useI18n } from '../../../locales/i18nContext'
import ProjectInfoSection from './ProjectInfoSection'
import ProjectDefaultsSection from './ProjectDefaultsSection'
import TrackSettingsList from './TrackSettingsList'

/**
 * The project settings (Paket PE, decision 317): everything said about the
 * project as a whole — its title and description, its line category and
 * coordinate system — and, track by track, where one keeps its own. The app's
 * own settings (language, colour) stay in the settings panel.
 */
export default function ProjectSettingsPanel() {
  const { t } = useI18n()
  const project = useProject()
  return (
    <>
      <h2>{t('project_settings')}</h2>
      {!project ? <span className="project-settings-hint">{t('project_settings_none')}</span> : (
        <>
          <ProjectInfoSection key={`${project.title ?? ''}\n${project.description ?? ''}`} project={project} />
          <ProjectDefaultsSection project={project} />
          <TrackSettingsList project={project} />
        </>
      )}
    </>
  )
}
