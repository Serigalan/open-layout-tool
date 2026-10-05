import { useMemo, useRef, useState } from 'react'
import { useDrag, useElementSize, useWheelZoom } from './useChartViewport'
import { niceStep, stepDecimals, ticks } from '../../utils/chartAxes'
import { clamp } from '../../utils/format'
import { insertStraight, moveStraightEnd } from '../../utils/alignmentFit'
import { useI18n } from '../../locales/i18nContext'
import { PALETTE } from '../../styles/palette'

const H = 262
const PAD = { left: 38, right: 8 }
const KAPPA = { top: 22, bottom: 150 }      // the curvature plot [px]
const OFFSET = { top: 172, bottom: 236 }    // the offset band [px]
const AXIS_Y = 250

/** Index of the first station at or after `s` (the last one past the end). */
function indexAt(stations, s) {
  let a = 0, b = stations.length - 1
  while (a < b) {
    const m = (a + b) >> 1
    if (stations[m] < s) a = m + 1
    else b = m
  }
  return a
}

/** A polyline through the finite values of `ys`, broken where one is null. */
function path(xs, ys, x, y) {
  let d = ''
  let pen = false
  for (let i = 0; i < xs.length; i++) {
    if (ys[i] == null) { pen = false; continue }
    d += `${pen ? 'L' : 'M'}${x(xs[i]).toFixed(1)},${y(ys[i]).toFixed(1)}`
    pen = true
  }
  return d
}

/**
 * The curvature diagram of an alignment fit (AP 12.5, Entscheidung 133): κ of
 * the axis points and of the fitted chain over the station, the straights as
 * bands, and below it every point's offset from the chain against the
 * tolerance. The ends of a straight are dragged, a band is picked by a click,
 * and with `inserting` a new straight is drawn across the diagram. The wheel
 * zooms, a drag on the background pans. `onHover` gets the index of the point
 * under the pointer (or null).
 */
