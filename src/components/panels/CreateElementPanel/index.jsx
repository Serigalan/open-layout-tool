import { useState } from 'react'
import LineForm from './LineForm'
import CurvedLineForm from './CurvedLineForm'
import ParallelLineForm from './ParallelLineForm'
import ParallelTrackForm from './ParallelTrackForm'

export default function CreateElementPanel({ t, map, project, onTrackSaved }) {
  const [page, setPage] = useState('menu')

  const backButton = (
    <button className="back-btn" onClick={() => setPage('menu')}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M10 3 L5 8 L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {t('btn_back')}
    </button>
  )

  if (page === 'straight') return (
    <>
      {backButton}
      <h2>{t('create_straight_line')}</h2>
      <LineForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  if (page === 'curved') return (
    <>
      {backButton}
      <h2>{t('create_curved_line')}</h2>
      <CurvedLineForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  if (page === 'parallel') return (
    <>
      {backButton}
      <h2>{t('create_parallel')}</h2>
      <ParallelLineForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  if (page === 'parallel_track') return (
    <>
      {backButton}
      <h2>{t('create_parallel_track')}</h2>
      <ParallelTrackForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  return (
    <>
      <h2>{t('create_element')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('straight')}>
          <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="8" cy="14" r="2" fill="currentColor"/>
            <path d="M8 14 V2" stroke="currentColor"/>
            <circle cx="8" cy="2" r="2" fill="currentColor"/>
          </svg>
          {t('create_straight_line')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('curved')}>
          <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="2" cy="14" r="2" fill="currentColor"/>
            <path d="M2 14 A12 12 0 0 1 14 2" stroke="currentColor" fill="none"/>
            <circle cx="14" cy="2" r="2" fill="currentColor"/>
          </svg>
          {t('create_curved_line')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('parallel')}>
          <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
            <path d="M2 13 L14 4" stroke="currentColor"/>
            <circle cx="14" cy="4" r="1.6" fill="currentColor"/>
            <circle cx="4" cy="15.5" r="1.2" fill="currentColor" opacity="0.55"/>
            <path d="M4 15.5 L16 6.5" stroke="currentColor" opacity="0.55"/>
            <circle cx="16" cy="6.5" r="1.2" fill="currentColor" opacity="0.55"/>
          </svg>
          {t('create_parallel')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('parallel_track')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M1.876 11.325c.64-2.882 2.107-4.579 5.145-5.591l6.957-1.88" stroke="currentColor"/>
            <circle cx="1.876" cy="11.325" r="1.3" fill="currentColor"/>
            <circle cx="7.021" cy="5.734" r="1.3" fill="currentColor"/>
            <circle cx="13.35" cy="4.031" r="1.3" fill="currentColor"/>
            <path d="M4.618 11.862c.39-2.226 1.315-2.996 3.311-3.468l6.33-1.703" stroke="currentColor" opacity="0.55"/>
            <circle cx="4.618" cy="11.862" r="1.3" fill="currentColor" opacity="0.55"/>
            <circle cx="7.929" cy="8.394" r="1.3" fill="currentColor" opacity="0.55"/>
            <circle cx="14.259" cy="6.691" r="1.3" fill="currentColor" opacity="0.55"/>
          </svg>
          {t('create_parallel_track')}
        </button>
      </div>
    </>
  )
}
