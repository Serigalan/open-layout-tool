import { useState } from 'react'
import ConnectStraightForm from './ConnectStraightForm'
import ConnectCurvedForm from './ConnectCurvedForm'

export default function ConnectElementPanel({ t, map, project, onTrackSaved }) {
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
      <h2>{t('connect_straight')}</h2>
      <ConnectStraightForm t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'curved') return (
    <>
      {backButton}
      <h2>{t('connect_curved')}</h2>
      <ConnectCurvedForm t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={() => setPage('menu')} />
    </>
  )

  return (
    <>
      <h2>{t('connect_element')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('straight')}>
          <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="8" cy="14" r="2" fill="currentColor"/>
            <path d="M8 14 V8" stroke="currentColor"/>
            <circle cx="8" cy="5" r="0.5" fill="currentColor"/>
            <circle cx="8" cy="2" r="0.5" fill="currentColor"/>
          </svg>
          {t('connect_straight')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('curved')}>
          <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="2" cy="14" r="2" fill="currentColor"/>
            <path d="M2 14 A10 10 0 0 1 9 6" stroke="currentColor" fill="none"/>
            <circle cx="11" cy="5" r="0.5" fill="currentColor"/>
            <circle cx="13" cy="4.5" r="0.5" fill="currentColor"/>
          </svg>
          {t('connect_curved')}
        </button>
      </div>
    </>
  )
}
