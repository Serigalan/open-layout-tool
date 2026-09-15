import { useEffect, useRef, useState } from 'react'
import { loadTracks, loadSwitches, setTrackHeights, setHeightsForTracks } from '../storage'
import {
  trackProfile, adjacentTracks, neighbourStub, jointHeightUpdates, verticalCurves, elementAtStation,
} from '../utils/heightUtils'
import { filterForElements, FILTER_NONE, mapIsLive } from '../utils/mapConstants'

const SELECTED_LAYER = 'tracks-selected-layer'
const EXAGGERATIONS  = [1, 2, 5, 10, 20]
const MARGIN = { left: 60, right: 20, top: 30, bottom: 32 }
const MIN_OVERLAY_PX = 140
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]

/** Smallest round step that is at least `minPx` wide at `pxPerUnit`. */
const niceStep = (minPx, pxPerUnit) => STEPS.find(s => s * pxPerUnit >= minPx) ?? STEPS[STEPS.length - 1]
const decimals = (step) => (step < 1 ? (step < 0.2 ? 2 : 1) : 0)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
// Narrower than this and the gradient label would not fit between its points.
const GRADE_LABEL_MIN_PX = 46
/** A gradient in ‰, signed — a rise is written with its plus, a level stretch as 0. */
const gradeLabel = (perMille) => {
  const v = Number(perMille.toFixed(1)) || 0   // ... and never as "-0.0"
  return `${v > 0 ? '+' : ''}${v.toFixed(1)} ‰`
}

/**
 * Longitudinal profile of one track: stations at 1:1, heights exaggerated
 * (10× by default), zoomable and pannable.
 *
 * The vertical alignment is the track's own — its height points are stationed
 * along the track and sit wherever the design puts them, not on the horizontal
 * elements, whose boundaries are drawn only as a backdrop. The tracks joined
 * at either end show their first stretch beyond the joint; the point where
 * they meet is one point, so it moves on every track meeting there — over a
 * switch too.
 *
 * Clicking a point opens its height for editing, Ctrl/Shift-click and
 * Shift-drag pick more of them. A point may carry the radius of the vertical
 * curve rounding the gradient change there — drawn in light grey between its
 * tangent points. Every stretch is labelled with its gradient in ‰. Any point
 * but the two ends of the track can be deleted.
 */
