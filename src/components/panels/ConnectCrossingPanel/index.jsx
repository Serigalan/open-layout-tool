import { useState } from 'react'
import CrossingForm from './CrossingForm'
import CrossingOnTrackForm from './CrossingOnTrackForm'
import {
  BackIcon, CrossingIcon, CrossingSwitchIcon, CrossingOnTrackIcon,
} from '../../../components/icons'

function BackButton({ t, onBack }) {
  return (
    <button className="back-btn" onClick={onBack}>
      <BackIcon />
      {t('btn_back')}
    </button>
  )
}

export default function ConnectCrossingPanel({ t, map, project, onTrackSaved }) {
  const [page, setPage] = useState('menu')
  const back = () => setPage('menu')

  if (page === 'crossing') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('crossing_title')}</h2>
      <CrossingForm t={t} map={map} project={project} onTrackSaved={onTrackSaved}
        onCommitted={() => setPage('menu')} initialKind="crossing" />
    </>
  )

  if (page === 'crossing_switch') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('crossing_title')}</h2>
      <CrossingForm t={t} map={map} project={project} onTrackSaved={onTrackSaved}
        onCommitted={() => setPage('menu')} initialKind="single_slip" />
    </>
  )

  if (page === 'crossing_ontrack') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('crossing_on_track')}</h2>
      <CrossingOnTrackForm t={t} map={map} project={project} onTrackSaved={onTrackSaved}
        onCommitted={() => setPage('menu')} />
    </>
  )

  return (
    <>
      <h2>{t('connect_crossing')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('crossing')}>
          <CrossingIcon />
          {t('crossing')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('crossing_switch')}>
          <CrossingSwitchIcon />
          {t('crossing_switch')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('crossing_ontrack')}>
          <CrossingOnTrackIcon />
          {t('crossing_on_track')}
        </button>
      </div>
    </>
  )
}
