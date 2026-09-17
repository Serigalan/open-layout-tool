import { useEffect, useRef, useState } from 'react'
import { loadTracks } from '../storage'
import {
  crossSection, fitSection, superstructureAt, sectionStates, elementStartStation, RAILS, SLEEPERS,
} from '../utils/crossSectionUtils'
import { gaugeProfile, gaugeProfileRing, DEFAULT_GAUGE_PROFILE } from '../utils/gaugeProfiles'

const MARGIN = 28
/** Length of the tick marking a rail inner face [mm in the track frame]. */
const FACE_TICK = 250
const MIN_OVERLAY_PX = 160
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * The cross section of one element, drawn to scale: the running plane with its
 * two running circles, the rail inner faces, and the clearance contour over
 * them — all turned by the element's cant, because the contour is fixed to the
 * track and leans with it.
 *
 * Nothing here is editable. The section is a view of the alignment; what it
 * shows is changed by changing the element (see CrossSectionPanel).
 */
export default function CrossSectionOverlay({ at, project, onClose, t }) {
  const [size, setSize] = useState(null)
  const [heightPx, setHeightPx] = useState(null)
  const [stateId, setStateId] = useState(null)
  const bodyRef = useRef(null)

  const track = loadTracks(project.id).find(tr => tr.id === at.trackId)
  const el    = track?.elements?.[at.elIdx]

  useEffect(() => {
    const node = bodyRef.current
    if (!node) return
    const measure = () => setSize({ w: node.clientWidth, h: node.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const onResizeStart = (e) => {
    const startY = e.clientY, startH = bodyRef.current?.parentElement?.clientHeight ?? 320
    const maxH = (bodyRef.current?.parentElement?.parentElement?.clientHeight ?? 800) - 80
    const move = (ev) => setHeightPx(clamp(startH + (startY - ev.clientY), MIN_OVERLAY_PX, maxH))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    e.preventDefault()
  }

  if (!track || !el) return null

  const states = sectionStates(el, elementStartStation(track, at.elIdx))
  const state  = states.find(s => s.id === stateId) ?? states[0]
  const { rail, sleeper } = superstructureAt(track, state.station)
  const profile = gaugeProfile(project.gaugeProfile ?? DEFAULT_GAUGE_PROFILE)
  const section = crossSection({
    cant: state.cant, gaugeRing: gaugeProfileRing(profile.points), rail, sleeper,
  })

  const drawing = () => {
    if (!size || size.w < 40 || size.h < 40) return null
    const all = [...section.gauge, ...section.runningCircles, ...section.sleeper]
    const { k, cx, cy, bounds } = fitSection(all, size, MARGIN)
    const { zMax } = bounds
    const X = (y) => cx + y * k
    const Y = (z) => cy - z * k
    const path = (pts) => pts.map(([y, z], i) => `${i ? 'L' : 'M'}${X(y)},${Y(z)}`).join(' ')
    const [leftCircle, rightCircle] = section.runningCircles
    const [leftFace, rightFace] = section.railFaces

    return (
      <svg width={size.w} height={size.h} className="cross-section-svg">
        {/* the horizontal, so the cant is visible as the angle it is */}
        <line x1={MARGIN / 2} x2={size.w - MARGIN / 2} y1={Y(0)} y2={Y(0)} stroke="#e4e4ec" strokeDasharray="6 4" />
        {/* the clearance contour */}
        <path d={`${path(section.gauge)} Z`} fill="rgba(108,92,231,0.07)" stroke="var(--color-primary)" strokeWidth="1.5" />
        {/* the superstructure carrying it */}
        {section.sleeper.length > 0 && (
          <path d={`${path(section.sleeper)} Z`} fill="#d9d4cc" stroke="#8d867a" strokeWidth="1" />
        )}
        {section.rails.map((r, i) => (
          <path key={`r${i}`} d={`${path(r)} Z`} fill="#6b6b6b" stroke="#333" strokeWidth="1" />
        ))}
        {/* the running plane between the running circles */}
        <line x1={X(leftCircle[0])} y1={Y(leftCircle[1])} x2={X(rightCircle[0])} y2={Y(rightCircle[1])}
          stroke="#333" strokeWidth="2" />
        {/* where the gauge is measured — as ticks, because at this scale the
            32.5 mm between face and running circle is a hair's breadth */}
        {[leftFace, rightFace].map(([y, z], i) => {
          const [ty, tz] = [y - Math.sin(section.angle) * FACE_TICK, z + Math.cos(section.angle) * FACE_TICK]
          return <line key={`f${i}`} x1={X(y)} y1={Y(z)} x2={X(ty)} y2={Y(tz)} stroke="#333" strokeWidth="1.5" />
        })}
        {[leftCircle, rightCircle].map(([y, z], i) => (
          <circle key={`c${i}`} cx={X(y)} cy={Y(z)} r="3.5" fill="#a52a1f" />
        ))}
        <text x={X(0)} y={Y(zMax) - 8} fontSize="11" fill="#777" textAnchor="middle">{profile.label}</text>
      </svg>
    )
  }

  const stateLabel = (s) => t(s.id === 'start' ? 'cross_section_at_start' : 'cross_section_at_end')

  return (
    <div className="profile-overlay" style={heightPx ? { height: heightPx } : undefined}>
      <div className="profile-resize" onPointerDown={onResizeStart} />
      <div className="track-table-header">
        <span className="track-table-title">
          {`${track.name || track.id.slice(0, 8)} · ${t('cross_section_element')} ${at.elIdx + 1}`}
        </span>
        <div className="profile-controls">
          <span className="profile-hint">
            {`${t('cant')} ${state.cant} mm`}
            {state.radius != null ? ` · R ${Math.round(Math.abs(state.radius))} m` : ` · ${t('table_type_straight')}`}
            {` · ${RAILS[rail]?.label ?? rail} · ${SLEEPERS[sleeper]?.label ?? sleeper}`}
          </span>
          {states.length > 1 && (
            <label className="profile-edit">
              <select className="settings-select" value={state.id} onChange={e => setStateId(e.target.value)}>
                {states.map(s => <option key={s.id} value={s.id}>{stateLabel(s)}</option>)}
              </select>
            </label>
          )}
          <button className="track-table-close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="profile-body" ref={bodyRef}>{drawing()}</div>
    </div>
  )
}
