import { useEffect, useMemo, useRef, useState } from 'react'
import { loadTracks, loadPlatforms, currentProject } from '../storage'
import { trackLength, gradientAt } from '../utils/heightUtils'
import { utmToWgs84 } from '../utils/coordinateUtils'
import { pointAtStation } from '../utils/platformUtils'
import { PLATFORM_FILL_COLOR, PLATFORM_OUTLINE_COLOR } from '../utils/mapRenderUtils'
import { sampleHeightsWithSource, terrainSourceLabel, chosenTerrainSource } from '../utils/elevationSource'
import TerrainSourceSelect from './TerrainSourceSelect'
import {
  crossSection, fitSection, superstructureAt, sectionAtStation, platformSection, placeSection,
  sectionNeighbours, sectionLinePoints, sectionLevels, sectionOrigin, PLANUM_EDGE, RAILS, SLEEPERS,
} from '../utils/crossSectionUtils'
import { DEFAULT_HEIGHT_EPSG, HEIGHT_DATUMS } from '../utils/mapConstants'
import { listClouds } from '../utils/pointCloud/cloudStore'
import { cloudSectionPoints } from '../utils/pointCloud/cloudSection'
import { drawCloudPoints, CLOUD_COLORINGS, INTRUSION_COLOR } from '../utils/pointCloud/cloudPaint'
import { checkClearance, BOTTOM_BAND } from '../utils/pointCloud/clearanceCheck'
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
/** Terrain is read at least this far either side of the track [m]. */
const MIN_TERRAIN_HALF = 40
const ASSUMED_COLOR = '#8a8a8a'
/** Slice thickness of the point cloud unless the user says otherwise [cm]. */
const DEFAULT_THICKNESS = 10
const MAX_THICKNESS = 100
/** How far beyond the reach the point cloud is still read [m] — the drawing runs past the outer tracks. */
const CLOUD_MARGIN = 5
const CLOUD_COLOR = '#7a5a14'
const CLEAR_COLOR = '#1f7a3a'
/** How far the drawing can be zoomed out and in, relative to the fitted view. */
const MIN_ZOOM = 0.5
const MAX_ZOOM = 200
const heightName = (epsg) => HEIGHT_DATUMS.find(d => d.epsg === Number(epsg))?.label ?? `EPSG ${epsg}`
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
 * every track is labelled with its absolute height and its cant (u=…), every
 * platform with the height of its edge. A track without a gradient says so:
 * it is drawn greyed, its top of rail assumed a little over the terrain at its
 * axis — the gradient is never read from the terrain on its own (see the
 * profile's button for that).
 *
 * The drawing zooms about the cursor with the wheel and pans by dragging;
 * a double click fits it again. Walking the station puts the section back in
 * the middle at the zoom chosen — the further in, the closer to this track.
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
  const [terrainSource, setTerrainSource] = useState(chosenTerrainSource)
  const [clouds, setClouds] = useState([])          // the project's point clouds on this device
  const [cloudOn, setCloudOn] = useState(true)
  const [thickness, setThickness] = useState(DEFAULT_THICKNESS)
  const [coloring, setColoring] = useState(CLOUD_COLORINGS[0])
  const [slice, setSlice] = useState(null)          // { key, parts: [{ cloud, points }], ms }
  // Zoom relative to the fitted drawing, and the point [mm] held in the middle
  // of the box — null while the section is centred by itself.
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState(null)
  const [dragging, setDragging] = useState(false)
  const bodyRef = useRef(null)
  const canvasRef = useRef(null)
  const svgRef = useRef(null)
  const viewRef = useRef(null)
  const panRef = useRef(null)

  const tracks = loadTracks()
  const track = tracks.find(tr => tr.id === at.trackId)
  const total = track ? Math.round(trackLength(track) * 10) / 10 : 0
  const station = track ? clamp(at.station ?? 0, 0, total) : 0

  // Another station or track: the section comes back to the middle, the zoom stays.
  const centerKey = `${at.trackId}|${station}`
  const [centeredFor, setCenteredFor] = useState(centerKey)
  if (centeredFor !== centerKey) { setCenteredFor(centerKey); setCenter(null) }

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
  const allPlatforms = loadPlatforms()
  const profile = gaugeProfile(currentProject()?.gaugeProfile ?? DEFAULT_GAUGE_PROFILE)
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
  const drawn = main ? [main, ...neighbours] : []

  // ── The terrain along the section line, read once the slider rests ────────
  // A fixed stretch either side, not the fitted drawing: the drawing depends on
  // where a track without a gradient stands, and that depends on the terrain.
  const terrainHalf = Math.max(reach + 10, MIN_TERRAIN_HALF)
  const terrainStep = Math.max(0.5, Math.round(2 * terrainHalf / 200 * 2) / 2)
  const terrainKey = track ? `${track.id}|${station.toFixed(1)}|${terrainHalf}|${terrainStep}|${terrainSource}` : null

  useEffect(() => {
    if (!terrainKey || !track) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const line = sectionLinePoints(track, station, -terrainHalf, terrainHalf, terrainStep)
      if (!line.length) return
      try {
        const { heights, sources } = await sampleHeightsWithSource(line.map(p => p.lngLat), { source: terrainSource })
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

  // ── The point clouds of the project, sliced at the section plane ─────────
  useEffect(() => {
    let live = true
    listClouds(project.id).then(c => { if (live) setClouds(c) }).catch(() => {})
    return () => { live = false }
  }, [project.id])

  const cloudKey = track && cloudOn && clouds.length
    ? `${track.id}|${station.toFixed(2)}|${reach}|${thickness}|${clouds.map(c => c.id).join(',')}`
    : null

  useEffect(() => {
    if (!cloudKey || !track) return
    let cancelled = false
    const origin = sectionOrigin(track, station)
    if (!origin) return
    const t0 = performance.now()
    Promise.all(clouds.map(async (cloud) => ({
      cloud,
      points: await cloudSectionPoints(project.id, cloud, {
        origin: origin.utm, bearing: origin.bearing, crs: track.epsg,
        halfWidth: reach + CLOUD_MARGIN, thickness: thickness / 100,
      }),
    }))).then((parts) => {
      if (!cancelled) setSlice({ key: cloudKey, parts, ms: performance.now() - t0 })
    }).catch(() => {
      if (!cancelled) setSlice({ key: cloudKey, parts: [], ms: 0, failed: true })
    })
    return () => { cancelled = true }
    // track and station are part of the key; the track object is new on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudKey])

  // The last slice stays on screen while the next is read, so the drawing does
  // not flicker as the slider moves.
  const slicedParts = cloudOn && slice ? slice.parts : []

  // The clearance check (AP 11.5) against this track's outline, at its
  // gradient and cant. A track without a gradient has nothing to check against.
  const mainZ = main?.z ?? null
  const mainCant = main?.state?.cant ?? 0
  const checks = useMemo(() => (mainZ == null
    ? null
    : slicedParts.map(p => checkClearance(p.points, { zTrack: mainZ, cant: mainCant, ring, areas }))),
  // ring and areas follow the profile id; the arrays are new on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [slicedParts, mainZ, mainCant, profile.id])
  const cloudParts = slicedParts.map((p, n) => ({ ...p, flags: checks?.[n]?.flags }))
  const clearance = checks && checks.length ? (() => {
    let insideCount = 0, deepest = null, nearest = null
    checks.forEach((c, n) => {
      insideCount += c.inside
      const at = (hit) => hit && { distance: hit.distance, y: slicedParts[n].points.y[hit.index], z: slicedParts[n].points.z[hit.index] }
      if (c.deepest && (!deepest || c.deepest.distance > deepest.distance)) deepest = at(c.deepest)
      if (c.nearest && (!nearest || c.nearest.distance < nearest.distance)) nearest = at(c.nearest)
    })
    return { inside: insideCount, deepest, nearest }
  })() : null

  const terrainPoints = terrain?.key === terrainKey ? terrain.points : null
  // Every track at its gradient; one without stands a little over the ground,
  // greyed, and the drawing is relative to the stated height nearest to hand.
  const { levels, zRef } = sectionLevels(drawn.map(d => ({ z: d.z, offset: d.offset })), terrainPoints)
  const placed = drawn.map((d, i) => {
    const level = levels[i]
    const place = (pts) => placeSection(pts, {
      offset: d.offset, mirrored: d.mirrored,
      dz: level.z != null && zRef != null ? (level.z - zRef) * 1000 : 0,
    })
    const { section } = d
    // The inner-face ticks stand square on the running plane, so they are
    // built in the track's own frame and moved with the rest.
    const ticks = section.railFaces.map(([y, z]) =>
      place([[y, z], [y - Math.sin(section.angle) * FACE_TICK, z + Math.cos(section.angle) * FACE_TICK]]))
    return {
      ...d,
      level,
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
    // Room under the outermost tracks for their two label lines.
    fitPoints.push([left.axis[0] - PLANUM_EDGE, bottomOf(left) - 200], [right.axis[0] + PLANUM_EDGE, bottomOf(right) - 200])
  }
  const fitted = size && size.w >= 40 && size.h >= 40 && fitPoints.length ? fitSection(fitPoints, size, MARGIN) : null

  // The view: the fitted drawing zoomed, with the chosen point in the middle —
  // or, while none is chosen, a point that slides from the middle of the whole
  // drawing to the middle of this track as the zoom goes in, so zooming in on
  // a section between other tracks keeps this one in sight.
  const fit = (() => {
    if (!fitted) return null
    const k = fitted.k * zoom
    let mid = center
    if (!mid) {
      const own = [...placed[0].gauge, ...placed[0].runningCircles, ...placed[0].sleeper]
      const ys = own.map(q => q[0]), zs = own.map(q => q[1])
      const ownMid = { y: (Math.min(...ys) + Math.max(...ys)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 }
      const all = { y: (size.w / 2 - fitted.cx) / fitted.k, z: (fitted.cy - size.h / 2) / fitted.k }
      const pull = zoom > 1 ? 1 - 1 / zoom : 0
      mid = { y: all.y + (ownMid.y - all.y) * pull, z: all.z + (ownMid.z - all.z) * pull }
    }
    return { ...fitted, k, cx: size.w / 2 - mid.y * k, cy: size.h / 2 + mid.z * k, mid }
  })()
  const hasFit = fit != null
  viewRef.current = fit && { k: fit.k, cx: fit.cx, cy: fit.cy, baseK: fitted.k, zoom }

  // ── Zoom about the cursor ──────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !size) return
    const onWheel = (e) => {
      const v = viewRef.current
      if (!v) return
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const px = e.clientX - rect.left, py = e.clientY - rect.top
      const y = (px - v.cx) / v.k, z = (v.cy - py) / v.k
      const next = clamp(v.zoom * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM)
      const k = v.baseK * next
      setZoom(next)
      setCenter({ y: y + (size.w / 2 - px) / k, z: z - (size.h / 2 - py) / k })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [size, hasFit])

  // ── Pan by dragging; a double click fits the drawing again ─────────────────
  const onPointerDown = (e) => {
    if (e.button !== 0 || !fit) return
    panRef.current = { x: e.clientX, y: e.clientY, mid: fit.mid, k: fit.k }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }
  const onPointerMove = (e) => {
    const p = panRef.current
    if (!p) return
    setCenter({ y: p.mid.y - (e.clientX - p.x) / p.k, z: p.mid.z + (e.clientY - p.y) / p.k })
  }
  const onPointerUp = () => { panRef.current = null; setDragging(false) }
  const onDoubleClick = () => { setZoom(1); setCenter(null) }

  // The cloud is painted under the drawing, in the drawing's own transform.
  const cloudCount = cloudParts.reduce((n, part) => n + part.points.count, 0)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !size) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr)
      canvas.height = Math.round(size.h * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!fit || !cloudParts.length) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    drawCloudPoints(ctx, { w: size.w, h: size.h, dpr, k: fit.k, cx: fit.cx, cy: fit.cy, zRef, parts: cloudParts, coloring })
  })

  if (!track) return null

  const fmt = (z, digits = 3) => z.toFixed(digits)

  const terrainState = (() => {
    if (!terrainPoints) return { text: t('cross_section_terrain_loading') }
    if (!terrainPoints.some(p => p.z != null)) return { text: t('cross_section_terrain_none') }
    if (zRef == null) return { text: t('cross_section_terrain_no_height') }
    const axis = terrainPoints.reduce((a, b) => (Math.abs(b.y) < Math.abs(a.y) ? b : a))
    return {
      text: `${t('cross_section_terrain')} · ${terrain.sources.map(terrainSourceLabel).join(', ')}`
        + (axis.z != null ? ` · ${t('cross_section_terrain_axis')} ${fmt(axis.z, 2)} m` : ''),
      // Split at the gaps where no source had a height, so a gap stays one.
      runs: terrainPoints.reduce((runs, p) => {
        if (p.z == null) { if (runs[runs.length - 1]?.length) runs.push([]); return runs }
        runs[runs.length - 1].push([p.y, (p.z - zRef) * 1000])
        return runs
      }, [[]]).filter(r => r.length >= 2),
    }
  })()

  // What the cloud says about itself under the drawing: how many points are in
  // the slice, and — since the app does not convert between height systems
  // (elevationSource) — whether its heights are in another one than the track's.
  const cloudState = (() => {
    if (!cloudOn || !clouds.length) return null
    if (zRef == null) return { text: t('cross_section_cloud_no_height') }
    if (!slice) return { text: t('cross_section_cloud_loading') }
    if (slice.failed) return { text: t('cross_section_cloud_failed') }
    const trackDatum = Number(track.heightEpsg) || DEFAULT_HEIGHT_EPSG
    const others = [...new Set(cloudParts.filter(p => p.points.count && Number(p.cloud.heightEpsg) !== trackDatum)
      .map(p => heightName(p.cloud.heightEpsg)))]
    const mm = (d) => Math.round(d).toLocaleString()
    let check = null
    if (!clearance) check = { text: t('cross_section_clearance_no_gradient'), color: '#888' }
    else if (clearance.inside) {
      check = {
        text: t('cross_section_clearance_hit').replace('{{n}}', clearance.inside.toLocaleString())
          .replace('{{mm}}', mm(clearance.deepest.distance)),
        color: INTRUSION_COLOR,
      }
    } else if (clearance.nearest) {
      check = { text: t('cross_section_clearance_free').replace('{{mm}}', mm(clearance.nearest.distance)), color: CLEAR_COLOR }
    } else if (cloudCount) {
      check = { text: t('cross_section_clearance_far'), color: CLEAR_COLOR }
    }
    return {
      check,
      text: t('cross_section_cloud_count').replace('{{n}}', cloudCount.toLocaleString())
        .replace('{{half}}', String(thickness / 2)),
      datum: others.length
        ? t('cross_section_cloud_datum').replace('{{cloud}}', others.join(', ')).replace('{{track}}', heightName(trackDatum))
        : null,
    }
  })()

  /** The two lines under a track: its name (not for the track itself) and height, then its cant. */
  const trackLabel = (p, isMain) => {
    const name = isMain ? '' : `${p.track.name || p.track.id.slice(0, 8)} · `
    if (!p.level.assumed) return `${name}SO ${fmt(p.z)} m`
    if (p.level.z == null) return `${name}${t('cross_section_no_gradient')}`
    return `${name}${t('cross_section_no_gradient')} · SO ≈ ${fmt(p.level.z, 2)} m`
  }

  const drawing = () => {
    if (!fit) return null
    const { k, cx, cy, bounds } = fit
    const { zMax } = bounds
    const X = (y) => cx + y * k
    const Y = (z) => cy - z * k
    const path = (pts) => pts.map(([y, z], i) => `${i ? 'L' : 'M'}${X(y)},${Y(z)}`).join(' ')

    return (
      <svg ref={svgRef} width={size.w} height={size.h} className={`cross-section-svg${dragging ? ' dragging' : ''}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick}>
        <title>{t('cross_section_view_hint')}</title>
        {/* the horizontal through this track's running plane, so the cant is
            visible as the angle it is */}
        <line x1={MARGIN / 2} x2={size.w - MARGIN / 2} y1={Y(0)} y2={Y(0)} stroke="#e4e4ec" strokeDasharray="6 4" />
        {/* the ground along the section line */}
        {terrainState.runs?.map((r, i) => (
          <path key={`g${i}`} d={path(r)} fill="none" stroke={TERRAIN_COLOR} strokeWidth="1.2" />
        ))}
        {placed.map((p, n) => {
          const isMain = n === 0
          return (
            <g key={`${p.track.id}|${p.station}`} opacity={p.level.assumed ? 0.4 : 1}
              style={p.level.assumed ? { filter: 'grayscale(1)' } : undefined}>
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
                <path d={`${path(p.sleeper)} Z`} fill="#d9d4cc" fillOpacity={cloudCount ? 0.45 : 1} stroke="#8d867a" strokeWidth="1" />
              )}
              {p.rails.map((r, i) => (
                <path key={`r${i}`} d={`${path(r)} Z`} fill="#6b6b6b" fillOpacity={cloudCount ? 0.35 : 1} stroke="#333" strokeWidth="1" />
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
            fontSize="11" textAnchor="middle" fill={p.level.assumed ? ASSUMED_COLOR : '#444'}
            fontStyle={p.level.assumed ? 'italic' : undefined}>
            <tspan x={X(p.axis[0])}>{trackLabel(p, n === 0)}</tspan>
            <tspan x={X(p.axis[0])} dy="13">{`u=${Math.round(Math.abs(p.state?.cant ?? 0))}`}</tspan>
          </text>
        ))}
        {placed.flatMap(p => p.platformOutlines.map(({ platform, outline }, i) => {
          const height = Number(platform.height)
          if (p.level.assumed || !Number.isFinite(height)) return null
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
        {cloudState && (
          <text x={MARGIN / 2} y={16} fontSize="11" fill={CLOUD_COLOR}
            stroke="#fff" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">
            <tspan x={MARGIN / 2}>{cloudState.text}</tspan>
            {cloudState.check && (
              <tspan x={MARGIN / 2} dy="13" fill={cloudState.check.color} fontWeight="600">{cloudState.check.text}</tspan>
            )}
            {cloudState.check && clearance && (
              <tspan x={MARGIN / 2} dy="13" fill="#888">
                {t('cross_section_clearance_band').replace('{{mm}}', String(BOTTOM_BAND))}
              </tspan>
            )}
            {cloudState.datum && <tspan x={MARGIN / 2} dy="13" fill="#b35c00">{cloudState.datum}</tspan>}
          </text>
        )}
        {/* the point reaching deepest into the outline, or the nearest outside it */}
        {clearance && zRef != null && [clearance.deepest ?? clearance.nearest].filter(Boolean).map(p => (
          <g key="nearest" className="cross-section-nearest">
            <circle cx={X(p.y * 1000)} cy={Y((p.z - zRef) * 1000)} r="6" fill="none"
              stroke={clearance.inside ? INTRUSION_COLOR : CLEAR_COLOR} strokeWidth="1.5" />
            <text x={X(p.y * 1000) + 9} y={Y((p.z - zRef) * 1000) - 6} fontSize="11"
              fill={clearance.inside ? INTRUSION_COLOR : CLEAR_COLOR} stroke="#fff" strokeWidth="3" paintOrder="stroke">
              {`${Math.round(p.distance)} mm`}
            </text>
          </g>
        ))}
      </svg>
    )
  }

  // One metre on or back, to the next whole metre — from 30.4 to 31 or 30 —
  // so stepping walks the stations a surveyor would read off.
  const stepTo = (dir) => {
    const next = dir > 0 ? Math.floor(station + 1e-6) + 1 : Math.ceil(station - 1e-6) - 1
    onAtChange?.({ ...at, station: clamp(next, 0, total) })
  }

  const state = main.state
  return (
    <div className="profile-overlay" style={heightPx ? { height: heightPx } : undefined}>
      <div className="profile-resize" onPointerDown={onResizeStart} />
      <div className="track-table-header cross-section-header">
        <span className="track-table-title">
          {`${track.name || track.id.slice(0, 8)} · ${t('cross_section_station')} ${station.toFixed(1)} m`}
        </span>
        <div className="profile-controls">
          <span className="profile-hint">
            {`u=${Math.round(Math.abs(state?.cant ?? 0))} mm`}
            {state?.radius != null ? ` · R ${Math.round(Math.abs(state.radius))} m` : ` · ${t('table_type_straight')}`}
            {` · ${RAILS[main.rail]?.label ?? main.rail} · ${SLEEPERS[main.sleeper]?.label ?? main.sleeper}`}
          </span>
          {clouds.length > 0 && (
            <>
              <label className="profile-edit" title={t('cross_section_cloud_hint')}>
                <input type="checkbox" checked={cloudOn} onChange={e => setCloudOn(e.target.checked)} />
                {t('cross_section_cloud')}
              </label>
              {cloudOn && (
                <>
                  <label className="profile-edit" title={t('cross_section_cloud_thickness_hint')}>
                    {t('cross_section_cloud_thickness')}
                    <input className="track-table-input cross-section-reach" type="number" min={1} max={MAX_THICKNESS} step={2}
                      value={thickness}
                      onChange={e => setThickness(clamp(Number(e.target.value) || DEFAULT_THICKNESS, 1, MAX_THICKNESS))} />
                    cm
                  </label>
                  <select className="cross-section-coloring" value={coloring} onChange={e => setColoring(e.target.value)}
                    title={t('cross_section_cloud_coloring')}>
                    {CLOUD_COLORINGS.map(c => <option key={c} value={c}>{t(`cross_section_cloud_by_${c}`)}</option>)}
                  </select>
                </>
              )}
            </>
          )}
          <label className="profile-edit">
            {t('terrain_source')}
            <TerrainSourceSelect t={t} value={terrainSource} onChange={setTerrainSource} />
          </label>
          {(zoom !== 1 || center) && (
            <button className="track-table-save-btn" onClick={onDoubleClick} title={t('cross_section_view_hint')}>
              {t('cross_section_fit')}
            </button>
          )}
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
      <div className="profile-body" ref={bodyRef}>
        <canvas ref={canvasRef} className="cross-section-cloud" data-slice-ms={slice ? slice.ms.toFixed(1) : ''}
          data-cpu-ms={slice ? slice.parts.reduce((a, p) => a + (p.points.sliceMs ?? 0) + (p.points.decodeMs ?? 0), 0).toFixed(1) : ''}
          style={size ? { width: size.w, height: size.h } : undefined} />
        {drawing()}
      </div>
      <div className="cross-section-slider">
        <button className="cross-section-step" disabled={station <= 0} onClick={() => stepTo(-1)}
          title={t('cross_section_step_back')}>◀</button>
        <input
          type="range" min={0} max={total} step={0.1} value={station}
          onChange={e => onAtChange?.({ ...at, station: Number(e.target.value) })}
        />
        <button className="cross-section-step" disabled={station >= total} onClick={() => stepTo(1)}
          title={t('cross_section_step_forward')}>▶</button>
        <span className="cross-section-slider-label">{`${station.toFixed(1)} / ${total.toFixed(1)} m`}</span>
      </div>
    </div>
  )
}
