import { useState } from 'react'
import OptimizeTrackPanel from './OptimizeTrackPanel'
import { PhysicsIcon, RegelwerkIcon, OptimizeTrackModeIcon, OptimizeElementModeIcon } from '../icons'
import { useI18n } from '../../locales/i18nContext'

/**
 * Checking the design (R10.7): the physics and the rulebook it is held to —
 * each a popup over the map, as wide as their tables — and the optimizer that
 * holds a track or an element to them. The optimizer is also where splicing
 * is, beside the other tools that reshape an alignment.
 */
export default function CheckPanel({ onShowPhysics, onShowRegelwerk }) {
  const { t } = useI18n()
  const [page, setPage] = useState('menu')

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
      </div>
    </>
  )
}
