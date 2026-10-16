import { useProject } from '../../../hooks/useStore'
import { useI18n } from '../../../locales/i18nContext'
import { ownLineCategory, systemDeviates } from '../../../utils/projectSettings'
import FormSection from '../../form/FormSection'
import ProjectInfoSection from './ProjectInfoSection'
import ProjectDefaultsSection from './ProjectDefaultsSection'

/**
 * The project settings (Paket PE, decision 317): everything said about the
 * project as a whole — its title and description, its line category and
 * coordinate system — and, track by track, where one keeps its own. The tracks
 * are listed over the map (ProjectTracksOverlay, decision 324), which comes up
 * with the panel; here they are counted, with the button that shows the list
 * again. The app's own settings (language, colour) stay in the settings panel.
 */
export default function ProjectSettingsPanel({ tracksOpen, onShowTracks }) {
  const { t, fill } = useI18n()
  const project = useProject()
  if (!project) {
    return (
      <>
        <h2>{t('project_settings')}</h2>
        <span className="project-settings-hint">{t('project_settings_none')}</span>
      </>
    )
  }
  const tracks = project.tracks ?? []
  return (
    <>
      <h2>{t('project_settings')}</h2>
      <ProjectInfoSection key={`${project.title ?? ''}\n${project.description ?? ''}`} project={project} />
      <ProjectDefaultsSection project={project} />
      <FormSection title={fill('project_settings_tracks', { n: tracks.length })}>
        <span className="project-settings-hint">
          {fill('project_settings_tracks_own', {
            crs: tracks.filter(tr => systemDeviates(tr, project)).length,
            category: tracks.filter(tr => ownLineCategory(tr) != null).length,
          })}
        </span>
        <button type="button" className="panel-btn panel-btn-full"
          onClick={() => onShowTracks?.(!tracksOpen)}>
          {t(tracksOpen ? 'project_settings_tracks_hide' : 'project_settings_tracks_show')}
        </button>
      </FormSection>
    </>
  )
}
