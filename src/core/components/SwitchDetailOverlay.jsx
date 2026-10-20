import { useMemo, useRef, useState } from 'react'
import { loadSwitches, loadTracks } from '../storage'
import { formDetail, switchDetailScene, switchTypeByLabel } from '../utils/switch'
import { useI18n } from '../locales/i18nContext'
import { useProject } from '../hooks/useStore'
import { PALETTE } from '../styles/palette'
import CloseButton from './form/CloseButton'
import InfoTip from './form/InfoTip'
import { useDrag, useElementSize, useOverlayHeight, useWheelZoom } from './chart/useChartViewport'

/** Width of a sleeper as drawn [m] — a B70 at its foot. */
const SLEEPER_WIDTH = 0.30
/** Width of a rail as drawn [m] — its head; never under RAIL_MIN_PX. */
const RAIL_WIDTH = 0.07
const RAIL_MIN_PX = 1.2
const PAD = 24          // px around the drawing when it is fitted
const HOVER_PX = 6      // px a pointer may lie off a sleeper and still be on it

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1]

/** Distance from p to the segment a–b. */
function segmentDistance(p, a, b) {
  const ab = sub(b, a), ap = sub(p, a)
  const len2 = dot(ab, ab)
  const t = len2 > 0 ? Math.max(0, Math.min(1, dot(ap, ab) / len2)) : 0
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t)
}

/**
 * A turnout in detail (Paket WD, decision 341): its sleepers as thick grey
 * strokes with an edge, its rails 0.75 m beside both axes, to scale — WA on
 * the left, the main track level, the branch above it. The sleepers outside
 * WA–ldS (the brackets of the table's sleeper count, decision 347) are drawn
 * the same way. The wheel zooms, a drag moves the drawing; a sleeper under the
 * pointer says which it is and where it lies.
 *
 * Around a laid turnout the drawing shows its surroundings (switch/detailScene):
 * the turnouts joined to it in a switch connection, in full detail and fitted
 * into the view with it, the other turnouts close by, and the tracks there as
 * their rails. A switch in the header turns them off.
 *
 * `switchId` names a laid turnout, `formLabel` (with `rail`) a catalogue form
 * shown on helper tracks instead.
 */
