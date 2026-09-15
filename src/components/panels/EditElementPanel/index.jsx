import { useState } from 'react'
import { loadTracks } from '../../../storage'
import EditLengthForm from './EditLengthForm'
import EditPropertiesForm from './EditPropertiesForm'
import ChangeDirectionForm from './ChangeDirectionForm'
import DeleteForm from './DeleteForm'
import DeleteTrackForm from './DeleteTrackForm'

export default function EditElementPanel({ t, map, project, onTrackSaved, onShowTrackTable }) {
  const [page, setPage] = useState('menu')

  const backButton = (onBack) => (
    <button className="back-btn" onClick={() => { setPage('menu'); onBack?.() }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M10 3 L5 8 L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
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
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2 V14 M5 2 H11 M5 14 H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          {t('edit_element_edit_length')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('delete')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 4 H13 M6 4 V2 H10 V4 M5 4 V13 H11 V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {t('edit_element_delete')}
        </button>
        <span className="create-element-section">{t('edit_track')}</span>
        <button className="create-element-btn" onClick={() => setPage('edit_tracks')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 4 Q5 2 8 4 Q11 6 14 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
            <path d="M2 9 Q5 7 8 9 Q11 11 14 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
          </svg>
          {t('edit_element_edit_tracks')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('edit_properties')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="4" width="12" height="2" rx="1" fill="currentColor"/>
            <rect x="2" y="8" width="8" height="2" rx="1" fill="currentColor"/>
            <rect x="2" y="12" width="10" height="2" rx="1" fill="currentColor"/>
          </svg>
          {t('edit_track_properties')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('change_direction')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 5 H11 M8 2 L11 5 L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <path d="M14 11 H5 M8 8 L5 11 L8 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
          {t('edit_change_direction')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('delete_track')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 4 H13 M6 4 V2 H10 V4 M5 4 V13 H11 V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {t('edit_track_delete')}
        </button>
      </div>
    </>
  )
}
