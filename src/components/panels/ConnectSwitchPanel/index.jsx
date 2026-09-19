import { useState } from 'react'
import ConnectStraightSwitchForm from './ConnectStraightSwitchForm'
import SCurveForm from './SCurveForm'
import SwitchOnTrackForm from './SwitchOnTrackForm'
import CrossingForm from './CrossingForm'
import {
  BackIcon, SwitchStraightIcon, SwitchCurvedIcon, SwitchOnTrackIcon, SwitchConnectionIcon,
  CrossingIcon, CrossingSwitchIcon,
} from '../../../components/icons'

function BackButton({ t, onBack }) {
  return (
    <button className="back-btn" onClick={onBack}>
      <BackIcon />
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

  return (
    <>
      <h2>{t('connect_switch')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('straight')}>
          <SwitchStraightIcon />
          {t('switch_straight')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('curved')}>
          <SwitchCurvedIcon />
          {t('switch_curved')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('ontrack')}>
          <SwitchOnTrackIcon />
          {t('switch_on_track')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('scurve')}>
          <SwitchConnectionIcon />
          {t('scurve_title')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('crossing')}>
          <CrossingIcon />
          {t('crossing')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('crossing_switch')}>
          <CrossingSwitchIcon />
          {t('crossing_switch')}
        </button>
      </div>
    </>
  )
}