export default function SwitchDetailOverlay({ switchId = null, formLabel = null, rail = null, onClose }) {
  const { t, fill, num } = useI18n()
  const project = useProject()
  const bodyRef = useRef(null)
  const overlay = useOverlayHeight(bodyRef, { min: 160 })
  const size = useElementSize(bodyRef)

  const [surroundings, setSurroundings] = useState(true)
  const shown = useMemo(() => {
    if (formLabel) {
      const form = switchTypeByLabel(formLabel)
      return form ? { name: null, detail: formDetail(form, { rail }), scene: null } : null
    }
    if (!project) return null
    const switches = loadSwitches()
    const sw = switches.find(s => s.switchId === switchId)
    if (!sw) return null
    // The variant follows from the main track's rail at WA (switch/sleepers).
    const scene = switchDetailScene(loadTracks(), switches, sw)
    return { name: sw.name ?? null, detail: scene?.detail ?? null, scene }
    // `project` is the store's live record: a change to the tracks redraws.
  }, [project, switchId, formLabel, rail])
  const detail = shown?.detail ?? null
  const scene = surroundings ? shown?.scene ?? null : null
  // The other turnouts drawn: the partners in a switch connection first.
  const others = scene ? [...scene.partners, ...scene.nearby] : []

  // The box the view is fitted to: the turnout, and its partners with it.
  const bounds = useMemo(() => {
    if (!detail) return null
    if (scene) return scene.focus
    const pts = [...detail.sleepers.flatMap(s => s.ends), ...detail.rails.flatMap(r => r.points)]
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
  }, [detail, scene])

  // The view: k px per metre, (ox, oy) where the origin (WA) lies on screen —
  // for the turnout it was set on; another one is shown fitted.
  const viewKey = `${switchId}|${formLabel}|${rail}|${surroundings}`
  const [moved, setMoved] = useState(null)
  const view = moved?.key === viewKey ? moved : null
  const setView = (next) => setMoved(next && { ...next, key: viewKey })
  const fitted = useMemo(() => {
    if (!bounds || !size) return null
    const k = Math.min((size.w - 2 * PAD) / Math.max(1, bounds.x1 - bounds.x0), (size.h - 2 * PAD) / Math.max(1, bounds.y1 - bounds.y0))
    return {
      k,
      ox: (size.w - (bounds.x1 - bounds.x0) * k) / 2 - bounds.x0 * k,
      oy: (size.h + (bounds.y1 - bounds.y0) * k) / 2 + bounds.y0 * k,
    }
  }, [bounds, size])
  const v = view ?? fitted

  useWheelZoom(bodyRef, (f, px, py) => {
    if (!v) return
    const k = Math.max(0.5, Math.min(400, v.k * f))
    setView({ k, ox: px - (px - v.ox) * (k / v.k), oy: py - (py - v.oy) * (k / v.k) })
  }, Boolean(v))
  const drag = useDrag({
    onStart: () => (v ? { ox: v.ox, oy: v.oy, k: v.k } : null),
    onMove: (e, start, d) => setView({ k: start.k, ox: start.ox + d.dx, oy: start.oy + d.dy }),
  })

  const [hover, setHover] = useState(null)
  const onPointerMove = (e) => {
    drag.handlers.onPointerMove(e)
    if (!v || !detail || drag.dragging) return
    const rect = e.currentTarget.getBoundingClientRect()
    const p = [(e.clientX - rect.left - v.ox) / v.k, -(e.clientY - rect.top - v.oy) / v.k]
    let best = null, bestD = Infinity
    for (const owner of [detail, ...others]) {
      for (const s of owner.sleepers) {
        const d = segmentDistance(p, s.ends[0], s.ends[1])
        if (d < bestD) { best = { ...s, owner, key: s }; bestD = d }
      }
    }
    setHover(bestD <= SLEEPER_WIDTH / 2 + HOVER_PX / v.k ? best : null)
  }

  const sx = (p) => v.ox + p[0] * v.k
  const sy = (p) => v.oy - p[1] * v.k

  /** A sleeper as the polygon it covers on screen, SLEEPER_WIDTH wide (at least 1.5 px). */
  const sleeperPolygon = (s) => {
    const a = [sx(s.ends[0]), sy(s.ends[0])], b = [sx(s.ends[1]), sy(s.ends[1])]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const h = Math.max(0.75, SLEEPER_WIDTH * v.k / 2)
    const n = [-(b[1] - a[1]) / len * h, (b[0] - a[0]) / len * h]
    return [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]]
      .map(q => q.map(c => c.toFixed(1)).join(',')).join(' ')
  }

  const variant = detail?.variant
  const title = shown?.name ?? detail?.form?.label ?? formLabel ?? ''
  const subtitle = !detail ? '' : [
    shown?.name ? detail.form?.label : null,
    variant
      ? fill('switch_detail_variant', {
        nr: variant.nr, name: variant.bezeichnung, profil: variant.profil,
        schwellen: variant.schwellen
          ? t(variant.schwellen === 'holz' ? 'constraints_weichen_var_holz' : 'constraints_weichen_var_beton') : '–',
      })
      : t('switch_detail_no_variant'),
    fill('switch_detail_counts', {
      through: detail.counts.throughSleepers, before: detail.counts.before,
      main: detail.counts.behindMain, branch: detail.counts.behindBranch,
    }),
  ].filter(Boolean).join(' · ')

  const m = (x) => num(x, { digits: 2 })
  const hoverText = (s) => {
    const own = s.owner === detail ? '' : `${s.owner.sw.name ?? s.owner.form?.label ?? ''}: `
    return own + sleeperText(s)
  }
  const sleeperText = (s) => {
    if (s.kind === 'before') return fill('switch_detail_sleeper_before', { m: m(-s.m) })
    if (s.kind === 'main' || s.kind === 'branch') {
      return fill(s.kind === 'main' ? 'switch_detail_sleeper_main' : 'switch_detail_sleeper_branch', { k: s.k })
    }
    const where = fill(s.kind === 'lds' ? 'switch_detail_sleeper_lds' : 'switch_detail_sleeper', { k: s.k + 1, m: m(s.m) })
    return formLabel ? where
      : `${where} · ${fill('switch_detail_stations', { main: num(s.main, { digits: 3 }), branch: num(s.branch, { digits: 3 }) })}`
  }

  // WM and the ldS on the axes; WA and WE are rail joints, a point on each
  // rail, named once beside the pair (decision 349). Another turnout is named
  // at its WA.
  const marksOf = (d) => [
    ['WM', d.marks.WM], ['ldS', d.marks.ldS.main], ['ldS', d.marks.ldS.branch],
  ].filter(([, p]) => p)
  const jointsOf = (d, name = null) => [
    [name ? `WA ${name}` : 'WA', d.marks.joints.WA], ...d.marks.joints.WE.map(pair => ['WE', pair]),
  ]
  const points = (pts) => pts.map(p => `${sx(p).toFixed(1)},${sy(p).toFixed(1)}`).join(' ')

  /** One turnout's sleepers, rails and marks. */
  const drawn = (d, key, name = null) => (
    <g key={key} className={name ? 'switch-detail-other' : undefined}>
      {d.sleepers.map((s, i) => (
        <polygon key={i} points={sleeperPolygon(s)}
          fill={hover?.key === s ? PALETTE.mapHover : PALETTE.sleeper} stroke={PALETTE.sleeperEdge} strokeWidth={1} />
      ))}
      {d.rails.map((r, i) => (
        <polyline key={i} fill="none" stroke={PALETTE.rail} strokeWidth={Math.max(RAIL_MIN_PX, RAIL_WIDTH * v.k)}
          strokeLinejoin="round" points={points(r.points)} />
      ))}
      {marksOf(d).map(([label, p], i) => (
        <g key={i}>
          <circle cx={sx(p)} cy={sy(p)} r={3} fill={PALETTE.primaryDefault} />
          <text x={sx(p)} y={sy(p) - 7} textAnchor="middle" className="switch-detail-mark">{label}</text>
        </g>
      ))}
      {jointsOf(d, name).map(([label, pair], i) => {
        // Named above the upper of the two rails.
        const top = pair.reduce((a, b) => (sy(b) < sy(a) ? b : a))
        return (
          <g key={`j${i}`}>
            {pair.map((p, j) => <circle key={j} cx={sx(p)} cy={sy(p)} r={3.5} fill={PALETTE.mapSelected} />)}
            <text x={sx(top)} y={sy(top) - 8} textAnchor="middle" className="switch-detail-mark">{label}</text>
          </g>
        )
      })}
    </g>
  )

  return (
    <div className="track-table-overlay switch-detail-overlay" style={overlay.style}>
      <div className="profile-resize" onPointerDown={overlay.onResizeStart} />
      <div className="track-table-header">
        <span className="track-table-title">
          {t('switch_detail')}{title ? ` · ${title}` : ''}
          <span className="track-table-subtitle">{hover ? hoverText(hover) : subtitle}</span>
        </span>
        <span className="switch-detail-tools">
          {shown?.scene && (
            <label className="switch-detail-toggle">
              <input type="checkbox" checked={surroundings} onChange={e => setSurroundings(e.target.checked)} />
              {t('switch_detail_surroundings')}
            </label>
          )}
          <button type="button" className="panel-btn" onClick={() => setView(null)} disabled={!view}>{t('switch_detail_fit')}</button>
          <InfoTip text={t('switch_detail_overlay_hint')} />
          <CloseButton onClick={onClose} />
        </span>
      </div>
      <div className="switch-detail-body" ref={bodyRef}>
        {!detail && <p className="selecting-hint">{shown ? t('switch_detail_none') : t('switch_detail_gone')}</p>}
        {detail && v && size && (
          <svg width={size.w} height={size.h} className={drag.dragging ? 'is-dragging' : undefined}
            {...drag.handlers} onPointerMove={onPointerMove} onPointerLeave={() => setHover(null)}>
            {scene?.tracks.map((run, i) => run.rails.map((rail, j) => (
              <polyline key={`t${i}-${j}`} fill="none" stroke={PALETTE.axis} strokeWidth={1}
                strokeLinejoin="round" points={points(rail)} />
            )))}
            {others.map((d, i) => drawn(d, `o${i}`, d.sw.name ?? d.form?.label ?? '?'))}
            {drawn(detail, 'main')}
          </svg>
        )}
      </div>
    </div>
  )
}
