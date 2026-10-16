import { useRef } from 'react'
import { useElementSize } from './useChartViewport'
import { niceStep, ticks } from '../../utils/common/chartAxes'
import { useI18n } from '../../locales/i18nContext'
import { PALETTE } from '../../styles/palette'

const H = 120
const PAD = { left: 56, right: 8, top: 8, bottom: 22 }
// Room above the band for the readout of the station under the cursor.
const READOUT_TOP = 20

/**
 * How far the new axis lies from the old one over the station of the old
 * (Paket N): the band the service answered ([[station, offset], …] in m, the
 * largest in every half metre, > 0 to the right), drawn in cm against the
 * tolerance either side — red where it is beyond it. The shift values
 * (Paket V) draw theirs with it, across and in height (`label`).
 *
 * With `onCursor` it follows the pointer, as the Höhenplan does: it is told
 * the station under it (null when the pointer leaves) and draws `cursor` —
 * the station its owner settled on — with the value there in mm above it.
 */
export default function DeviationBand({ band, tolerance, label = null, cursor = null, onCursor = null }) {
  const { t, num } = useI18n()
  const boxRef = useRef(null)
  const size = useElementSize(boxRef)
  const W = size?.w ?? 280
  if (!band?.length) return null
  const pad = onCursor ? { ...PAD, top: READOUT_TOP } : PAD
  const s0 = band[0][0], s1 = Math.max(band[band.length - 1][0], s0 + 1)
  const tolCm = tolerance * 100
  const peak = Math.max(tolCm, 0.1, ...band.map(([, d]) => Math.abs(d) * 100)) * 1.15
  const x = (s) => pad.left + (s - s0) / (s1 - s0) * (W - pad.left - pad.right)
  const y = (cm) => pad.top + (peak - cm) / (2 * peak) * (H - pad.top - pad.bottom)
  const sAt = (px) => s0 + (px - pad.left) / (W - pad.left - pad.right) * (s1 - s0)
  const labelled = Math.abs(y(tolCm) - y(0)) >= 14 ? tolCm : peak / 1.15
  const d = band.map(([s, off], i) => `${i ? 'L' : 'M'}${x(s).toFixed(1)},${y(off * 100).toFixed(1)}`).join('')
  const beyond = band.filter(([, off]) => Math.abs(off) > tolerance)
  const xStep = niceStep(50, (W - pad.left - pad.right) / (s1 - s0))
  const at = cursor != null && cursor >= s0 && cursor <= s1 ? cursor : null
  const value = at != null ? band.find(([s]) => Math.abs(s - at) < 1e-6)?.[1] ?? null : null
  const mm = (v) => { const m = Math.round(v * 1000); return `${m > 0 ? '+' : m < 0 ? '−' : ''}${Math.abs(m)} mm` }
  const pointer = onCursor ? {
    onPointerMove: (e) => {
      const px = e.clientX - e.currentTarget.getBoundingClientRect().left
      onCursor(px < pad.left || px > W - pad.right ? null : sAt(px))
    },
    onPointerLeave: () => onCursor(null),
  } : {}
  return (
    <div ref={boxRef} className="deviation-band" aria-label={label ?? t('reconnect_band')}>
      <svg width={W} height={H} {...pointer}>
        <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke={PALETTE.axis} strokeWidth={1} />
        {[tolCm, -tolCm].map(v => (
          <line key={v} x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)}
            stroke={PALETTE.invalid} strokeWidth={1} strokeDasharray="4 3" />
        ))}
        {/* The tolerance labelled where it stands clear of the zero line, else the extent drawn. */}
        {[labelled, -labelled].map(v => (
          <text key={v} className="chart-label" x={pad.left - 4} y={y(v) + 3} textAnchor="end">
            {`${v > 0 ? '+' : '−'}${num(Math.abs(v), { digits: 1, unit: 'cm' })}`}
          </text>
        ))}
        <text className="chart-label" x={pad.left - 4} y={y(0) + 3} textAnchor="end">0</text>
        <path d={d} fill="none" stroke={PALETTE.previewLine} strokeWidth={1.5} />
        {beyond.map(([s, off]) => (
          <circle key={s} cx={x(s)} cy={y(off * 100)} r={2} fill={PALETTE.invalid} />
        ))}
        {ticks(s0, s1, xStep).map(s => (
          <text key={s} className="chart-label" x={x(s)} y={H - 6} textAnchor="middle">{num(s, { digits: 0 })}</text>
        ))}
        {at != null && (
          <g pointerEvents="none">
            <line x1={x(at)} x2={x(at)} y1={pad.top} y2={H - pad.bottom} stroke={PALETTE.mapHover} strokeWidth={1} strokeDasharray="2 2" />
            {value != null && (
              <circle cx={x(at)} cy={y(value * 100)} r={3} fill={PALETTE.mapHover} stroke={PALETTE.white} strokeWidth={1.5} />
            )}
            <text className="chart-readout-label" x={Math.min(Math.max(x(at), pad.left + 50), W - pad.right - 50)} y={pad.top - 6}
              textAnchor="middle" fill={PALETTE.mapHover}>
              {`${num(at, { digits: 1 })} m · ${value != null ? mm(value) : '–'}`}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}
