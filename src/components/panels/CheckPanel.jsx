import { useState } from 'react'
import OptimizeTrackPanel from './OptimizeTrackPanel'
import GroupedTrackList from './GroupedTrackList'
import { PhysicsIcon, RegelwerkIcon, OptimizeTrackModeIcon, OptimizeElementModeIcon, AxisFitModeIcon, BandsIcon, BackIcon } from '../icons'
import { useTracks } from '../../hooks/useStore'
import { useI18n } from '../../locales/i18nContext'
import useMapPick from '../../map/useMapPick'

/**
 * The bands of a track: pick one from the list or on the map, and its
 * curvature, cant, height plan and speed stand under each other in the
 * overlay. A click on another track swaps the overlay over to it.
 */
function BandsPage({ trackId, onShow, onExit }) {
  const { t } = useI18n()
  const tracks = useTracks()
  useMapPick({ active: true, hover: 'track', onPick: ({ trackId: id }) => onShow?.(id) })
  return (
    <>
      <button className="back-btn" onClick={onExit}>
        <BackIcon />
        {t('btn_back')}
      </button>
      <h2>{t('check_bands')}</h2>
      <p className="selecting-hint">{t('bands_hint')}</p>
      {tracks.length === 0 && <p className="form-error">{t('plan_no_tracks')}</p>}
      <GroupedTrackList tracks={tracks}
        isActive={(track) => track.id === trackId}
        onPick={(track) => onShow?.(track.id)} />
    </>
  )
}

/**
 * Checking the design (R10.7): the physics and the rulebook it is held to —
 * each a popup over the map, as wide as their tables — and the optimizer that
 * holds a track or an element to them, the one place it is offered; beside it
 * the alignment fit from a measured axis (AP 12.5). Last the bands of a track,
 * to read its alignment along it at one glance.
 */
export default function CheckPanel({ onShowPhysics, onShowRegelwerk, bandsTrackId, onShowBands }) {
  const { t } = useI18n()
  const [page, setPage] = useState('menu')

  if (page === 'bands') {
    // Leaving the page takes the bands with it: they belong to it.
    return (
      <BandsPage trackId={bandsTrackId} onShow={onShowBands}
        onExit={() => { onShowBands?.(null); setPage('menu') }} />
    )
  }
  if (page !== 'menu') {
    return (
      <OptimizeTrackPanel initialPage={page} onExit={() => setPage('menu')} onShowRegelwerk={onShowRegelwerk} />
    )
  }
  return (
    <>
      <h2>{t('check_title')}</h2>
      <p className="selecting-hint">{t('check_hint')}</p>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => onShowPhysics?.()}>
          <PhysicsIcon />
          {t('constraints_physics')}
        </button>
        <button className="create-element-btn" onClick={() => onShowRegelwerk?.()}>
          <RegelwerkIcon />
          {t('constraints_regelwerk')}
        </button>
        <span className="create-element-section">{t('check_optimize')}</span>
        <button className="create-element-btn" onClick={() => setPage('track')}>
          <OptimizeTrackModeIcon />
          {t('optimize_mode_track')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('element')}>
          <OptimizeElementModeIcon />
          {t('optimize_mode_element')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('axis')}>
          <AxisFitModeIcon />
          {t('optimize_mode_axis')}
        </button>
        <span className="create-element-section">{t('check_bands')}</span>
        <button className="create-element-btn" onClick={() => setPage('bands')}>
          <BandsIcon />
          {t('check_bands_show')}
        </button>
      </div>
    </>
  )
}
