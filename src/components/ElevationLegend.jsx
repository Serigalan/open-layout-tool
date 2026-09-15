import { RELIEF_RAMP } from '../basemaps'

// The bar is drawn from the same ramp the map is painted with, bottom (lowest)
// to top (highest), so legend and terrain can never drift apart.
const GRADIENT = `linear-gradient(to top, ${
  RELIEF_RAMP.map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${(t * 100).toFixed(1)}%`).join(', ')
})`

const TICKS = [1, 0.75, 0.5, 0.25, 0]

/**
 * Legend for the elevation basemaps. `range` is the [min, max] the colour scale
 * is currently fitted to — it follows the view, so the labels do too.
 */
export default function ElevationLegend({ range, t }) {
  if (!range) return null
  const [min, max] = range
  const span = max - min
  // A few metres of range need a decimal to say anything; hundreds do not.
  const decimals = span < 20 ? 1 : 0
  const label = (f) => (min + f * span).toFixed(decimals)

  return (
    <div className="elevation-legend">
      <span className="elevation-legend-title">{t('legend_elevation')}</span>
      <div className="elevation-legend-body">
        <div className="elevation-legend-bar" style={{ background: GRADIENT }} />
        <div className="elevation-legend-ticks">
          {TICKS.map(f => <span key={f}>{label(f)}</span>)}
        </div>
      </div>
    </div>
  )
}
