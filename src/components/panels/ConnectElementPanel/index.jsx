import { useState } from 'react'
import ConnectStraightForm from './ConnectStraightForm'
import ConnectCurvedForm from './ConnectCurvedForm'
import { BackIcon, ConnectStraightIcon, ConnectCurvedIcon } from '../../../components/icons'

export default function ConnectElementPanel({ t, map, project, onTrackSaved }) {
  const [page, setPage] = useState('menu')

  const backButton = (
    <button className="back-btn" onClick={() => setPage('menu')}>
      <BackIcon />
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
          <ConnectStraightIcon />
          {t('connect_straight')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('curved')}>
          <ConnectCurvedIcon />
          {t('connect_curved')}
        </button>
      </div>
    </>
  )
}
