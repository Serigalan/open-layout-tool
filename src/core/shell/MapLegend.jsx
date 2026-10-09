import { useSyncExternalStore } from 'react'
import { previewShown, subscribePreviews } from '../map/usePreview'
import { highlightColors } from '../utils/mapColors'
import { useI18n } from '../locales/i18nContext'

/**
 * What the colours on the map mean, while a dialog shows a preview (R10.10):
 * the tracks in the project colour, the preview dashed, what is picked, and
 * what the last step changed — each in the colour it has against the project
 * colour now.
 */
export default function MapLegend({ color }) {
  const { t } = useI18n()
  const shown = useSyncExternalStore(subscribePreviews, previewShown, previewShown)
  if (!shown) return null
  const h = highlightColors(color)
  const rows = [
    ['legend_tracks', color, false],
    ['legend_preview', h.hover, true],
    ['legend_selected', h.selected, false],
    ['legend_changed', h.flash, false],
  ]
  return (
    <div className="map-legend" aria-label={t('legend_title')}>
      {rows.map(([key, c, dashed]) => (
        <div key={key} className="map-legend-row">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="1" y1="4" x2="21" y2="4" stroke={c} strokeWidth="3" strokeDasharray={dashed ? '5 3' : undefined} />
          </svg>
          {t(key)}
        </div>
      ))}
    </div>
  )
}
