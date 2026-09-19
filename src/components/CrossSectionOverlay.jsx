import { useEffect, useRef, useState } from 'react'
import { loadTracks, loadPlatforms } from '../storage'
import { trackLength } from '../utils/heightUtils'
import { utmToWgs84 } from '../utils/coordinateUtils'
import { pointAtStation } from '../utils/platformUtils'
import { PLATFORM_FILL_COLOR, PLATFORM_OUTLINE_COLOR } from '../utils/mapRenderUtils'
import {
  crossSection, fitSection, superstructureAt, sectionAtStation, platformSection, RAILS, SLEEPERS,
} from '../utils/crossSectionUtils'
import {
  gaugeProfile, gaugeProfileRing, gaugeProfileGuides, DEFAULT_GAUGE_PROFILE,
} from '../utils/gaugeProfiles'
import usePreviewLayers from '../hooks/usePreviewLayers'

const MARGIN = 28
/** Length of the tick marking a rail inner face [mm in the track frame]. */
const FACE_TICK = 250
const MIN_OVERLAY_PX = 160
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// Where the section is taken: a dot on the track at the slider's station, so
// the drawing and the map say the same thing.
const MARKER_SOURCE = 'cross-section-marker-source'
const MARKER_LAYERS = [{
  sourceId: MARKER_SOURCE,
  layer: {
    id: 'cross-section-marker-layer', type: 'circle',
    paint: {
      'circle-radius': 6,
      'circle-color': '#a52a1f',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  },
}]

/**
 * The cross section of a track at a station, drawn to scale: the running plane
 * with its two running circles, the rail inner faces, and the clearance
 * contour over them — all turned by the cant that holds at that station,
 * because the contour is fixed to the track and leans with it.
 *
 * The slider walks the station along the whole track; nothing here is
 * editable. The section is a view of the alignment; what it shows is changed
 * by changing the track (see CrossSectionPanel).
 */
export default function CrossSectionOverlay({ at, project, map, onAtChange, onClose, t }) {
  const [size, setSize] = useState(null)
  const [heightPx, setHeightPx] = useState(null)
  const bodyRef = useRef(null)

  const track = loadTracks(project.id).find(tr => tr.id === at.trackId)
  const total = track ? Math.round(trackLength(track) * 10) / 10 : 0
  const station = track ? clamp(at.station ?? 0, 0, total) : 0

  usePreviewLayers(map, MARKER_LAYERS, { resetCursor: true })

  // The marker follows the station, on the track's own geometry.
  useEffect(() => {
    const src = map?.current?.getSource(MARKER_SOURCE)
    if (!src || !track) return
    const point = pointAtStation(track, station)
    if (!point) return
    const [lng, lat] = utmToWgs84(point.utm.easting, point.utm.northing, track.epsg)
    src.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } }],
    })
  }, [map, track, station])

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

  if (!track) return null

  const state   = sectionAtStation(track, station)
  const { rail, sleeper } = superstructureAt(track, station)
  // The platforms laid along the track here, level beside it as they are built.
  const platforms = loadPlatforms(project.id)
    .filter(p => p.trackId === at.trackId
      && station >= (p.startStation ?? 0) && station <= (p.endStation ?? Infinity))
    .map(p => platformSection(p, { rail, sleeper }))
  const profile = gaugeProfile(project.gaugeProfile ?? DEFAULT_GAUGE_PROFILE)
  const section = crossSection({
    cant: state?.cant ?? 0,
    gaugeRing: gaugeProfileRing(profile.points),
    gaugeGuides: gaugeProfileGuides(profile.guides),
    rail,
    sleeper,
  })

  const drawing = () => {
    if (!size || size.w < 40 || size.h < 40) return null
    // Everything handed to fitSection is a point — the platform outlines are
    // arrays of points, so they are flattened in with the rest.
    const all = [...section.gauge, ...section.runningCircles, ...section.sleeper, ...section.guides.flat(), ...platforms.flat()]
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
        {/* the clearance contour, and the lines it is read against */}
        <path d={`${path(section.gauge)} Z`} fill="rgba(108,92,231,0.07)" stroke="var(--color-primary)" strokeWidth="1.5" />
        {section.guides.map((g, i) => (
          <path key={`g${i}`} d={path(g)} fill="none" stroke="var(--color-primary)"
            strokeWidth="1" strokeDasharray="5 4" opacity="0.7" />
        ))}
        {/* the platforms beside the track, level while the track leans */}
        {platforms.map((p, i) => (
          <path key={`p${i}`} d={`${path(p)} Z`} fill={PLATFORM_FILL_COLOR} stroke={PLATFORM_OUTLINE_COLOR} strokeWidth="1" />
        ))}
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

  return (
    <div className="profile-overlay" style={heightPx ? { height: heightPx } : undefined}>
      <div className="profile-resize" onPointerDown={onResizeStart} />
      <div className="track-table-header">
        <span className="track-table-title">
          {`${track.name || track.id.slice(0, 8)} · ${t('cross_section_station')} ${station.toFixed(1)} m`}
        </span>
        <div className="profile-controls">
          <span className="profile-hint">
            {`${t('cant')} ${Math.round(state?.cant ?? 0)} mm`}
            {state?.radius != null ? ` · R ${Math.round(Math.abs(state.radius))} m` : ` · ${t('table_type_straight')}`}
            {` · ${RAILS[rail]?.label ?? rail} · ${SLEEPERS[sleeper]?.label ?? sleeper}`}
          </span>
          <button className="track-table-close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="profile-body" ref={bodyRef}>{drawing()}</div>
      <div className="cross-section-slider">
        <input
          type="range" min={0} max={total} step={0.1} value={station}
          onChange={e => onAtChange?.({ ...at, station: Number(e.target.value) })}
        />
        <span className="cross-section-slider-label">{`${station.toFixed(1)} / ${total.toFixed(1)} m`}</span>
      </div>
    </div>
  )
}
