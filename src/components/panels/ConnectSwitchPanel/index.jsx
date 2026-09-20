import { useState } from 'react'
import ConnectStraightSwitchForm from './ConnectStraightSwitchForm'
import SCurveForm from './SCurveForm'
import SwitchOnTrackForm from './SwitchOnTrackForm'
import CrossingForm from './CrossingForm'
import CrossingOnTrackForm from './CrossingOnTrackForm'
import TrackLinkForm from './TrackLinkForm'
import {
  BackIcon, SwitchStraightIcon, SwitchCurvedIcon, SwitchOnTrackIcon, SwitchConnectionIcon,
  CrossingIcon, CrossingSwitchIcon, CrossingOnTrackIcon, SwitchLinkIcon,
} from '../../../components/icons'

// The gray line between the switch tools and the crossing tools, the same
// separator the layers panel draws between its basemap groups.
const SEPARATOR = { margin: '2px 0', border: 'none', borderTop: '1px solid #ddd' }

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

  if (page === 'crossing_ontrack') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('crossing_on_track')}</h2>
      <CrossingOnTrackForm t={t} map={map} project={project} onTrackSaved={onTrackSaved}
        onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'link') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('switch_link')}</h2>
      <TrackLinkForm t={t} map={map} project={project} onTrackSaved={onTrackSaved}
        onCommitted={() => setPage('menu')} />
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
        <hr style={SEPARATOR} />
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
        <hr style={SEPARATOR} />
        <button className="create-element-btn" onClick={() => setPage('link')}>
          <SwitchLinkIcon />
          {t('switch_link')}
        </button>
      </div>
    </>
  )
}
