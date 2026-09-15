import { useState } from 'react'
import ConnectStraightSwitchForm from './ConnectStraightSwitchForm'
import SCurveForm from './SCurveForm'
import SwitchOnTrackForm from './SwitchOnTrackForm'

function BackButton({ t, onBack }) {
  return (
    <button className="back-btn" onClick={onBack}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M10 3 L5 8 L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {t('btn_back')}
    </button>
  )
}

export default function ConnectSwitchPanel({ t, map, project, onTrackSaved }) {
  const [page, setPage] = useState('menu')
  const back = () => setPage('menu')

  if (page === 'straight') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('switch_straight')}</h2>
      <ConnectStraightSwitchForm t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'curved') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('switch_curved')}</h2>
      <ConnectStraightSwitchForm curved t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'ontrack') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('switch_on_track')}</h2>
      <SwitchOnTrackForm t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'scurve') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('scurve_title')}</h2>
      <SCurveForm t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={() => setPage('menu')} />
    </>
  )

  return (
    <>
      <h2>{t('connect_switch')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('straight')}>
          <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="4" cy="14" r="2" fill="currentColor"/>
            <path d="M4 14 V2" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="4" cy="2" r="2" fill="currentColor"/>
            <path d="M4 14 A10 10 0 0 1 12 4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="12" cy="4" r="2" fill="currentColor"/>
          </svg>
          {t('switch_straight')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('curved')}>
          <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="6" cy="14" r="2" fill="currentColor"/>
            <circle cx="2" cy="2" r="2" fill="currentColor"/>
            <path d="M6 14c.134-4.828 1.5-7.665 6-10M6 14C5.374 8.763 4.261 5.673 2 2" fill="none" stroke="currentColor"/>
            <circle cx="12" cy="4" r="2" fill="currentColor"/>
          </svg>
          {t('switch_curved')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('ontrack')}>
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M1 11h14" fill="none" stroke="currentColor"/>
            <circle cx="6" cy="11" r="1.8" fill="currentColor"/>
            <path d="m6 11 8.475-6.735" fill="none" stroke="currentColor"/>
          </svg>
          {t('switch_on_track')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('scurve')}>
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M1 13 A6 6 0 0 1 8 8 A6 6 0 0 0 15 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="1" cy="13" r="1.6" fill="currentColor"/>
            <circle cx="15" cy="3" r="1.6" fill="currentColor"/>
          </svg>
          {t('scurve_title')}
        </button>
      </div>
    </>
  )
}
