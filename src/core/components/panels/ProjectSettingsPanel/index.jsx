import { useState } from 'react'
import { useProject } from '../../../hooks/useStore'
import { useI18n } from '../../../locales/i18nContext'
import { ownLineCategory, systemDeviates } from '../../../utils/projectSettings'
import { AssignTracksIcon, TrackVisibilityIcon } from '../../icons'
import FormSection from '../../form/FormSection'
import InfoTip from '../../form/InfoTip'
import BackButton from '../BackButton'
import ProjectInfoSection from './ProjectInfoSection'
import ProjectDefaultsSection from './ProjectDefaultsSection'
import AssignTracksForm from './AssignTracksForm'
import TrackVisibilityForm from './TrackVisibilityForm'

/**
 * The project settings (Paket PE, decision 317): everything said about the
 * project as a whole — its title and description, its line category and
 * coordinate system — and, track by track, where one keeps its own. The tracks
 * are listed over the map (ProjectTracksOverlay, decision 324), which comes up
 * with the panel; here they are counted, with the button that shows the list
 * again, and the two things done to the tracks as a whole (decision 327):
 * putting them on lines and into stations, and which of them the map shows —
 * each a page of the panel. The app's own settings (language, colour) stay in
 * the settings panel.
 */
export default function ProjectSettingsPanel({ tracksOpen, onShowTracks }) {
  const { t, fill } = useI18n()
  const project = useProject()
  const [page, setPage] = useState('main')
  if (!project) {
    return (
      <>
        <h2>{t('project_settings')}</h2>
        <span className="project-settings-hint">{t('project_settings_none')}</span>
      </>
    )
  }

  if (page === 'assign_tracks') return (
    <>
      <BackButton onBack={() => setPage('main')} />
      <h2>{t('edit_assign_tracks')}</h2>
      <AssignTracksForm onCommitted={() => setPage('main')} />
    </>
  )

  if (page === 'track_visibility') return (
    <>
      <BackButton onBack={() => setPage('main')} />
      <h2>{t('track_visibility')}<InfoTip text={t('track_visibility_hint')} /></h2>
      <TrackVisibilityForm />
    </>
  )

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
        <button type="button" className="panel-btn panel-btn-full" onClick={() => onShowTracks?.(!tracksOpen)}>
          {t(tracksOpen ? 'project_settings_tracks_hide' : 'project_settings_tracks_show')}
        </button>
        <div className="create-element-options">
          <button type="button" className="create-element-btn" onClick={() => setPage('assign_tracks')}>
            <AssignTracksIcon />
            {t('edit_assign_tracks')}
          </button>
          <button type="button" className="create-element-btn" onClick={() => setPage('track_visibility')}>
            <TrackVisibilityIcon />
            {t('track_visibility')}
          </button>
        </div>
      </FormSection>
    </>
  )
}
