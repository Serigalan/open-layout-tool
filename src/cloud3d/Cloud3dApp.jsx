import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { api } from '../api/client'
import I18nProvider from '../locales/I18nProvider'
import { useI18n } from '../locales/i18nContext'
import { serverLevel, readableOnServer } from '../utils/pointCloud/projectClouds'
import { projectPlane } from '../utils/pointCloud/cloudProbe'
import { planeMapper } from '../utils/pointCloud/cloudCrs'
import { loadGridsFor } from '../utils/ntv2Grid'
import { crsDatum, crsName, utmToWgs84 } from '../utils/coordinateUtils'
import { heightDatumLabel } from '../utils/heightDatums'
import { gaugeProfile, gaugeProfileRing, DEFAULT_GAUGE_PROFILE } from '../utils/gaugeProfiles'
import { surveyPoints } from '../utils/axisSurvey'
import { trackLabel } from '../utils/trackModel'
import { downloadText } from '../utils/fileUtils'
import { Viewer } from './viewer'
import { COLORINGS, CLOUD_COLORS } from './shaders'
import { cloud3dParams, openChannel } from './channel'
import { trackSamples, trackLines, nearestOnTracks, sectionPlane } from './trackGeometry'
import { originalPoint, between, measurementsCsv } from './measure'
import { PALETTE } from '../styles/palette'
import './cloud3d.css'

/** How long the 3D window waits for the main window before it reads the server's head [ms]. */
const MAIN_WAIT = 1200
/** The main window counts as gone when it has not answered for this long [ms]. */
const MAIN_TIMEOUT = 7000

const LOOK = {
  axis: PALETTE.view3dAxis, rail: PALETTE.view3dRail, survey: PALETTE.view3dSurvey,
  plane: PALETTE.view3dPlane, outline: PALETTE.view3dOutline, pick: PALETTE.view3dPick,
}

export default function Cloud3dApp() {
  return <I18nProvider><Cloud3dPage /></I18nProvider>
}

/**
 * The 3D view in a window of its own (phase 13, AP 13.8–13.11): the
 * project's clouds on the server, the planned tracks and the measured axes in
 * them, the cross section of the main window as a plane, walking along a
 * track and measuring points of the original.
 */