// `version` is passed by the parent purely to re-render this after a write to
// the store — the profile is read from the store on every render.
export default function ElevationOverlay({ trackId, project, map, onClose, onSaved, t }) {
  const tracks   = loadTracks(project.id)
  const switches = loadSwitches(project.id)
  const track    = tracks.find(tr => tr.id === trackId)

  const [exaggeration, setExaggeration] = useState(10)
  const [size, setSize]         = useState(null)     // { w, h } of the drawing area
  const [view, setView]         = useState(null)     // { k, x0, z0 }: px per m, station at the left edge, height at the bottom edge
  const [selection, setSelection] = useState([])   // indices of the height points being edited
  const [draft, setDraft]       = useState('')
  const [rvDraft, setRvDraft]   = useState('')     // vertical curve radius of the selection
  const [band, setBand]         = useState(null)     // rubber band { x0, y0, x1, y1 } while Shift-dragging
  const [heightPx, setHeightPx] = useState(null)     // overlay height once the user dragged it
  const [dragging, setDragging] = useState(false)
  const bodyRef = useRef(null)
  const svgRef  = useRef(null)
  const panRef  = useRef(null)

  // ── Data: the track's own profile and the stubs of the joined tracks ──────
  // Recomputed on every render — it is a few hundred numbers, and `version`
  // re-renders us after each write to the store.
  const profile = track ? trackProfile(track) : null
  const points  = profile?.points ?? []
  const stubs = track ? [['BEGIN', -1, 0], ['END', 1, profile.length]].flatMap(([end, sign, origin]) =>
    adjacentTracks(tracks, switches, track, end).map(n => ({
      name:   n.track.name || n.track.id.slice(0, 8),
      points: neighbourStub(n).map(p => ({ station: origin + sign * p.d, z: p.z })),
    })).filter(s => s.points.length === 2),
  ) : []
  const allPoints = [...points, ...stubs.flatMap(s => s.points)]
  // The curves rounding the gradient changes.
  const curves = verticalCurves(points)

  // ── Drawing area size ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Fit the view to the data when the track or the exaggeration changes ───
  const plotW = size ? size.w - MARGIN.left - MARGIN.right : 0
  const plotH = size ? size.h - MARGIN.top - MARGIN.bottom : 0
  const [fitKey, setFitKey] = useState(null)
  // Re-fitted for another track or exaggeration, once the area is measured,
  // and when points appear or go (the terrain fill arriving, a reload) — not
  // for an edited height, which must not throw the view around.
  const wantFit = `${trackId}|${exaggeration}|${size ? 1 : 0}|${allPoints.length}`
  if (size && allPoints.length && fitKey !== wantFit) {
    const stations = allPoints.map(p => p.station), zs = allPoints.map(p => p.z)
    const sMin = Math.min(...stations), sMax = Math.max(...stations)
    const zMin = Math.min(...zs), zMax = Math.max(...zs)
    const ds = Math.max(sMax - sMin, 10), dz = Math.max(zMax - zMin, 1)
    const k = Math.min(plotW / ds, plotH / (dz * exaggeration)) * 0.85
    setView({
      k,
      x0: sMin - (plotW / k - ds) / 2,
      z0: zMin - (plotH / (k * exaggeration) - dz) / 2,
    })
    setFitKey(wantFit)
  }
  const [activeKey, setActiveKey] = useState(trackId)
  if (activeKey !== trackId) { setActiveKey(trackId); setSelection([]); setDraft(''); setRvDraft('') }

  // ── Map: the elements the selected points sit on, in red ──────────────────
  // A height point belongs to the track, not to an element; the element it
  // happens to fall in is what the map can show.
  // Kept as a string so the effect runs on a changed set, not on every render.
  const selectedElementsKey = [...new Set(selection
    .map(i => elementAtStation(track?.elements, points[i]?.station ?? 0)?.elIdx)
    .filter(i => i != null))].sort((a, b) => a - b).join(',')
  useEffect(() => {
    const m = map?.current
    if (!m?.getLayer(SELECTED_LAYER)) return
    const idx = selectedElementsKey ? selectedElementsKey.split(',').map(Number) : []
    m.setFilter(SELECTED_LAYER, idx.length ? filterForElements(trackId, idx) : FILTER_NONE)
    return () => { if (mapIsLive(map, m) && m.getLayer(SELECTED_LAYER)) m.setFilter(SELECTED_LAYER, FILTER_NONE) }
  }, [map, trackId, selectedElementsKey])

  // ── Zoom about the cursor (both axes, the exaggeration stays) ─────────────
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !size) return
    const onWheel = (e) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const px = e.clientX - rect.left, py = e.clientY - rect.top
      setView(v => {
        if (!v) return v
        const k  = clamp(v.k * Math.exp(-e.deltaY * 0.0015), 1e-4, 1e4)
        const s  = v.x0 + (px - MARGIN.left) / v.k
        const z  = v.z0 + (size.h - MARGIN.bottom - py) / (v.k * exaggeration)
        return { k, x0: s - (px - MARGIN.left) / k, z0: z - (size.h - MARGIN.bottom - py) / (k * exaggeration) }
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [size, exaggeration])

  // ── Pan by dragging, pick a group of points with Shift ────────────────────
  // A drag that stays put is a click on the background: it drops the selection.
  const svgXY = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const onPointerDown = (e) => {
    if (e.button !== 0 || !view) return
    const { x, y } = svgXY(e)
    panRef.current = { x: e.clientX, y: e.clientY, view, band: e.shiftKey, add: e.ctrlKey || e.metaKey, moved: false }
    if (e.shiftKey) setBand({ x0: x, y0: y, x1: x, y1: y })
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(!e.shiftKey)
  }
  const onPointerMove = (e) => {
    const p = panRef.current
    if (!p) return
    if (Math.abs(e.clientX - p.x) > 2 || Math.abs(e.clientY - p.y) > 2) p.moved = true
    if (p.band) { const { x, y } = svgXY(e); setBand(b => b && { ...b, x1: x, y1: y }); return }
    const { k, x0, z0 } = p.view
    setView({ k, x0: x0 - (e.clientX - p.x) / k, z0: z0 + (e.clientY - p.y) / (k * exaggeration) })
  }
  const onPointerUp = () => {
    const p = panRef.current
    panRef.current = null
    setDragging(false)
    setBand(null)
    if (!p) return
    if (p.band && band) selectInBand(band, p.add)
    else if (!p.moved) select([])
  }

  /** Every point of the track inside the rubber band, added to or replacing the selection. */
  const selectInBand = (b, add) => {
    const [xLo, xHi] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)]
    const [yLo, yHi] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)]
    const hit = points.filter(p => {
      const x = X(p.station), y = Y(p.z)
      return x >= xLo && x <= xHi && y >= yLo && y <= yHi
    }).map(p => p.index)
    if (!hit.length && !add) return select([])
    select(add ? [...new Set([...selection, ...hit])] : hit)
  }

  // ── Resize the overlay by its top edge ────────────────────────────────────
  const onResizeStart = (e) => {
    const startY = e.clientY, startH = bodyRef.current?.parentElement?.clientHeight ?? 300
    const maxH = (bodyRef.current?.parentElement?.parentElement?.clientHeight ?? 800) - 80
    const move = (ev) => setHeightPx(clamp(startH + (startY - ev.clientY), MIN_OVERLAY_PX, maxH))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    e.preventDefault()
  }

  // ── Selecting points, editing and deleting them ───────────────────────────
  const isSelected = (p) => selection.includes(p.index)
  const selectedPoints = points.filter(isSelected)
  // The drafts follow the selection: the common height and curve radius, or
  // empty when they differ (and for the radius, when there is none).
  const common = (vs) => (vs.length && vs.every(v => v === vs[0]) && vs[0] != null ? String(vs[0]) : '')
  const select = (indices) => {
    setSelection(indices)
    const picked = points.filter(p => indices.includes(p.index))
    setDraft(common(picked.map(p => p.z)))
    setRvDraft(common(picked.map(p => p.rv)))
  }
  const rvMixed = selectedPoints.some(p => p.rv !== selectedPoints[0]?.rv)
  /** Click picks one point, Ctrl/Shift-click adds it to or drops it from the selection. */
  const pick = (p, e) => {
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) return select([p.index])
    select(isSelected(p) ? selection.filter(i => i !== p.index) : [...selection, p.index])
  }

  const commit = () => {
    if (!track || !selectedPoints.length) return
    // An empty field is the mixed values of the selection — it changes nothing.
    // A radius of 0 takes the vertical curve away.
    const patch = {}
    if (draft.trim())   { const z  = Number(draft);   if (!Number.isFinite(z))  return; patch.z  = z }
    if (rvDraft.trim()) { const rv = Number(rvDraft); if (!Number.isFinite(rv)) return; patch.rv = rv > 0 ? rv : null }
    if (!Object.keys(patch).length) return
    // Where tracks meet there is one point, whatever its index is on each of
    // them: it moves on all of them — over a switch too.
    const entries = selectedPoints.map(p => ({ trackId: track.id, index: p.index, ...patch }))
    setHeightsForTracks(project.id, jointHeightUpdates(tracks, switches, entries))
    onSaved?.()
  }

  // Only the two ends of the track have to stay: they are where its height
  // meets the tracks joined to it.
  const isInner = (p) => p.index > 0 && p.index < points.length - 1
  const deletable = selectedPoints.filter(isInner)
  const remove = () => {
    if (!track || !deletable.length) return
    const drop = new Set(deletable.map(p => p.index))
    setTrackHeights(project.id, track.id, (track.heights ?? []).filter((_, i) => !drop.has(i)))
    select([])
    onSaved?.()
  }

  if (!track) return null

  // ── Geometry helpers ──────────────────────────────────────────────────────
  const X = (station) => MARGIN.left + (station - view.x0) * view.k
  const Y = (z) => size.h - MARGIN.bottom - (z - view.z0) * view.k * exaggeration
  const typeLabel = (el) => {
    if (el.elementType === 2) return t(el.transitionType === 'bloss' ? 'table_type_bloss' : 'table_type_transition')
    if (el.radius != null) return `R ${Math.round(Math.abs(el.radius))}`
    return t('table_type_straight')
  }

  const drawing = () => {
    if (!size || !view) return null
    const right = size.w - MARGIN.right, bottom = size.h - MARGIN.bottom
    const sStep = niceStep(70, view.k), zStep = niceStep(26, view.k * exaggeration)
    const sFrom = Math.ceil((view.x0) / sStep) * sStep
    const sTo   = view.x0 + plotW / view.k
    const zFrom = Math.ceil(view.z0 / zStep) * zStep
    const zTo   = view.z0 + plotH / (view.k * exaggeration)
    const sTicks = [], zTicks = []
    for (let s = sFrom; s <= sTo; s += sStep) sTicks.push(s)
    for (let z = zFrom; z <= zTo; z += zStep) zTicks.push(z)

    // Gradient of every stretch in ‰, at its middle — left out where the label
    // would not fit between the two points.
    const grades = []
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]
      const run = b.station - a.station
      if (!(run > 0)) continue
      const x1 = X(a.station), x2 = X(b.station)
      if (x2 - x1 < GRADE_LABEL_MIN_PX) continue
      grades.push({ x: (x1 + x2) / 2, y: (Y(a.z) + Y(b.z)) / 2, grade: (b.z - a.z) / run * 1000 })
    }

    let lastLabelX = -Infinity
    const labelled = points.filter(p => {
      const x = X(p.station)
      if (x - lastLabelX < 44) return false
      lastLabelX = x
      return true
    })

    return (
      <svg ref={svgRef} className={`profile-svg${dragging ? ' dragging' : ''}`} width={size.w} height={size.h}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <defs>
          <clipPath id="profile-clip"><rect x={MARGIN.left} y={MARGIN.top} width={plotW} height={plotH} /></clipPath>
        </defs>
        {/* grid */}
        {sTicks.map(s => <line key={`gs${s}`} x1={X(s)} x2={X(s)} y1={MARGIN.top} y2={bottom} stroke="#eee" />)}
        {zTicks.map(z => <line key={`gz${z}`} x1={MARGIN.left} x2={right} y1={Y(z)} y2={Y(z)} stroke="#eee" />)}
        {/* axes */}
        <line x1={MARGIN.left} x2={right} y1={bottom} y2={bottom} stroke="#999" />
        <line x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={bottom} stroke="#999" />
        {sTicks.map(s => (
          <text key={`ts${s}`} x={X(s)} y={bottom + 16} fontSize="11" fill="#555" textAnchor="middle">{s.toFixed(decimals(sStep))}</text>
        ))}
        {zTicks.map(z => (
          <text key={`tz${z}`} x={MARGIN.left - 6} y={Y(z) + 4} fontSize="11" fill="#555" textAnchor="end">{z.toFixed(decimals(zStep))}</text>
        ))}
        <text x={right} y={bottom + 28} fontSize="11" fill="#888" textAnchor="end">{t('elevation_station')} [m]</text>
        <text x={MARGIN.left - 6} y={MARGIN.top - 12} fontSize="11" fill="#888" textAnchor="end">{t('elevation_height')} [m]</text>

        <g clipPath="url(#profile-clip)">
          {/* element boundaries */}
          {[...profile.boundaries, { station: profile.length }].map((b, i) => (
            <g key={`b${i}`}>
              <line x1={X(b.station)} x2={X(b.station)} y1={MARGIN.top} y2={bottom} stroke="#c8c8d8" strokeDasharray="3 3" />
              {b.el && <text x={X(b.station) + 3} y={MARGIN.top + 11} fontSize="10" fill="#777">{typeLabel(b.el)}</text>}
            </g>
          ))}
          {/* joined tracks */}
          {stubs.map((s, i) => {
            const [a, b] = s.points
            return (
              <g key={`n${i}`}>
                <line x1={X(a.station)} y1={Y(a.z)} x2={X(b.station)} y2={Y(b.z)} stroke="#999" strokeWidth="2" strokeDasharray="6 4" />
                <circle cx={X(b.station)} cy={Y(b.z)} r="3" fill="#fff" stroke="#999" strokeWidth="1.5" />
                <text x={X(b.station)} y={Y(b.z) - 8} fontSize="10" fill="#777" textAnchor="middle">{s.name}</text>
              </g>
            )
          })}
          {/* the vertical curves rounding the gradient changes */}
          {curves.map((c, i) => (
            <polyline key={`vc${i}`} fill="none" stroke="#c9c9c9" strokeWidth="2"
              points={c.map(p => `${X(p.station)},${Y(p.z)}`).join(' ')} />
          ))}
          {/* the track */}
          <polyline fill="none" stroke="var(--color-primary)" strokeWidth="2"
            points={points.map(p => `${X(p.station)},${Y(p.z)}`).join(' ')} />
          {grades.map((g, i) => (
            <text key={`g${i}`} x={g.x} y={g.y + 14} fontSize="10" fill="#888" textAnchor="middle">
              {gradeLabel(g.grade)}
            </text>
          ))}
          {labelled.map(p => (
            <text key={`l${p.index}`} x={X(p.station)} y={Y(p.z) - 9} fontSize="10" fill="#333" textAnchor="middle">
              {p.z.toFixed(2)}{p.rv != null && <tspan fill="#777"> R{Math.round(p.rv)}</tspan>}
            </text>
          ))}
          {points.map(p => {
            const on = isSelected(p)
            return (
              <circle key={`p${p.index}`} cx={X(p.station)} cy={Y(p.z)} r={on ? 5.5 : 3.5}
                fill={on ? '#a52a1f' : '#fff'} stroke={on ? '#a52a1f' : 'var(--color-primary)'} strokeWidth="2"
                style={{ cursor: 'pointer' }}
                onPointerDown={e => e.stopPropagation()} onClick={e => pick(p, e)} />
            )
          })}
        </g>
        {band && (
          <rect x={Math.min(band.x0, band.x1)} y={Math.min(band.y0, band.y1)}
            width={Math.abs(band.x1 - band.x0)} height={Math.abs(band.y1 - band.y0)}
            fill="rgba(165,42,31,0.08)" stroke="#a52a1f" strokeDasharray="4 3" />
        )}
      </svg>
    )
  }

  return (
    <div className="profile-overlay" style={heightPx ? { height: heightPx } : undefined}>
      <div className="profile-resize" onPointerDown={onResizeStart} />
      <div className="track-table-header">
        <span className="track-table-title">{track.name || track.id.slice(0, 8)}</span>
        <div className="profile-controls">
          {selectedPoints.length ? (
            <div className="profile-edit">
              <span>{selectedPoints.length === 1
                ? `${t('elevation_station')} ${selectedPoints[0].station.toFixed(2)} m`
                : t('elevation_selected').replace('{{n}}', selectedPoints.length)}</span>
              <input className="track-table-input" type="number" step="0.01" value={draft} autoFocus
                placeholder={t('elevation_mixed')}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') select([]) }} />
              <span>m</span>
              <span title={t('elevation_vcurve_hint')}>{t('elevation_vcurve')}</span>
              <input className="track-table-input" type="number" step="100" min="0" value={rvDraft}
                placeholder={rvMixed ? t('elevation_mixed') : '–'} title={t('elevation_vcurve_hint')}
                onChange={e => setRvDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') select([]) }} />
              <span>m</span>
              <button className="track-table-save-btn" onClick={commit}>{t('elevation_apply')}</button>
              <button className="track-table-save-btn profile-delete-btn" disabled={!deletable.length}
                title={t('elevation_delete_hint')} onClick={remove}>
                {t('elevation_delete').replace('{{n}}', deletable.length)}
              </button>
              <button className="track-table-close" onClick={() => select([])}>✕</button>
            </div>
          ) : (
            <span className="profile-hint">{t('elevation_hint_edit')}</span>
          )}
          <label className="profile-edit">
            {t('elevation_exaggeration')}
            <select className="settings-select" value={exaggeration} onChange={e => setExaggeration(Number(e.target.value))}>
              {EXAGGERATIONS.map(x => <option key={x} value={x}>{x}×</option>)}
            </select>
          </label>
          <button className="track-table-close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="profile-body" ref={bodyRef}>
        {allPoints.length === 0
          ? <div className="profile-empty">{t('elevation_no_heights')}</div>
          : drawing()}
      </div>
    </div>
  )
}
