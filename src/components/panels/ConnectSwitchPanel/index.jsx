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
import { useI18n } from '../../../locales/i18nContext'

// The gray line between the switch tools and the crossing tools, the same
// separator the layers panel draws between its basemap groups.
const SEPARATOR = { margin: '2px 0', border: 'none', borderTop: '1px solid #ddd' }

function BackButton({ onBack }) {
  const { t } = useI18n()
  return (
    <button className="back-btn" onClick={onBack}>
      <BackIcon />
      {t('btn_back')}
    </button>
  )
}

export default function ConnectSwitchPanel() {
  const { t } = useI18n()
  const [page, setPage] = useState('menu')
  const back = () => setPage('menu')

  if (page === 'straight') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('switch_straight')}</h2>
      <ConnectStraightSwitchForm onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'curved') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('switch_curved')}</h2>
      <ConnectStraightSwitchForm curved onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'ontrack') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('switch_on_track')}</h2>
      <SwitchOnTrackForm onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'scurve') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('scurve_title')}</h2>
      <SCurveForm onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'crossing') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('crossing_title')}</h2>
      <CrossingForm
        onCommitted={() => setPage('menu')} initialKind="crossing" />
    </>
  )

  if (page === 'crossing_switch') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('crossing_title')}</h2>
      <CrossingForm
        onCommitted={() => setPage('menu')} initialKind="single_slip" />
    </>
  )

  if (page === 'crossing_ontrack') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('crossing_on_track')}</h2>
      <CrossingOnTrackForm
        onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'link') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('switch_link')}</h2>
      <TrackLinkForm
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
        <hr className="divider divider-wide" />
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
        <hr className="divider divider-wide" />
        <button className="create-element-btn" onClick={() => setPage('link')}>
          <SwitchLinkIcon />
          {t('switch_link')}
        </button>
      </div>
    </>
  )
}
