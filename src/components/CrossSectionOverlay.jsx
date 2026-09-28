import { useEffect, useRef, useState } from 'react'
import { loadTracks, loadPlatforms } from '../storage'
import { trackLength, gradientAt } from '../utils/heightUtils'
import { utmToWgs84 } from '../utils/coordinateUtils'
import { pointAtStation } from '../utils/platformUtils'
import { PLATFORM_FILL_COLOR, PLATFORM_OUTLINE_COLOR } from '../utils/mapRenderUtils'
import { sampleHeightsWithSource, terrainSourceLabel } from '../utils/elevationSource'
import {
  crossSection, fitSection, superstructureAt, sectionAtStation, platformSection, placeSection,
  sectionNeighbours, sectionLinePoints, PLANUM_EDGE, RAILS, SLEEPERS,
} from '../utils/crossSectionUtils'
import {
  gaugeProfile, gaugeProfileRing, gaugeProfileAreas, gaugeProfileLabelKey, LICHTRAUM_SOURCE,
  DEFAULT_GAUGE_PROFILE,
} from '../utils/gaugeProfiles'
import usePreviewLayers from '../hooks/usePreviewLayers'

const MARGIN = 28
/** Length of the tick marking a rail inner face [mm in the track frame]. */
const FACE_TICK = 250
const MIN_OVERLAY_PX = 160
/** How far either side of the track other tracks are looked for [m], unless the user says otherwise. */
const DEFAULT_REACH = 20
const MAX_REACH = 100
/** Wait after the last move of the slider before the terrain is read [ms]. */
const TERRAIN_DEBOUNCE = 250
const TERRAIN_COLOR = '#2e8b3a'
const MISSING_COLOR = '#a52a1f'
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// Where the section is taken: a dot on the track at the slider's station, and
// the section line through it as far as other tracks are looked for — so the
// drawing and the map say the same thing.
const LINE_SOURCE = 'cross-section-line-source'
const MARKER_SOURCE = 'cross-section-marker-source'
const MARKER_LAYERS = [{
  sourceId: LINE_SOURCE,
  layer: {
    id: 'cross-section-line-layer', type: 'line',
    paint: { 'line-color': '#a52a1f', 'line-width': 1.5, 'line-dasharray': [3, 2] },
  },
}, {
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

const inRange = (p, station) => station >= (p.startStation ?? 0) && station <= (p.endStation ?? Infinity)

/**
 * The cross section of a track at a station, drawn to scale: the running plane
 * with its two running circles, the rail inner faces, and the clearance
 * contour over them — all turned by the cant that holds at that station,
 * because the contour is fixed to the track and leans with it.
 *
 * Beside it stand the other tracks the section line crosses, each with its own
 * cant and platforms, and under all of them the terrain as a thin green line.
 * Everything is placed at its height relative to this track's gradient, and
 * every track and platform is labelled with its absolute height — a track
 * without heights says so instead, and is drawn level with this one.
 *
 * The slider walks the station along the whole track; nothing here is
 * editable. The section is a view of the alignment; what it shows is changed
 * by changing the track (see CrossSectionPanel).
 */
export default function CrossSectionOverlay({ at, project, map, onAtChange, onClose, t }) {
  const [size, setSize] = useState(null)
  const [heightPx, setHeightPx] = useState(null)
  const [reach, setReach] = useState(DEFAULT_REACH)
  const [terrain, setTerrain] = useState(null)   // { key, points: [{ y, z }], sources }
  const bodyRef = useRef(null)

  const tracks = loadTracks(project.id)
  const track = tracks.find(tr => tr.id === at.trackId)
  const total = track ? Math.round(trackLength(track) * 10) / 10 : 0
  const station = track ? clamp(at.station ?? 0, 0, total) : 0

  usePreviewLayers(map, MARKER_LAYERS, { resetCursor: true })

  // The marker follows the station, on the track's own geometry, and the
  // section line reaches as far as other tracks are looked for.
  useEffect(() => {
    const m = map?.current
    if (!m || !track) return
    const point = pointAtStation(track, station)
    if (!point) return
    const [lng, lat] = utmToWgs84(point.utm.easting, point.utm.northing, track.epsg)
    m.getSource(MARKER_SOURCE)?.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } }],
    })
    const ends = sectionLinePoints(track, station, -reach, reach, 2 * reach)
    m.getSource(LINE_SOURCE)?.setData({
      type: 'FeatureCollection',
      features: ends.length === 2
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ends.map(e => e.lngLat) } }]
        : [],
    })
  }, [map, track, station, reach])

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

  // ── What the section shows: this track and the ones beside it ─────────────
  const allPlatforms = loadPlatforms(project.id)
  const profile = gaugeProfile(project.gaugeProfile ?? DEFAULT_GAUGE_PROFILE)
  const ring  = gaugeProfileRing(profile.points)
  const areas = gaugeProfileAreas(profile.einragungen)

  const sectionOf = ({ track: tr, station: st, offset = 0, mirrored = false }) => {
    const state = sectionAtStation(tr, st)
    const { rail, sleeper } = superstructureAt(tr, st)
    return {
      track: tr, station: st, offset, mirrored, state, rail, sleeper,
      z: gradientAt(tr.heights, st),
      section: crossSection({ cant: state?.cant ?? 0, gaugeRing: ring, gaugeAreas: areas, rail, sleeper }),
      // The platforms laid along the track here, level beside it as they are built.
      platforms: allPlatforms.filter(p => p.trackId === tr.id && inRange(p, st))
        .map(p => ({ platform: p, outline: platformSection(p, { rail, sleeper }) })),
    }
  }

  const main = track ? sectionOf({ track, station }) : null
  const neighbours = track ? sectionNeighbours(track, station, tracks, reach).map(sectionOf) : []
  // Heights are drawn relative to this track's gradient; where it has none,
  // the nearest track that has one takes its place, so the others still
  // stand at their heights to each other.
  const zRef = main?.z
    ?? [...neighbours].sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset)).find(n => n.z != null)?.z
    ?? null
  const drawn = main ? [main, ...neighbours] : []
  const placed = drawn.map(d => {
    const place = (pts) => placeSection(pts, {
      offset: d.offset, mirrored: d.mirrored,
      dz: d.z != null && zRef != null ? (d.z - zRef) * 1000 : 0,
    })
    const { section } = d
    // The inner-face ticks stand square on the running plane, so they are
    // built in the track's own frame and moved with the rest.
    const ticks = section.railFaces.map(([y, z]) =>
      place([[y, z], [y - Math.sin(section.angle) * FACE_TICK, z + Math.cos(section.angle) * FACE_TICK]]))
    return {
      ...d,
      gauge: place(section.gauge),
      areas: section.areas.map(place),
      rails: section.rails.map(place),
      sleeper: place(section.sleeper),
      runningCircles: place(section.runningCircles),
      ticks,
      platformOutlines: d.platforms.map(p => ({ ...p, outline: place(p.outline) })),
      axis: place([[0, 0]])[0],
    }
  })

  // Fitted to the tracks, their platforms and the planum edge beyond the
  // outermost — the terrain is not fitted to: it runs out of the drawing
  // where it lies far off, rather than shrinking the tracks to nothing.
  const bottomOf = (p) => Math.min(...(p.sleeper.length ? p.sleeper : p.runningCircles).map(q => q[1]))
  const fitPoints = placed.flatMap(p => [
    ...p.gauge, ...p.runningCircles, ...p.sleeper, ...p.areas.flat(), ...p.platformOutlines.flatMap(o => o.outline),
  ])
  if (placed.length) {
    const left  = placed.reduce((a, b) => (b.axis[0] < a.axis[0] ? b : a))
    const right = placed.reduce((a, b) => (b.axis[0] > a.axis[0] ? b : a))
    fitPoints.push([left.axis[0] - PLANUM_EDGE, bottomOf(left)], [right.axis[0] + PLANUM_EDGE, bottomOf(right)])
  }
  const fit = size && size.w >= 40 && size.h >= 40 && fitPoints.length ? fitSection(fitPoints, size, MARGIN) : null

  // ── The terrain along the section line, read once the slider rests ────────
  // The whole width of the drawing is read, not only what was fitted: the
  // spare space on the wider axis shows ground too.
  const viewFrom = fit ? Math.max(-MAX_REACH, Math.floor((0 - fit.cx) / fit.k / 1000)) : null
  const viewTo   = fit ? Math.min(MAX_REACH, Math.ceil((size.w - fit.cx) / fit.k / 1000)) : null
  const terrainStep = fit ? Math.max(0.5, Math.round((viewTo - viewFrom) / 150 * 2) / 2) : null
  const terrainKey = fit && track ? `${track.id}|${station.toFixed(1)}|${viewFrom}|${viewTo}|${terrainStep}` : null

  useEffect(() => {
    if (!terrainKey || !track) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const line = sectionLinePoints(track, station, viewFrom, viewTo, terrainStep)
      if (!line.length) return
      try {
        const { heights, sources } = await sampleHeightsWithSource(line.map(p => p.lngLat))
        if (cancelled) return
        setTerrain({
          key: terrainKey,
          points: line.map((p, i) => ({ y: p.y, z: heights[i] })),
          sources: [...new Set(sources.filter(Boolean))],
        })
      } catch {
        if (!cancelled) setTerrain({ key: terrainKey, points: [], sources: [] })
      }
    }, TERRAIN_DEBOUNCE)
    return () => { cancelled = true; clearTimeout(timer) }
    // track and station are part of the key; the track object is new on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainKey])

  if (!track) return null

  const fmt = (z, digits = 3) => z.toFixed(digits)

  const terrainState = (() => {
    if (!terrain || terrain.key !== terrainKey) return { text: t('cross_section_terrain_loading') }
    if (!terrain.points.some(p => p.z != null)) return { text: t('cross_section_terrain_none') }
    if (zRef == null) return { text: t('cross_section_terrain_no_height') }
    const axis = terrain.points.reduce((a, b) => (Math.abs(b.y) < Math.abs(a.y) ? b : a))
    return {
      text: `${t('cross_section_terrain')} · ${terrain.sources.map(terrainSourceLabel).join(', ')}`
        + (axis.z != null ? ` · ${t('cross_section_terrain_axis')} ${fmt(axis.z, 2)} m` : ''),
      // Split at the gaps where no source had a height, so a gap stays one.
      runs: terrain.points.reduce((runs, p) => {
        if (p.z == null) { if (runs[runs.length - 1]?.length) runs.push([]); return runs }
        runs[runs.length - 1].push([p.y, (p.z - zRef) * 1000])
        return runs
      }, [[]]).filter(r => r.length >= 2),
    }
  })()

  const drawing = () => {
    if (!fit) return null
    const { k, cx, cy, bounds } = fit
    const { zMax } = bounds
    const X = (y) => cx + y * k
    const Y = (z) => cy - z * k
    const path = (pts) => pts.map(([y, z], i) => `${i ? 'L' : 'M'}${X(y)},${Y(z)}`).join(' ')

    return (
      <svg width={size.w} height={size.h} className="cross-section-svg">
        {/* the horizontal through this track's running plane, so the cant is
            visible as the angle it is */}
        <line x1={MARGIN / 2} x2={size.w - MARGIN / 2} y1={Y(0)} y2={Y(0)} stroke="#e4e4ec" strokeDasharray="6 4" />
        {/* the ground along the section line */}
        {terrainState.runs?.map((r, i) => (
          <path key={`g${i}`} d={path(r)} fill="none" stroke={TERRAIN_COLOR} strokeWidth="1.2" />
        ))}
        {placed.map((p, n) => {
          const missing = p.z == null
          const isMain = n === 0
          return (
            <g key={`${p.track.id}|${p.station}`} opacity={missing ? 0.55 : 1}>
              {/* the clearance contour, and the areas inside it that may be
                  reached into — dashed, because they are part of the outline
                  but not of the space that has to stay free */}
              <path d={`${path(p.gauge)} Z`} fill={isMain ? 'rgba(108,92,231,0.07)' : 'rgba(108,92,231,0.03)'}
                stroke="var(--color-primary)" strokeWidth={isMain ? 1.5 : 1} />
              {p.areas.map((a, i) => (
                <path key={`a${i}`} d={`${path(a)} Z`} fill="#ffffff" fillOpacity="0.6"
                  stroke="var(--color-primary)" strokeWidth="1" strokeDasharray="5 4" opacity="0.8" />
              ))}
              {/* the platforms beside the track, level while the track leans */}
              {p.platformOutlines.map(({ outline }, i) => (
                <path key={`p${i}`} d={`${path(outline)} Z`} fill={PLATFORM_FILL_COLOR} stroke={PLATFORM_OUTLINE_COLOR} strokeWidth="1" />
              ))}
              {/* the superstructure carrying it */}
              {p.sleeper.length > 0 && (
                <path d={`${path(p.sleeper)} Z`} fill="#d9d4cc" stroke="#8d867a" strokeWidth="1" />
              )}
              {p.rails.map((r, i) => (
                <path key={`r${i}`} d={`${path(r)} Z`} fill="#6b6b6b" stroke="#333" strokeWidth="1" />
              ))}
              {/* the running plane between the running circles */}
              <line x1={X(p.runningCircles[0][0])} y1={Y(p.runningCircles[0][1])}
                x2={X(p.runningCircles[1][0])} y2={Y(p.runningCircles[1][1])} stroke="#333" strokeWidth="2" />
              {/* where the gauge is measured — as ticks, because at this scale
                  the 32.5 mm between face and running circle is a hair's breadth */}
              {p.ticks.map(([[y1, z1], [y2, z2]], i) => (
                <line key={`f${i}`} x1={X(y1)} y1={Y(z1)} x2={X(y2)} y2={Y(z2)} stroke="#333" strokeWidth="1.5" />
              ))}
              {p.runningCircles.map(([y, z], i) => (
                <circle key={`c${i}`} cx={X(y)} cy={Y(z)} r="3.5" fill="#a52a1f" />
              ))}
            </g>
          )
        })}
        {/* heights: of every track's gradient under it, of every platform edge over it */}
        {placed.map((p, n) => (
          <text key={`l${p.track.id}|${p.station}`} x={X(p.axis[0])} y={Y(bottomOf(p)) + 14}
            fontSize="11" textAnchor="middle" fill={p.z == null ? MISSING_COLOR : '#444'}>
            {(n === 0 ? '' : `${p.track.name || p.track.id.slice(0, 8)} · `)
              + (p.z == null ? t('cross_section_height_missing') : `SO ${fmt(p.z)} m`)}
          </text>
        ))}
        {placed.flatMap(p => p.platformOutlines.map(({ platform, outline }, i) => {
          const height = Number(platform.height)
          if (p.z == null || !Number.isFinite(height)) return null
          const ys = outline.map(q => q[0]), top = Math.max(...outline.map(q => q[1]))
          return (
            <text key={`b${p.track.id}|${i}`} x={X((Math.min(...ys) + Math.max(...ys)) / 2)} y={Y(top) - 5}
              fontSize="11" textAnchor="middle" fill="#444">
              {`BK ${fmt(p.z + height / 1000)} m`}
            </text>
          )
        }))}
        <text x={X(0)} y={Y(zMax) - 8} fontSize="11" fill="#777" textAnchor="middle">
          {`${t(gaugeProfileLabelKey(profile.id))} · ${LICHTRAUM_SOURCE}`}
        </text>
        <text x={MARGIN / 2} y={size.h - 8} fontSize="11" fill={terrainState.runs ? TERRAIN_COLOR : '#888'}>
          {terrainState.text}
        </text>
      </svg>
    )
  }

  const state = main.state
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
            {` · ${RAILS[main.rail]?.label ?? main.rail} · ${SLEEPERS[main.sleeper]?.label ?? main.sleeper}`}
          </span>
          <label className="profile-edit" title={t('cross_section_reach_hint')}>
            {t('cross_section_reach')}
            <input className="track-table-input cross-section-reach" type="number" min={1} max={MAX_REACH} step={5}
              value={reach}
              onChange={e => setReach(clamp(Number(e.target.value) || DEFAULT_REACH, 1, MAX_REACH))} />
            m
          </label>
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
