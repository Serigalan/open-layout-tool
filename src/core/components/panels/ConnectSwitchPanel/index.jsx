import { useState } from 'react'
import SCurveForm from './SCurveForm'
import SwitchOnTrackForm from './SwitchOnTrackForm'
import SwitchConnectForm from './SwitchConnectForm'
import CrossingOnTrackForm from './CrossingOnTrackForm'
import CrossingConnectForm from './CrossingConnectForm'
import TrackLinkForm from './TrackLinkForm'
import SwitchDetailPage from './SwitchDetailPage'
import SwitchSearch from './SwitchSearch'
import CrossoverGradientForm from '../CrossoverGradientForm'
import {
  SwitchOnTrackIcon, SwitchConnectTrackIcon, SwitchConnectionIcon, CrossingOnTrackIcon, CrossingConnectTrackIcon, SwitchLinkIcon,
  SwitchDetailIcon,
} from '../../icons'
import { useI18n } from '../../../locales/i18nContext'
import BackButton from '../BackButton'
import InfoTip from '../../form/InfoTip'
import PanelHeading from '../PanelHeading'

export default function ConnectSwitchPanel({ detailTarget = null, onShowDetail }) {
  const { t } = useI18n()
  const [page, setPage] = useState('menu')
  const [crossover, setCrossover] = useState(null)   // switchIds of a crossover just laid in a curve
  const [switchQuery, setSwitchQuery] = useState('')
  const back = () => setPage('menu')

  if (page === 'ontrack') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('switch_on_track')}</h2>
      <SwitchOnTrackForm onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'connect') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('switch_connect_track')}</h2>
      <SwitchConnectForm onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'scurve') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('scurve_title')}</h2>
      <SCurveForm onCommitted={(laid) => {
        if (laid?.canted) { setCrossover(laid.switchIds); setPage('crossover_gradient') } else setPage('menu')
      }} />
    </>
  )

  if (page === 'crossover_gradient' && crossover) return (
    <>
      <BackButton onBack={back} />
      <h2>{t('crossover_title')}</h2>
      <CrossoverGradientForm switchIds={crossover} ask onDone={back} />
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

  if (page === 'crossing_connect') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('crossing_connect_track')}</h2>
      <CrossingConnectForm onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'detail') return (
    <>
      <BackButton onBack={() => { onShowDetail?.(null); back() }} />
      <h2>{t('switch_detail')}<InfoTip text={t('switch_detail_hint')} /></h2>
      <SwitchDetailPage target={detailTarget} onShow={(target) => onShowDetail?.(target)} />
    </>
  )

  if (page === 'link') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('switch_link')}<InfoTip text={t('switch_link_hint')} /></h2>
      <TrackLinkForm
        onCommitted={() => setPage('menu')} />
    </>
  )

  return (
    <>
      <PanelHeading title={t('connect_switch')}
        search={{ value: switchQuery, onChange: setSwitchQuery, placeholder: t('search_switches') }} />
      <SwitchSearch query={switchQuery} />
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('ontrack')}>
          <SwitchOnTrackIcon />
          {t('switch_on_track')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('connect')}>
          <SwitchConnectTrackIcon />
          {t('switch_connect_track')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('scurve')}>
          <SwitchConnectionIcon />
          {t('scurve_title')}
        </button>
        <hr className="divider divider-wide" />
        <button className="create-element-btn" onClick={() => setPage('crossing_ontrack')}>
          <CrossingOnTrackIcon />
          {t('crossing_on_track')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('crossing_connect')}>
          <CrossingConnectTrackIcon />
          {t('crossing_connect_track')}
        </button>
        <hr className="divider divider-wide" />
        <button className="create-element-btn" onClick={() => setPage('link')}>
          <SwitchLinkIcon />
          {t('switch_link')}
        </button>
        <hr className="divider divider-wide" />
        <button className="create-element-btn" onClick={() => setPage('detail')}>
          <SwitchDetailIcon />
          {t('switch_detail')}
        </button>
      </div>
    </>
  )
}
