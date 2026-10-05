import { createPortal } from 'react-dom'
import { useI18n } from '../locales/i18nContext'

/**
 * The checkbox below the map's compass that lets the map be tilted into 3D
 * (`tilt` is useMapInstance's). Off, the right mouse button only turns it.
 */
export default function TiltToggle({ tilt }) {
  const { t } = useI18n()
  if (!tilt.node) return null
  return createPortal(
    <label className="map-tilt-toggle" title={t('map_tilt_hint')}>
      <input type="checkbox" checked={tilt.on} onChange={e => tilt.set(e.target.checked)} />
      3D
    </label>,
    tilt.node,
  )
}