function Cloud3dPage() {
  const { t, fill } = useI18n()
  const params = useMemo(() => cloud3dParams(), [])
  const [state, setState] = useState({ phase: 'loading' })   // loading | anon | none | error | ready
  const [project, setProject] = useState(null)   // { data, from: 'main' | 'server' }
  const [mainSeen, setMainSeen] = useState(0)
  const [section, setSection] = useState(null)
  const [clouds, setClouds] = useState([])        // rows shown, with { key, color, visible, l0 }
  const [options, setOptions] = useState({ coloring: null, budget: 6, sizeFactor: 1, edl: true, edlStrength: 0.6 })
  const [status, setStatus] = useState(null)
  const [walkTrack, setWalkTrack] = useState('')
  const [walking, setWalking] = useState(null)    // { station, across } while walking
  const [measuring, setMeasuring] = useState(false)
  const [measured, setMeasured] = useState([])
  const [note, setNote] = useState(null)
  const canvasRef = useRef(null)
  const viewerRef = useRef(null)
  const channelRef = useRef(null)
  const geometryRef = useRef(null)                 // { viewCrs, origin, tracks: [{ id, label, samples }] }

  // ── the session, the clouds and the project ─────────────────────────────
  useEffect(() => {
    if (!params?.projectId) { setState({ phase: 'error', text: t('cloud3d_no_project') }); return }
    document.title = `3D · Open Layout Tool`
    let live = true
    const ch = openChannel(params.projectId, (msg) => {
      if (!live) return
      if (msg.type === 'pong' || msg.type === 'project' || msg.type === 'section') setMainSeen(Date.now())
      if (msg.type === 'project') setProject({ data: msg.data, from: 'main' })
      if (msg.type === 'section') setSection(msg.at)
    })
    channelRef.current = ch
    ch?.postMessage({ type: 'hello' })
    ;(async () => {
      try {
        await api.me()
      } catch {
        if (live) setState({ phase: 'anon' })
        return
      }
      try {
        const { clouds: rows } = await api.clouds(params.projectId)
        const ready = rows.filter(readableOnServer)
        if (!live) return
        if (!ready.length) { setState({ phase: 'none' }); return }
        const first = ready.find(r => r.id === params.cloudId) ?? ready[0]
        setClouds([first, ...ready.filter(r => r !== first)].map((r, k) => ({
          ...r, key: r.id, color: CLOUD_COLORS[k % CLOUD_COLORS.length], visible: true,
        })))
      } catch (err) {
        if (live) setState({ phase: 'error', text: err.code })
        return
      }
      // Without the main window the variant's checked-in head stands in.
      setTimeout(async () => {
        if (!live) return
        setProject(p => p ?? { data: null, from: 'pending' })
        if (!params.variantId) { setProject(p => (p?.from === 'pending' ? { data: null, from: 'none' } : p)); return }
        try {
          const { payload } = await api.head(params.variantId)
          setProject(p => (p?.from === 'main' ? p : { data: payload, from: 'server' }))
        } catch {
          setProject(p => (p?.from === 'main' ? p : { data: null, from: 'none' }))
        }
      }, MAIN_WAIT)
    })()
    const ping = setInterval(() => ch?.postMessage({ type: 'ping' }), MAIN_TIMEOUT / 2)
    return () => { live = false; clearInterval(ping); ch?.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2000)
    return () => clearInterval(timer)
  }, [])
  const mainThere = now - mainSeen < MAIN_TIMEOUT

  // ── the viewer, once clouds and project are known ────────────────────────
  const ready = clouds.length > 0 && project && project.from !== 'pending'
  useEffect(() => {
    if (!ready || viewerRef.current) return
    let live = true
    ;(async () => {
      const data = project.data
      const tracks = data?.tracks ?? []
      const viewCrs = projectPlane(tracks) ?? clouds[0].crs
      const b0 = clouds[0].bounds
      // Grids for the conversions, where planes of other datums meet.
      const datums = [...new Set([viewCrs, ...clouds.map(c => c.crs)].map(crsDatum).filter(Boolean))]
      const [w, s] = utmToWgs84(b0.minE, b0.minN, clouds[0].crs), [e, n] = utmToWgs84(b0.maxE, b0.maxN, clouds[0].crs)
      if (datums.length) await loadGridsFor([Math.min(w, e) - 0.05, Math.min(s, n) - 0.05, Math.max(w, e) + 0.05, Math.max(s, n) + 0.05], datums).catch(() => {})
      const toViewOf = (crs) => planeMapper(crs, viewCrs)
      const [ce, cn] = toViewOf(clouds[0].crs)((b0.minE + b0.maxE) / 2, (b0.minN + b0.maxN) / 2)
      const origin = [Math.round(ce / 10) * 10, Math.round(cn / 10) * 10, Math.floor(b0.minZ)]
      const zRange = [Math.min(...clouds.map(c => c.bounds.minZ)), Math.max(...clouds.map(c => c.bounds.maxZ))]
      const levels = await Promise.all(clouds.map(async (c) => {
        const ls = await Promise.all([1, 2, 3, 4].map(l => serverLevel(params.projectId, c, l)))
        return Object.fromEntries(ls.map((index, k) => [k + 1, index]))
      }))
      if (!live || !canvasRef.current) return
      const viewer = new Viewer(canvasRef.current, {
        projectId: params.projectId, origin, viewCrs, zRange,
        onStatus: setStatus,
        onDoubleClick: (hit) => onDoubleClickRef.current?.(hit),
      })
      clouds.forEach((c, k) => viewer.addCloud({ key: c.key, row: c, levels: levels[k], toView: toViewOf(c.crs), color: c.color }))
      viewer.initWorkers({ base: document.baseURI, box: [Math.min(w, e) - 0.05, Math.min(s, n) - 0.05, Math.max(w, e) + 0.05, Math.max(s, n) + 0.05] })
      // The cloud asked for (or the first) fills the view; the others may lie
      // kilometres away.
      const box = new THREE.Box3()
      for (const r of viewer.clouds[0].roots) box.union(r.view)
      viewer.frame(box)
      viewer.setOptions({ coloring: clouds.some(c => c.rgb) ? 'rgb' : 'intensity', budget: 6e6 })
      viewerRef.current = viewer
      geometryRef.current = { viewCrs, origin, tracks: [] }
      setOptions(o => ({ ...o, coloring: clouds.some(c => c.rgb) ? 'rgb' : 'intensity' }))
      setState({ phase: 'ready', viewCrs })
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  useEffect(() => () => viewerRef.current?.dispose(), [])

  // ── the tracks and measured axes, whenever the project comes anew ───────
  const viewCrs = state.viewCrs
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !project?.data) return
    const { tracks = [], switches = [], axisSurveys = [] } = project.data
    const geo = geometryRef.current
    const sampled = tracks.filter(tr => tr.epsg).map(tr => ({
      id: tr.id, label: trackLabel(tr),
      samples: trackSamples(tr, { tracks, switches, toView: planeMapper(tr.epsg, viewCrs) }),
    }))
    geo.tracks = sampled
    const objects = []
    for (const tr of sampled) {
      const lines = trackLines(tr.samples)
      for (const run of lines.axis) objects.push(viewer.line(run, LOOK.axis))
      for (const run of [...lines.left, ...lines.right]) objects.push(viewer.line(run, LOOK.rail, { opacity: 0.8 }))
    }
    viewer.setOverlay('tracks', objects)
    viewer.setOverlay('surveys', axisSurveys.map(s => {
      const toView = planeMapper(s.epsg, viewCrs)
      const pts = surveyPoints(s).map(p => { const [e, n] = toView(p.easting, p.northing); return [e, n, (p.zLeft + p.zRight) / 2] })
      return viewer.markers(pts, LOOK.survey, 3)
    }))
  }, [project, viewCrs])

  // ── the cross section of the main window as a plane ───────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const tr = geometryRef.current?.tracks.find(x => x.id === section?.trackId)
    if (!tr || !mainThere) { viewer.setOverlay('section', []); return }
    const profile = gaugeProfile(project?.data?.gaugeProfile ?? DEFAULT_GAUGE_PROFILE)
    const plane = sectionPlane(tr.samples, section.station, { ring: gaugeProfileRing(profile.points) })
    if (!plane?.quad) { viewer.setOverlay('section', []); return }
    viewer.setOverlay('section', [
      viewer.quad(plane.quad, LOOK.plane, 0.16),
      viewer.line(plane.quad, LOOK.plane, { loop: true, opacity: 0.7 }),
      viewer.line(plane.outline, LOOK.outline, { loop: true }),
    ])
  }, [section, project, mainThere, state.phase])

  // ── options ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const v = viewerRef.current
    if (!v || !options.coloring) return
    v.setOptions({ ...options, budget: options.budget * 1e6 })
  }, [options])

  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    for (const c of clouds) v.setCloudVisible(c.key, c.visible)
  }, [clouds])

  // While walking, where the walk stands.
  useEffect(() => {
    if (!walking) return
    const timer = setInterval(() => setWalking(viewerRef.current?.walkState() ?? null), 250)
    return () => clearInterval(timer)
  }, [walking])

  // ── picking and measuring ─────────────────────────────────────────────────
  /** The original point under a pick, with where it lies along the tracks. */
  const resolve = async (hit) => {
    const geo = geometryRef.current
    const [oe, on, oz] = geo.origin
    const cloud = clouds.find(c => c.key === hit.node.cloud)
    const view = [hit.position[0] + oe, hit.position[1] + on, hit.position[2] + oz]
    const toCloud = planeMapper(geo.viewCrs, cloud.crs), toView = planeMapper(cloud.crs, geo.viewCrs)
    const [ce, cn] = toCloud(view[0], view[1])
    cloud.l0 ??= serverLevel(params.projectId, cloud, 0)
    const orig = await originalPoint(params.projectId, await cloud.l0, [ce, cn, view[2]]).catch(() => null)
    const [e, n] = orig ? toView(orig.e, orig.n) : [view[0], view[1]]
    const z = orig ? orig.z : view[2]
    const along = nearestOnTracks(geo.tracks, e, n)
    const track = along ? geo.tracks.find(x => x.id === along.id) : null
    return {
      e, n, z, original: !!orig, cloud: cloud.name,
      trackId: track?.id ?? null, track: track?.label ?? null, station: along?.station ?? null,
      offset: along?.offset ?? null, overSo: along?.z != null ? z - along.z : null,
    }
  }

  const onDoubleClickRef = useRef(null)
  onDoubleClickRef.current = async (hit) => {
    const p = await resolve(hit)
    if (!p.trackId) { setNote(t('cloud3d_no_track_here')); return }
    if (!mainThere) { setNote(t('cloud3d_station_needs_main')); return }
    channelRef.current?.postMessage({ type: 'station', trackId: p.trackId, station: p.station })
    setNote(fill('cloud3d_station_set', { track: p.track, station: p.station.toFixed(1) }))
  }

  // A click (not a drag) while measuring picks a point.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !measuring) return
    let down = null
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY } }
    const onUp = async (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return }
      down = null
      const hit = viewerRef.current?.pickAt(e.offsetX, e.offsetY)
      if (!hit) { setNote(t('cloud3d_pick_none')); return }
      const p = await resolve(hit)
      setNote(p.original ? null : t('cloud3d_pick_not_original'))
      setMeasured(list => [...list, p])
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    return () => { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuring, state.phase])

  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    const pts = measured.map(p => [p.e, p.n, p.z])
    v.setOverlay('picks', pts.length ? [v.markers(pts, LOOK.pick, 8), ...(pts.length > 1 ? [v.line(pts, LOOK.pick)] : [])] : [])
  }, [measured])

  // ── the walk ───────────────────────────────────────────────────────────────
  const startWalk = () => {
    const tr = geometryRef.current?.tracks.find(x => x.id === walkTrack)
    if (!tr) return
    const at = section?.trackId === tr.id ? section.station : tr.samples[0]?.s ?? 0
    if (viewerRef.current?.startWalk(tr.samples, at)) {
      setWalking(viewerRef.current.walkState())
      setNote(null)
      canvasRef.current?.focus()
    } else {
      setNote(t('cloud3d_walk_no_gradient'))
    }
  }
  const stopWalk = () => { viewerRef.current?.stopWalk(); setWalking(null) }

  // ── the page ───────────────────────────────────────────────────────────────
  if (state.phase === 'anon') return <div className="cloud3d-message">{t('cloud3d_sign_in')}</div>
  if (state.phase === 'none') return <div className="cloud3d-message">{t('cloud3d_no_clouds')}</div>
  if (state.phase === 'error') return <div className="cloud3d-message">{state.text}</div>

  const tracks = geometryRef.current?.tracks ?? []
  const colorings = COLORINGS.filter(c => c !== 'rgb' || clouds.some(x => x.rgb))
  const heightName = clouds[0] ? heightDatumLabel(clouds[0].heightEpsg) : ''
  return (
    <div className="cloud3d">
      <div className="cloud3d-canvas">
        <canvas ref={canvasRef} tabIndex={0} />
        {state.phase !== 'ready' && <div className="cloud3d-loading">{t('cloud3d_loading')}</div>}
        {walking && (
          <div className="cloud3d-walk-hud">
            {fill('cloud3d_walk_hud', { station: walking.station.toFixed(1), across: walking.across.toFixed(1) })}
          </div>
        )}
      </div>
      <aside className="cloud3d-panel">
        <h1>{t('cloud3d_title')}</h1>
        <p className={mainThere ? 'cloud3d-hint' : 'cloud3d-warn'}>
          {mainThere ? t('cloud3d_main_connected')
            : project?.from === 'server' ? t('cloud3d_main_missing_server') : t('cloud3d_main_missing')}
        </p>

        <h2>{t('cloud3d_clouds')}</h2>
        {clouds.map(c => (
          <label key={c.key} className="cloud3d-check">
            <input type="checkbox" checked={c.visible}
              onChange={e => setClouds(list => list.map(x => (x.key === c.key ? { ...x, visible: e.target.checked } : x)))} />
            {options.coloring === 'cloud' && <span className="cloud3d-swatch" style={{ background: c.color }} />}
            <span>{c.name}</span>
          </label>
        ))}
        {state.viewCrs && (
          <p className="cloud3d-hint">{fill('cloud3d_plane', { crs: crsName(state.viewCrs) ?? `EPSG ${state.viewCrs}`, height: heightName })}</p>
        )}

        <h2>{t('cloud3d_display')}</h2>
        <label className="cloud3d-field">
          <span>{t('cloud3d_coloring')}</span>
          <select value={options.coloring ?? 'intensity'} onChange={e => setOptions(o => ({ ...o, coloring: e.target.value }))}>
            {colorings.map(c => <option key={c} value={c}>{t(`cloud3d_coloring_${c}`)}</option>)}
          </select>
        </label>
        <label className="cloud3d-field">
          <span>{fill('cloud3d_budget', { n: options.budget })}</span>
          <input type="range" min={2} max={15} step={1} value={options.budget}
            onChange={e => setOptions(o => ({ ...o, budget: Number(e.target.value) }))} />
        </label>
        <label className="cloud3d-field">
          <span>{t('cloud3d_size')}</span>
          <input type="range" min={0.5} max={3} step={0.25} value={options.sizeFactor}
            onChange={e => setOptions(o => ({ ...o, sizeFactor: Number(e.target.value) }))} />
        </label>
        <label className="cloud3d-check">
          <input type="checkbox" checked={options.edl} onChange={e => setOptions(o => ({ ...o, edl: e.target.checked }))} />
          <span>{t('cloud3d_edl')}</span>
        </label>
        {status && (
          <p className="cloud3d-hint cloud3d-status">
            {fill('cloud3d_status', { points: status.points.toLocaleString(), tiles: status.tiles })}
            {status.loading > 0 && ` · ${fill('cloud3d_status_loading', { n: status.loading })}`}
          </p>
        )}

        <h2>{t('cloud3d_camera')}</h2>
        <div className="cloud3d-buttons">
          <button type="button" onClick={() => { stopWalk(); viewerRef.current?.controls.update() }} disabled={!walking}>{t('cloud3d_orbit')}</button>
          <button type="button" onClick={() => { stopWalk(); viewerRef.current?.topView() }}>{t('cloud3d_top')}</button>
        </div>
        <label className="cloud3d-field">
          <span>{t('cloud3d_walk_track')}</span>
          <select value={walkTrack} onChange={e => setWalkTrack(e.target.value)}>
            <option value="">{t('cloud3d_choose')}</option>
            {tracks.map(tr => <option key={tr.id} value={tr.id}>{tr.label}</option>)}
          </select>
        </label>
        <div className="cloud3d-buttons">
          <button type="button" disabled={!walkTrack} onClick={startWalk}>{t('cloud3d_walk')}</button>
        </div>
        <p className="cloud3d-hint">{t(walking ? 'cloud3d_walk_keys' : 'cloud3d_orbit_keys')}</p>

        <h2>{t('cloud3d_measure')}</h2>
        <label className="cloud3d-check">
          <input type="checkbox" checked={measuring} onChange={e => setMeasuring(e.target.checked)} />
          <span>{t('cloud3d_measure_on')}</span>
        </label>
        <p className="cloud3d-hint">{t('cloud3d_measure_hint')}</p>
        {measured.length > 0 && (
          <>
            <ol className="cloud3d-points">
              {measured.map((p, i) => {
                const d = i > 0 ? between(measured[i - 1], p) : null
                return (
                  <li key={i}>
                    <span>{`E ${p.e.toFixed(3)} · N ${p.n.toFixed(3)} · H ${p.z.toFixed(3)}`}</span>
                    {p.track && (
                      <span className="cloud3d-hint">
                        {fill('cloud3d_point_track', {
                          track: p.track, station: p.station.toFixed(2), offset: p.offset.toFixed(3),
                          so: p.overSo != null ? p.overSo.toFixed(3) : '–',
                        })}
                      </span>
                    )}
                    {d && (
                      <span className="cloud3d-hint">
                        {fill('cloud3d_point_between', { d: d.distance.toFixed(3), dh: d.dh.toFixed(3), h: d.horizontal.toFixed(3) })}
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
            <div className="cloud3d-buttons">
              <button type="button" onClick={() => downloadText(measurementsCsv(measured, { crs: state.viewCrs, heightName }),
                'messpunkte_3d.csv', 'text/csv')}>{t('cloud3d_csv')}</button>
              <button type="button" onClick={() => setMeasured([])}>{t('cloud3d_clear')}</button>
            </div>
          </>
        )}
        {note && <p className="cloud3d-warn">{note}</p>}
        <p className="cloud3d-hint">{t('cloud3d_dblclick_hint')}</p>
      </aside>
    </div>
  )
}
