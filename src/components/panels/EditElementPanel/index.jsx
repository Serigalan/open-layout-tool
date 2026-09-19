import { useState } from 'react'
import { loadTracks } from '../../../storage'
import EditLengthForm from './EditLengthForm'
import EditPropertiesForm from './EditPropertiesForm'
import ChangeDirectionForm from './ChangeDirectionForm'
import DeleteForm from './DeleteForm'
import DeleteTrackForm from './DeleteTrackForm'
import DeleteSwitchForm from './DeleteSwitchForm'
import {
  BackIcon, EditLengthIcon, DeleteElementIcon, EditTracksIcon, EditPropertiesIcon,
  ChangeDirectionIcon, DeleteTrackIcon, DeleteSwitchIcon,
} from '../../../components/icons'

export default function EditElementPanel({ t, map, project, onTrackSaved, onShowTrackTable }) {
  const [page, setPage] = useState('menu')

  const backButton = (onBack) => (
    <button className="back-btn" onClick={() => { setPage('menu'); onBack?.() }}>
      <BackIcon />
      {t('btn_back')}
    </button>
  )

  if (page === 'edit_length') return (
    <>
      {backButton()}
      <h2>{t('edit_element_edit_length')}</h2>
      <EditLengthForm t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'edit_properties') return (
    <>
      {backButton()}
      <h2>{t('edit_track_properties')}</h2>
      <EditPropertiesForm t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'delete') return (
    <>
      {backButton()}
      <h2>{t('edit_element_delete')}</h2>
      <DeleteForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  if (page === 'edit_tracks') {
    const tracks = loadTracks(project?.id ?? '') ?? []
    return (
      <>
        {backButton(() => onShowTrackTable?.(null))}
        <h2>{t('edit_element_edit_tracks')}</h2>
        <div className="create-element-options">
          {tracks.map((track) => (
            <button
              key={track.id}
              className="create-element-btn"
              onClick={() => onShowTrackTable?.(track)}
            >
              {track.name || track.id.slice(0, 8)}
            </button>
          ))}
        </div>
      </>
    )
  }

  if (page === 'delete_track') return (
    <>
      {backButton()}
      <h2>{t('edit_track_delete')}</h2>
      <DeleteTrackForm t={t} map={map} project={project}
        onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'delete_switch') return (
    <>
      {backButton()}
      <h2>{t('switch_delete')}</h2>
      <DeleteSwitchForm t={t} map={map} project={project}
        onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'change_direction') return (
    <>
      {backButton()}
      <h2>{t('edit_change_direction')}</h2>
      <ChangeDirectionForm t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={() => setPage('menu')} />
    </>
  )

  return (
    <>
      <h2>{t('edit')}</h2>
      <div className="create-element-options">
        <span className="create-element-section">{t('edit_element')}</span>
        <button className="create-element-btn" onClick={() => setPage('edit_length')}>
          <EditLengthIcon />
          {t('edit_element_edit_length')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('delete')}>
          <DeleteElementIcon />
          {t('edit_element_delete')}
        </button>
        <span className="create-element-section">{t('edit_track')}</span>
        <button className="create-element-btn" onClick={() => setPage('edit_tracks')}>
          <EditTracksIcon />
          {t('edit_element_edit_tracks')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('edit_properties')}>
          <EditPropertiesIcon />
          {t('edit_track_properties')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('change_direction')}>
          <ChangeDirectionIcon />
          {t('edit_change_direction')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('delete_track')}>
          <DeleteTrackIcon />
          {t('edit_track_delete')}
        </button>
        <span className="create-element-section">{t('edit_switch')}</span>
        <button className="create-element-btn" onClick={() => setPage('delete_switch')}>
          <DeleteSwitchIcon />
          {t('switch_delete')}
        </button>
      </div>
    </>
  )
}