export default function CurvatureChart({
  answer, fitted, straights, tolerance, selected, onSelect, onChange, inserting, onInsert, onHover,
}) {
  const { t } = useI18n()
  const boxRef = useRef(null)
  const size = useElementSize(boxRef)
  const W = size?.w ?? 300
  const stations = answer.stations
  const full = [stations[0], stations[stations.length - 1]]
  // The stretch in view, for the points it was set on: a new set of points is
  // looked at whole.
  const extentKey = `${full[0]}|${full[1]}`
  const [viewState, setViewState] = useState(null)
  const [v0, v1] = viewState?.key === extentKey ? viewState.view : full
  const setView = (view) => setViewState({ key: extentKey, view })
  const [draft, setDraft] = useState(null)     // straights while one is dragged or drawn
  const [hover, setHover] = useState(null)     // index of the point under the pointer

  const x = (s) => PAD.left + (s - v0) / (v1 - v0) * (W - PAD.left - PAD.right)
  const sAt = (px) => v0 + (px - PAD.left) / (W - PAD.left - PAD.right) * (v1 - v0)

  // κ in 1/km, so R 500 reads 2.
  const kappa = useMemo(() => answer.kappa.map(k => (k == null ? null : k * 1000)), [answer.kappa])
  const kRange = useMemo(() => {
    const vals = kappa.filter(k => k != null)
    const fit = fitted.flatMap(f => [f.k1 * 1000, f.k2 * 1000])
    const lo = Math.min(0, ...vals, ...fit), hi = Math.max(0, ...vals, ...fit)
    const pad = Math.max(0.1, (hi - lo) * 0.08)
    return [lo - pad, hi + pad]
  }, [kappa, fitted])
  const ky = (k) => KAPPA.bottom - (k - kRange[0]) / (kRange[1] - kRange[0]) * (KAPPA.bottom - KAPPA.top)
  const offsets = answer.offsets
  const oMax = Math.max(tolerance * 1.5, ...(offsets ?? []).map(Math.abs)) * 1000
  const oy = (mm) => (OFFSET.top + OFFSET.bottom) / 2 - mm / oMax * (OFFSET.bottom - OFFSET.top) / 2

  const shown = draft ?? straights

  const zoom = (factor, px) => {
    const at = sAt(px)
    const span = clamp((v1 - v0) / factor, 5, full[1] - full[0])
    const a = clamp(at - (at - v0) / (v1 - v0) * span, full[0], full[1] - span)
    setView([a, a + span])
  }
  useWheelZoom(boxRef, zoom, true)

  const localX = (e) => e.clientX - boxRef.current.getBoundingClientRect().left
  const { dragging, handlers } = useDrag({
    onStart: (e) => {
      const kind = e.target.dataset?.kind
      if (kind === 'edge') return { kind, i: Number(e.target.dataset.i), side: e.target.dataset.side }
      if (kind === 'band' && !inserting) return { kind, i: Number(e.target.dataset.i), quiet: true }
      if (inserting) return { kind: 'insert', at: sAt(localX(e)) }
      return { kind: 'pan', view: [v0, v1] }
    },
    onMove: (e, start, d) => {
      if (start.kind === 'edge') setDraft(moveStraightEnd(straights, start.i, start.side, sAt(localX(e))))
      else if (start.kind === 'insert') setDraft(insertStraight(straights, start.at, sAt(localX(e))) ?? straights)
      else if (start.kind === 'pan') {
        const per = (start.view[1] - start.view[0]) / (W - PAD.left - PAD.right)
        const span = start.view[1] - start.view[0]
        const a = clamp(start.view[0] - d.dx * per, full[0], full[1] - span)
        setView([a, a + span])
      }
    },
    onEnd: (start, moved) => {
      if (start.kind === 'band' && !moved) onSelect(start.i === selected ? null : start.i)
      else if (start.kind === 'pan' && !moved) onSelect(null)
      else if (start.kind === 'edge' && moved && draft) onChange(draft)
      else if (start.kind === 'insert' && draft && draft !== straights) onInsert(draft)
      setDraft(null)
    },
  })

  const onPointerMove = (e) => {
    handlers.onPointerMove(e)
    const i = indexAt(stations, sAt(localX(e)))
    setHover(i)
    onHover?.(i)
  }
  const onPointerLeave = () => { setHover(null); onHover?.(null) }

  // Only what is in view is drawn: a long axis has tens of thousands of points.
  const lo = Math.max(0, indexAt(stations, v0) - 1)
  const hi = Math.min(stations.length, indexAt(stations, v1) + 2)
  const xs = stations.slice(lo, hi)
  const step = niceStep(70, (W - PAD.left - PAD.right) / (v1 - v0))
  const kStep = niceStep(22, (KAPPA.bottom - KAPPA.top) / (kRange[1] - kRange[0]))
  const fittedPath = fitted.filter(f => f.to >= v0 && f.from <= v1)
    .map(f => `M${x(f.from).toFixed(1)},${ky(f.k1 * 1000).toFixed(1)}L${x(f.to).toFixed(1)},${ky(f.k2 * 1000).toFixed(1)}`).join('')
  const tolMm = tolerance * 1000

  return (
    <div ref={boxRef} className={`curvature-chart${dragging ? ' dragging' : ''}${inserting ? ' inserting' : ''}`}>
      <svg width={W} height={H} {...handlers} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
        <defs>
          <clipPath id="curvature-clip"><rect x={PAD.left} y={0} width={Math.max(0, W - PAD.left - PAD.right)} height={H} /></clipPath>
        </defs>
        <rect className="chart-bg" x={0} y={0} width={W} height={H} fill="transparent" />
        {ticks(kRange[0], kRange[1], kStep).map(k => (
          <g key={`k${k}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={ky(k)} y2={ky(k)} stroke={k === 0 ? PALETTE.axis : PALETTE.gridLine} />
            <text x={PAD.left - 4} y={ky(k) + 3} textAnchor="end" className="chart-label">{k.toFixed(stepDecimals(kStep))}</text>
          </g>
        ))}
        <text x={2} y={KAPPA.top - 10} className="chart-label">{t('align_chart_kappa')}</text>
        <text x={2} y={OFFSET.top - 8} className="chart-label">{t('align_chart_offset')}</text>
        <g clipPath="url(#curvature-clip)">
          {(answer.gaps ?? []).map((g, i) => (
            <rect key={`g${i}`} x={x(g.from)} y={KAPPA.top} width={Math.max(1, x(g.to) - x(g.from))}
              height={OFFSET.bottom - KAPPA.top} fill={PALETTE.gridLine} />
          ))}
          {shown.map((s, i) => (
            <g key={`s${i}`}>
              <rect data-kind="band" data-i={i} x={x(s.from)} y={KAPPA.top} width={Math.max(1, x(s.to) - x(s.from))}
                height={KAPPA.bottom - KAPPA.top} className={`straight-band${i === selected ? ' selected' : ''}`} />
              <line data-kind="edge" data-i={i} data-side="from" x1={x(s.from)} x2={x(s.from)} y1={KAPPA.top} y2={KAPPA.bottom} className="straight-edge" />
              <line data-kind="edge" data-i={i} data-side="to" x1={x(s.to)} x2={x(s.to)} y1={KAPPA.top} y2={KAPPA.bottom} className="straight-edge" />
            </g>
          ))}
          {fitted.slice(1).map((f, i) => (f.from >= v0 && f.from <= v1
            ? <line key={`e${i}`} x1={x(f.from)} x2={x(f.from)} y1={KAPPA.bottom - 6} y2={KAPPA.bottom} stroke={PALETTE.label} />
            : null))}
          <g pointerEvents="none">
          <path d={path(xs, kappa.slice(lo, hi), x, ky)} fill="none" stroke={PALETTE.measuredAxis} strokeWidth={1} />
          <path d={fittedPath} fill="none" stroke={PALETTE.previewLine} strokeWidth={1.6} />
          {offsets && (
            <>
              <line x1={PAD.left} x2={W} y1={oy(tolMm)} y2={oy(tolMm)} stroke={PALETTE.error} strokeDasharray="4 3" />
              <line x1={PAD.left} x2={W} y1={oy(-tolMm)} y2={oy(-tolMm)} stroke={PALETTE.error} strokeDasharray="4 3" />
              <line x1={PAD.left} x2={W} y1={oy(0)} y2={oy(0)} stroke={PALETTE.axis} />
              <path d={path(xs, offsets.slice(lo, hi).map(o => o * 1000), x, oy)} fill="none" stroke={PALETTE.textSoft} strokeWidth={1} />
              {xs.map((s, k) => (Math.abs(offsets[lo + k]) > tolerance
                ? <circle key={`o${k}`} cx={x(s)} cy={oy(offsets[lo + k] * 1000)} r={1.6} fill={PALETTE.error} />
                : null))}
            </>
          )}
          </g>
          {hover != null && stations[hover] >= v0 && stations[hover] <= v1 && (
            <line x1={x(stations[hover])} x2={x(stations[hover])} y1={KAPPA.top} y2={OFFSET.bottom} stroke={PALETTE.mapHover}
              pointerEvents="none" />
          )}
        </g>
        {offsets && (
          <text x={PAD.left - 4} y={oy(tolMm) + 3} textAnchor="end" className="chart-label">{`±${tolMm.toFixed(0)}`}</text>
        )}
        {ticks(v0, v1, step).map(s => (
          <text key={`x${s}`} x={x(s)} y={AXIS_Y + 8} textAnchor="middle" className="chart-label">{s.toFixed(stepDecimals(step))}</text>
        ))}
      </svg>
      <div className="chart-readout">
        {hover != null
          ? `${stations[hover].toFixed(1)} m · ${kappa[hover] == null ? '–' : `R ${Math.abs(kappa[hover]) < 0.01 ? '∞' : Math.round(1000 / kappa[hover])} m`}`
            + (offsets ? ` · ${(offsets[hover] * 1000).toFixed(1)} mm` : '')
          : t(inserting ? 'align_chart_insert_hint' : 'align_chart_hint')}
      </div>
    </div>
  )
}
