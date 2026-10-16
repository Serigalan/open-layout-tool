import NumberInput from './NumberInput'
import { settleStation } from '../../utils/stationSlider'

const round = (s) => String(Math.round(s * 1e4) / 1e4)

/**
 * Where a turnout or crossing lies along its track (Entscheidungen 309–311):
 * the station in metres from the track's begin, typed — taken as it is, the
 * dialog says if it cannot lie there — or dragged. Dragged it moves by the
 * centimetre over the stretches where it may lie (`intervals`), skips the rest
 * and snaps onto the stations in `snaps` (an end of it on an element change)
 * within a metre, or within what a pixel of the slider is worth on a long
 * track. The snap points stand as small marks under the slider. `hint` is a line
 * under it.
 */
export default function StationSlider({ label, value, onChange, intervals, snaps = [], hint = null }) {
  const has = intervals.length > 0
  // On the centimetre grid, so a dragged value is a whole centimetre; what
  // lies outside the stretches is settled back into them.
  const min = has ? Math.floor(intervals[0][0] * 100) / 100 : 0
  const max = has ? Math.ceil(intervals[intervals.length - 1][1] * 100) / 100 : 0
  const inside = (p) => intervals.some(([a, b]) => p >= a - 1e-9 && p <= b + 1e-9)
  const ticks = snaps.filter(inside)
  const tol = Math.max(1, (max - min) / 300)
  const v = Number(value)
  const shown = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min
  return (
    <div className="form-field station-slider">
      <label>{label}</label>
      <NumberInput step="0.001" min="0" value={value} onChange={e => onChange(e.target.value)} unit="m" />
      <div className="station-slider-track">
        <input type="range" min={min} max={max} step="0.01" value={shown} disabled={!has} aria-label={label}
          onChange={e => {
            const s = settleStation(Number(e.target.value), { intervals, snaps: ticks, tol })
            if (s != null) onChange(round(s))
          }} />
        {max > min && (
          <div className="station-slider-ticks" aria-hidden="true">
            {ticks.map(p => <span key={p} style={{ left: `${(p - min) / (max - min) * 100}%` }} />)}
          </div>
        )}
      </div>
      {hint && <div className="station-slider-hint">{hint}</div>}
    </div>
  )
}
