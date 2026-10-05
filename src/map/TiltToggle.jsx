import { createPortal } from 'react-dom'
import { useI18n } from '../locales/i18nContext'

/**
 * The toggle button below the map's compass that lets the map be tilted into
 * 3D (`tilt` is useMapInstance's), a button like the zoom and compass ones.
 * Off, the right mouse button only turns the map.
 */
export default function TiltToggle({ tilt }) {
  const { t } = useI18n()
  if (!tilt.node) return null
  return createPortal(
    <button type="button" className={`map-tilt-toggle${tilt.on ? ' active' : ''}`}
      title={t('map_tilt_hint')} aria-label={t('map_tilt_hint')} aria-pressed={tilt.on}
      onClick={() => tilt.set(!tilt.on)}>
      3D
    </button>,
    tilt.node,
  )
}
