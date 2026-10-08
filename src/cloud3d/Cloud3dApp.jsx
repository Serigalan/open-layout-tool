import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { api, setShareLink } from '../api/client'
import I18nProvider from '../locales/I18nProvider'
import { useI18n } from '../locales/i18nContext'
import { languageLabels } from '../locales/i18n'
import { serverLevel, readableOnServer } from '../utils/pointCloud/projectClouds'
import { projectPlane } from '../utils/pointCloud/cloudProbe'
import { planeMapper, cloudPlane } from '../utils/pointCloud/cloudCrs'
import { loadGridsFor } from '../utils/ntv2Grid'
import { crsDatum, crsName, utmToWgs84 } from '../utils/coordinateUtils'
import { heightDatumLabel } from '../utils/heightDatums'
import { GAUGE_PROFILES, gaugeProfile, gaugeProfileRing, gaugeProfileLabelKey, DEFAULT_GAUGE_PROFILE } from '../utils/gaugeProfiles'
import { surveyPoints } from '../utils/axisSurvey'
import { trackLabel } from '../utils/trackModel'
import { downloadText } from '../utils/fileUtils'
import { Viewer } from './viewer'
import { COLORINGS, CLOUD_COLORS } from './shaders'
import { cloud3dParams, openChannel } from './channel'
import { trackSamples, trackLines, nearestOnTracks, sectionPlane, routeSamples, CLEARANCE_LENGTH, CLEARANCE_AHEAD } from './trackGeometry'
import { resolveRoute, routeStationOf } from '../utils/routes'
import { cloudPlacement } from './placement'
import useRegistration from './useRegistration'
import RegistrationPanel from './RegistrationPanel'
import SharePanel from './SharePanel'
import { originalPoint, between, measurementsCsv } from './measure'
import { PALETTE } from '../styles/palette'
import './cloud3d.css'

/** How long the 3D window waits for the main window before it reads the server's head [ms]. */
const MAIN_WAIT = 1200
/** The main window counts as gone when it has not answered for this long [ms]. */
const MAIN_TIMEOUT = 7000

const LOOK = {
  survey: PALETTE.view3dSurvey,
  plane: PALETTE.view3dPlane, outline: PALETTE.view3dOutline, pick: PALETTE.view3dPick,
  pairRef: PALETTE.view3dPairRef, pairSrc: PALETTE.view3dPairSrc,
}

/**
 * How the tracks are drawn — the colours of axis and rails and the width of
 * the lines [px]: the viewer's own choice, kept in this browser (v2: the
 * defaults changed, a light yellow axis and red rails).
 */
const TRACK_LOOK_KEY = 'olt.cloud3d.trackLook.v2'
const TRACK_LOOK = { axis: PALETTE.view3dAxis, left: PALETTE.view3dRail, right: PALETTE.view3dRail, width: 3 }
/** The axis is drawn dashed, as on a plan: dash and gap along it [m]. */
const AXIS_DASH = [1.5, 1]

function loadTrackLook() {
  try {
    return { ...TRACK_LOOK, ...JSON.parse(localStorage.getItem(TRACK_LOOK_KEY) ?? '{}') }
  } catch {
    return { ...TRACK_LOOK }
  }
}

function saveTrackLook(look) {
  try { localStorage.setItem(TRACK_LOOK_KEY, JSON.stringify(look)) } catch { /* kept for this window only */ }
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
  const { t, fill, language, setLanguage } = useI18n()
  // Opened through a share link, the project is learnt from the link.
  const [params, setParams] = useState(cloud3dParams)
  const shared = Boolean(params?.share)
  const [shareInfo, setShareInfo] = useState(null)   // { projectTitle, variantName, label, expiresAt } through a link
  const [state, setState] = useState({ phase: 'loading' })   // loading | anon | none | error | ready
  const [project, setProject] = useState(null)   // { data, from: 'main' | 'server' }
  const [mainSeen, setMainSeen] = useState(0)
  const [section, setSection] = useState(null)
  const [clouds, setClouds] = useState([])        // rows shown, with { key, color, visible, l0 }
  const [allRows, setAllRows] = useState([])      // every ready cloud of the project, local systems too (AP 13.13)
  const [mayEdit, setMayEdit] = useState(false)
  const [user, setUser] = useState(null)
  const [options, setOptions] = useState({ coloring: null, budget: 6, sizeFactor: 1, edl: true, edlStrength: 0.6 })
  const [status, setStatus] = useState(null)
  const [cameraMode, setCameraMode] = useState('orbit')   // orbit | top | track
  const [walkTrack, setWalkTrack] = useState('')
  const [walking, setWalking] = useState(null)    // { station, across } while walking
  const [trackLook, setTrackLook] = useState(loadTrackLook)
  const [clearanceOn, setClearanceOn] = useState(false)
  const [clearanceChoice, setClearanceChoice] = useState('')   // a profile of the catalogue; '' the project's
  const [tracksSampled, setTracksSampled] = useState([])   // geometryRef's tracks, as state for the drawing
  const [routesSampled, setRoutesSampled] = useState([])   // geometryRef's routes (Paket RT): { id, label, resolved, samples }
  const [measuring, setMeasuring] = useState(false)
  const [measured, setMeasured] = useState([])
  const [note, setNote] = useState(null)
  const canvasRef = useRef(null)
  const viewerRef = useRef(null)
  const channelRef = useRef(null)
  const geometryRef = useRef(null)                 // { viewCrs, origin, tracks: [{ id, label, samples }] }
  const splitCanvasRef = useRef(null)
  const splitViewerRef = useRef(null)
  const regRef = useRef(null)
  const l0s = useRef(new Map())                    // cloud id → Promise<index of L0>

  /**
   * The view through a read-only share link: no session, no main window —
   * the clouds the link names and its variant's checked-in head, read under
   * the link's token.
   */
  const openShared = () => {
    let live = true
    setShareLink(params.share)
    ;(async () => {
      let info
      try {
        info = await api.share(params.share)
      } catch (err) {
        if (live) setState({ phase: 'error', text: t(err.status === 404 ? 'cloud3d_share_gone' : 'cloud3d_share_failed') })
        return
      }
      if (!live) return
      const { share, clouds: rows } = info
      document.title = `3D · ${share.projectTitle} · Open Layout Tool`
      setShareInfo(share)
      setParams(p => ({ ...p, projectId: share.projectId }))
      setAllRows(rows)
      const ready = rows.filter(readableOnServer)
      if (!ready.length) { setState({ phase: 'none' }); return }
      setClouds(ready.map((r, k) => ({ ...r, key: r.id, color: CLOUD_COLORS[k % CLOUD_COLORS.length], visible: true })))
      const payload = share.variantName ? await api.head().then(r => r.payload).catch(() => null) : null
      if (live) setProject({ data: payload, from: payload ? 'server' : 'none' })
    })()
    return () => { live = false }
  }

  // ── the session, the clouds and the project ─────────────────────────────
  useEffect(() => {
    if (shared) return openShared()
    if (!params?.projectId) { setState({ phase: 'error', text: t('cloud3d_no_project') }); return }
    document.title = `3D · Open Layout Tool`
    let live = true
    const ch = openChannel(params.projectId, (msg) => {
      if (!live) return
      if (msg.type === 'pong' || msg.type === 'project' || msg.type === 'section') setMainSeen(Date.now())
      if (msg.type === 'project') setProject({ data: msg.data, from: 'main' })
      if (msg.type === 'section') setSection(msg.at)
      if (msg.type === 'pair') regRef.current?.receive(msg.pair)
      if (msg.type === 'registration?') regRef.current?.announce()
    })
    channelRef.current = ch
    ch?.postMessage({ type: 'hello' })
    ;(async () => {
      try {
        setUser((await api.me()).user ?? null)
      } catch {
        if (live) setState({ phase: 'anon' })
        return
      }
      try {
        const { clouds: rows, mayEdit: may } = await api.clouds(params.projectId)
        const ready = rows.filter(readableOnServer)
        if (!live) return
        setAllRows(rows.filter(r => r.status === 'ready'))
        setMayEdit(Boolean(may))
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
    return () => { live = false; clearInterval(ping); ch?.close(); if (channelRef.current === ch) channelRef.current = null }
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
      const viewCrs = projectPlane(tracks) ?? cloudPlane(clouds[0])
      const b0 = clouds[0].bounds
      const levels = await Promise.all(clouds.map(async (c) => {
        const ls = await Promise.all([1, 2, 3, 4].map(l => serverLevel(params.projectId, c, l)))
        return Object.fromEntries(ls.map((index, k) => [k + 1, index]))
      }))
      // Grids for the conversions, where planes of other datums meet: the
      // first cloud's corners as the view will show them.
      const datums = [...new Set([viewCrs, ...clouds.flatMap(c => [c.crs, c.transform?.crs])].map(crsDatum).filter(Boolean))]
      const first = cloudPlacement(levels[0][1], viewCrs)
      const lo = first.toView(b0.minE, b0.minN, b0.minZ), hi = first.toView(b0.maxE, b0.maxN, b0.maxZ)
      const [w, s] = utmToWgs84(Math.min(lo[0], hi[0]), Math.min(lo[1], hi[1]), viewCrs)
      const [e, n] = utmToWgs84(Math.max(lo[0], hi[0]), Math.max(lo[1], hi[1]), viewCrs)
      if (datums.length) await loadGridsFor([Math.min(w, e) - 0.05, Math.min(s, n) - 0.05, Math.max(w, e) + 0.05, Math.max(s, n) + 0.05], datums).catch(() => {})
      const [ce, cn, cz] = first.toView((b0.minE + b0.maxE) / 2, (b0.minN + b0.maxN) / 2, b0.minZ)
      const origin = [Math.round(ce / 10) * 10, Math.round(cn / 10) * 10, Math.floor(cz)]
      const zRange = [Math.min(...clouds.map(c => c.bounds.minZ)), Math.max(...clouds.map(c => c.bounds.maxZ))]
      if (!live || !canvasRef.current) return
      const viewer = new Viewer(canvasRef.current, {
        projectId: params.projectId, origin, viewCrs, zRange,
        onStatus: setStatus,
        onDoubleClick: (hit) => onDoubleClickRef.current?.(hit),
      })
      clouds.forEach((c, k) => viewer.addCloud({
        key: c.key, row: c, levels: levels[k], place: cloudPlacement(levels[k][1], viewCrs), color: c.color,
      }))
      viewer.initWorkers({ base: document.baseURI, box: [Math.min(w, e) - 0.05, Math.min(s, n) - 0.05, Math.max(w, e) + 0.05, Math.max(s, n) + 0.05] })
      // The cloud asked for (or the first) fills the view; the others may lie
      // kilometres away.
      const box = new THREE.Box3()
      for (const r of viewer.clouds[0].roots) box.union(r.view)
      viewer.frame(box)
      viewer.setOptions({ coloring: clouds.some(c => c.rgb) ? 'rgb' : 'intensity', budget: 6e6 })
      viewerRef.current = viewer
      // For the checks in a headless browser (the dev server only).
      if (import.meta.env.DEV) window.__olt3d = { viewer, split: () => splitViewerRef.current }
      geometryRef.current = { viewCrs, origin, tracks: [], routes: [] }
      setOptions(o => ({ ...o, coloring: clouds.some(c => c.rgb) ? 'rgb' : 'intensity' }))
      setState({ phase: 'ready', viewCrs })
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  useEffect(() => () => viewerRef.current?.dispose(), [])

  // ── re-referencing (AP 13.13, 13.14) ─────────────────────────────────────
  /** The clouds again from the server — after a re-referencing was kept or put back. */
  const reloadRows = async () => {
    const { clouds: rows } = await api.clouds(params.projectId)
    const fresh = rows.filter(r => r.status === 'ready')
    setAllRows(fresh)
    setClouds(list => list.map(c => ({ ...c, ...(fresh.find(r => r.id === c.id) ?? {}), key: c.key, color: c.color, visible: c.visible })))
    // Clouds not being fitted move to where their re-referencing in force puts them.
    const viewer = viewerRef.current
    for (const r of fresh) {
      if (!viewer?.hasCloud(r.id) || r.id === regRef.current?.adjRow?.id) continue
      const levels = await Promise.all([1, 2, 3, 4].map(l => serverLevel(params.projectId, r, l)))
      viewer.setPlacement(r.id, cloudPlacement(levels[0], state.viewCrs))
    }
  }
  const reg = useRegistration({
    projectId: params?.projectId, rows: allRows, viewerRef, viewCrs: state.viewCrs, ready: state.phase === 'ready',
    channelRef, onSaved: reloadRows,
  })
  useEffect(() => { regRef.current = reg })

  // The pairs in the view: the reference's points, the fitted cloud's where the preview puts them.
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    const { ref, src, pending } = reg.markers
    v.setOverlay('pairs', [
      ...(ref.length ? [v.markers(ref, LOOK.pairRef, 9)] : []),
      ...(src.length ? [v.markers(src, LOOK.pairSrc, 6)] : []),
      ...(pending?.length ? [v.markers(pending, LOOK.pick, 11)] : []),
    ])
  }, [reg.markers])

  // In the split view the main view shows the reference cloud alone.
  const splitOn = reg.split && !!reg.adjRow
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    for (const c of v.clouds) {
      const row = clouds.find(x => x.key === c.key)
      v.setCloudVisible(c.key, splitOn ? c.key === reg.refRow?.id : (row?.visible ?? true))
    }
  }, [splitOn, reg.refRow?.id, clouds, state.phase, reg.adjRow?.id, reg.preview])

  // The cloud to be fitted on its own, in its own frame, beside the reference (AP 13.13).
  const adjForSplit = splitOn ? reg.adjRow : null
  useEffect(() => {
    if (!adjForSplit || !splitCanvasRef.current) return undefined
    let live = true, viewer = null
    ;(async () => {
      const levels = await Promise.all([1, 2, 3, 4].map(l => serverLevel(params.projectId, adjForSplit, l)))
      if (!live || !splitCanvasRef.current) return
      const index = { ...levels[0], transform: null }
      const place = cloudPlacement(index, null, null)
      const b = levels[0].bounds
      viewer = new Viewer(splitCanvasRef.current, {
        projectId: params.projectId, origin: place.preOrigin, viewCrs: null, zRange: [b.minZ, b.maxZ],
      })
      viewer.addCloud({ key: adjForSplit.id, row: adjForSplit, levels: Object.fromEntries(levels.map((l, k) => [k + 1, l])), place, color: LOOK.pairSrc })
      viewer.initWorkers({ base: document.baseURI, box: null })
      const box = new THREE.Box3()
      for (const r of viewer.clouds[0].roots) box.union(r.view)
      viewer.frame(box)
      viewer.setOptions({ ...options, coloring: adjForSplit.rgb ? 'rgb' : 'intensity', budget: 3e6 })
      splitViewerRef.current = viewer
    })()
    return () => { live = false; viewer?.dispose(); splitViewerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjForSplit?.id])

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
    // The routes walked as one: their tracks' samples one after the other (decision 253).
    const byId = new Map(sampled.map(tr => [tr.id, tr.samples]))
    geo.routes = (project.data.routes ?? []).map(r => {
      const resolved = resolveRoute(r, tracks, switches)
      return { id: r.id, key: `route:${r.id}`, label: r.name, resolved, samples: routeSamples(resolved.parts, byId) }
    }).filter(r => r.samples.length > 1)
    setRoutesSampled(geo.routes)
    viewer.setOverlay('surveys', axisSurveys.map(s => {
      const toView = planeMapper(s.epsg, viewCrs)
      const pts = surveyPoints(s).map(p => { const [e, n] = toView(p.easting, p.northing); return [e, n, (p.zLeft + p.zRight) / 2] })
      return viewer.markers(pts, LOOK.survey, 3)
    }))
    setTracksSampled(sampled)
  }, [project, viewCrs])

  // The axis and the two rails, each in its colour and as wide as chosen.
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const objects = []
    for (const tr of tracksSampled) {
      const lines = trackLines(tr.samples)
      for (const run of lines.axis) objects.push(viewer.fatLine(run, trackLook.axis, trackLook.width, { dash: AXIS_DASH }))
      for (const run of lines.left) objects.push(viewer.fatLine(run, trackLook.left, trackLook.width))
      for (const run of lines.right) objects.push(viewer.fatLine(run, trackLook.right, trackLook.width))
    }
    viewer.setOverlay('tracks', objects)
  }, [tracksSampled, trackLook])
  const changeTrackLook = (key, value) => setTrackLook(l => { const next = { ...l, [key]: value }; saveTrackLook(next); return next })

  // The clearance envelope carried along while walking: the profile chosen
  // here, else the project's. The choice is this view's only — the project
  // keeps its own.
  const projectProfileId = gaugeProfile(project?.data?.gaugeProfile ?? DEFAULT_GAUGE_PROFILE).id
  const clearanceId = clearanceChoice || projectProfileId
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.setWalkClearance(clearanceOn ? gaugeProfileRing(gaugeProfile(clearanceId).points) : null, LOOK.outline)
  }, [clearanceOn, clearanceId, state.phase])

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
    const { place } = viewerRef.current.clouds.find(c => c.key === hit.node.cloud)
    const view = [hit.position[0] + oe, hit.position[1] + on, hit.position[2] + oz]
    const [ce, cn, cz] = place.toFile(...view)
    cloud.l0 ??= serverLevel(params.projectId, cloud, 0)
    const orig = await originalPoint(params.projectId, await cloud.l0, [ce, cn, cz]).catch(() => null)
    const [e, n, z] = orig ? place.toView(orig.e, orig.n, orig.z) : view
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
    if (shared) return
    const p = await resolve(hit)
    if (!p.trackId) { setNote(t('cloud3d_no_track_here')); return }
    if (!mainThere) { setNote(t('cloud3d_station_needs_main')); return }
    channelRef.current?.postMessage({ type: 'station', trackId: p.trackId, station: p.station })
    setNote(fill('cloud3d_station_set', { track: p.track, station: p.station.toFixed(1) }))
  }

  /**
   * The original point under a pick in `viewer` (the main view or the split
   * one), in its cloud's file — what a pair of the re-referencing takes.
   */
  const resolveFile = async (hit, viewer) => {
    const vc = viewer.clouds.find(c => c.key === hit.node.cloud)
    const [oe, on, oz] = viewer.origin
    const view = [hit.position[0] + oe, hit.position[1] + on, hit.position[2] + oz]
    const guess = vc.place.toFile(...view)
    const row = allRows.find(r => r.id === vc.key) ?? vc.row
    if (!l0s.current.has(row.id)) l0s.current.set(row.id, serverLevel(params.projectId, row, 0))
    const orig = await originalPoint(params.projectId, await l0s.current.get(row.id), guess).catch(() => null)
    const along = viewer === viewerRef.current ? nearestOnTracks(geometryRef.current?.tracks ?? [], view[0], view[1], 10) : null
    return { cloudId: vc.key, file: orig ? [orig.e, orig.n, orig.z] : guess, original: !!orig, bearing: along?.bearing ?? null }
  }

  // A click (not a drag) while measuring picks a point; while pairs are
  // picked it is one point of a pair. The split view picks pairs only.
  const picking = measuring || reg.picking
  useEffect(() => {
    const listen = (canvas, viewerOf) => {
      if (!canvas) return () => {}
      let down = null
      const onDown = (e) => { down = { x: e.clientX, y: e.clientY } }
      const onUp = async (e) => {
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return }
        down = null
        const viewer = viewerOf()
        const hit = viewer?.pickAt(e.offsetX, e.offsetY)
        if (!hit) { setNote(t('cloud3d_pick_none')); return }
        if (regRef.current?.picking) {
          const p = await resolveFile(hit, viewer)
          setNote(p.original ? null : t('cloud3d_pick_not_original'))
          regRef.current.pick(p)
          return
        }
        if (viewer !== viewerRef.current) return
        const p = await resolve(hit)
        setNote(p.original ? null : t('cloud3d_pick_not_original'))
        setMeasured(list => [...list, p])
      }
      canvas.addEventListener('pointerdown', onDown)
      canvas.addEventListener('pointerup', onUp)
      return () => { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp) }
    }
    if (!picking) return undefined
    const offMain = listen(canvasRef.current, () => viewerRef.current)
    const offSplit = listen(splitCanvasRef.current, () => splitViewerRef.current)
    return () => { offMain(); offSplit() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking, state.phase, splitOn, allRows])

  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    const pts = measured.map(p => [p.e, p.n, p.z])
    v.setOverlay('picks', pts.length ? [v.markers(pts, LOOK.pick, 8), ...(pts.length > 1 ? [v.line(pts, LOOK.pick)] : [])] : [])
  }, [measured])

  // ── the walk ───────────────────────────────────────────────────────────────
  /**
   * What the track view walks along, by the key the choice holds: a track by
   * its id, a route (Paket RT) as `route:<id>` — each { samples } at its own
   * stations.
   */
  const walkable = (key) => (String(key).startsWith('route:')
    ? geometryRef.current?.routes.find(r => r.key === key)
    : geometryRef.current?.tracks.find(x => x.id === key)) ?? null

  /**
   * Where the track view of a track or route begins: at the cross section of
   * the main window where it is on it, else where it passes the clouds, else
   * at its start.
   */
  const firstStation = (tr) => {
    if (tr.resolved) {
      if (section?.routeId === tr.id && Number.isFinite(section.routeStation)) return section.routeStation
      const s = section ? routeStationOf(tr.resolved, section.trackId, section.station) : null
      if (s != null) return s
    }
    if (section?.trackId === tr.id) return section.station
    const v = viewerRef.current
    const box = new THREE.Box3()
    for (const r of v?.clouds[0]?.roots ?? []) box.union(r.view)
    if (!box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3())
      const hit = nearestOnTracks([tr], c.x + v.origin[0], c.y + v.origin[1], Infinity)
      if (hit) return hit.station
    }
    return tr.samples.find(p => p.z != null)?.s ?? 0
  }

  /** Stand on a track or route in the track view, at `station` or where it begins. */
  const walkOn = (id, station = null) => {
    const viewer = viewerRef.current
    const tr = walkable(id)
    if (!viewer || !tr) { viewer?.stopWalk(); setWalking(null); return }
    if (viewer.startWalk(tr.samples, station ?? firstStation(tr))) {
      setWalking(viewer.walkState())
      setNote(null)
      canvasRef.current?.focus()
    } else {
      viewer.stopWalk()
      setWalking(null)
      setNote(t('cloud3d_walk_no_gradient'))
    }
  }

  const chooseCamera = (mode) => {
    const viewer = viewerRef.current
    setCameraMode(mode)
    if (mode === 'track') { if (walkTrack) walkOn(walkTrack); return }
    setWalking(null)
    if (mode === 'top') viewer?.topView()
    else viewer?.orbit()
  }

  // The stretch of the chosen track or route the slider spans: where it has a gradient.
  const walkRange = useMemo(() => {
    const chosen = String(walkTrack).startsWith('route:')
      ? routesSampled.find(r => r.key === walkTrack) : tracksSampled.find(x => x.id === walkTrack)
    const usable = chosen?.samples.filter(p => p.z != null) ?? []
    return usable.length > 1 ? [usable[0].s, usable[usable.length - 1].s] : null
  }, [tracksSampled, routesSampled, walkTrack])

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
        <div className="cloud3d-view">
          <canvas ref={canvasRef} tabIndex={0} />
          {splitOn && <span className="cloud3d-view-label">{reg.refRow?.name}</span>}
        </div>
        {splitOn && (
          <div className="cloud3d-view cloud3d-view-split">
            <canvas ref={splitCanvasRef} tabIndex={0} />
            <span className="cloud3d-view-label">{reg.adjRow?.name}</span>
          </div>
        )}
        {state.phase !== 'ready' && <div className="cloud3d-loading">{t('cloud3d_loading')}</div>}
        {walking && (
          <div className="cloud3d-walk-hud">
            {fill('cloud3d_walk_hud', { station: walking.station.toFixed(1), across: walking.across.toFixed(1) })}
          </div>
        )}
      </div>
      <aside className="cloud3d-panel">
        <h1>{t('cloud3d_title')}</h1>
        {shared && (
          // Whoever opens a link may not have chosen a language in this app yet.
          <div className="cloud3d-langs">
            {Object.keys(languageLabels).map(lang => (
              <button key={lang} type="button" className={language === lang ? 'active' : undefined} onClick={() => setLanguage(lang)}>
                {languageLabels[lang]}
              </button>
            ))}
          </div>
        )}
        {shared ? (
          <p className="cloud3d-hint cloud3d-shared">
            <strong>{shareInfo?.projectTitle}</strong>
            {shareInfo?.variantName && ` · ${shareInfo.variantName}`}
            <br />
            {fill('cloud3d_shared_view', {
              until: shareInfo?.expiresAt
                ? fill('cloud3d_share_until', { date: new Date(shareInfo.expiresAt).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB') })
                : t('cloud3d_share_forever'),
            })}
          </p>
        ) : (
          <p className={mainThere ? 'cloud3d-hint' : 'cloud3d-warn'}>
            {mainThere ? t('cloud3d_main_connected')
              : project?.from === 'server' ? t('cloud3d_main_missing_server') : t('cloud3d_main_missing')}
          </p>
        )}

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
        <div className="cloud3d-colors">
          {['axis', 'left', 'right'].map(k => (
            <label key={k} className="cloud3d-color">
              <input type="color" value={trackLook[k]} onChange={e => changeTrackLook(k, e.target.value)} />
              <span>{t(`cloud3d_track_${k}`)}</span>
            </label>
          ))}
        </div>
        <label className="cloud3d-field">
          <span>{fill('cloud3d_line_width', { n: trackLook.width })}</span>
          <input type="range" min={1} max={10} step={0.5} value={trackLook.width}
            onChange={e => changeTrackLook('width', Number(e.target.value))} />
        </label>
        {status && (
          <p className="cloud3d-hint cloud3d-status">
            {fill('cloud3d_status', { points: status.points.toLocaleString(), tiles: status.tiles })}
            {status.loading > 0 && ` · ${fill('cloud3d_status_loading', { n: status.loading })}`}
          </p>
        )}

        <h2>{t('cloud3d_camera')}</h2>
        <div className="cloud3d-segmented" role="group" aria-label={t('cloud3d_camera')}>
          {['orbit', 'top', 'track'].map(m => (
            <button key={m} type="button" className={cameraMode === m ? 'active' : undefined} aria-pressed={cameraMode === m}
              onClick={() => chooseCamera(m)}>{t(`cloud3d_view_${m}`)}</button>
          ))}
        </div>
        <div className="cloud3d-view-details">
          {cameraMode === 'orbit' && <p className="cloud3d-hint">{t('cloud3d_view_orbit_hint')}</p>}
          {cameraMode === 'top' && <p className="cloud3d-hint">{t('cloud3d_view_top_hint')}</p>}
          {cameraMode === 'track' && (
            <>
              <p className="cloud3d-hint">{t('cloud3d_view_track_hint')}</p>
              <label className="cloud3d-field">
                <span>{t('cloud3d_walk_track')}</span>
                <select value={walkTrack} onChange={e => { setWalkTrack(e.target.value); walkOn(e.target.value) }}>
                  <option value="">{t('cloud3d_choose')}</option>
                  {routesSampled.length > 0 && (
                    <optgroup label={t('routes')}>
                      {routesSampled.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                    </optgroup>
                  )}
                  <optgroup label={t('cloud3d_tracks_group')}>
                    {tracks.map(tr => <option key={tr.id} value={tr.id}>{tr.label}</option>)}
                  </optgroup>
                </select>
              </label>
              {walking && walkRange && (
                <label className="cloud3d-field">
                  <span>{fill('cloud3d_walk_station', { s: walking.station.toFixed(1) })}</span>
                  <input type="range" min={walkRange[0]} max={walkRange[1]} step={0.5} value={walking.station}
                    onChange={e => { viewerRef.current?.setWalkStation(Number(e.target.value)); setWalking(viewerRef.current?.walkState() ?? null) }} />
                  <span className="cloud3d-range-ends">
                    <span>{`${walkRange[0].toFixed(0)} m`}</span><span>{`${walkRange[1].toFixed(0)} m`}</span>
                  </span>
                </label>
              )}
              <label className="cloud3d-check">
                <input type="checkbox" checked={clearanceOn} onChange={e => setClearanceOn(e.target.checked)} />
                <span>{fill('cloud3d_clearance', { m: CLEARANCE_LENGTH })}</span>
              </label>
              {clearanceOn && (
                <>
                  <label className="cloud3d-field">
                    <span>{t('cloud3d_clearance_profile')}</span>
                    <select value={clearanceChoice} onChange={e => setClearanceChoice(e.target.value)}>
                      <option value="">{fill('cloud3d_clearance_project', { profile: t(gaugeProfileLabelKey(projectProfileId)) })}</option>
                      {Object.keys(GAUGE_PROFILES).map(id => <option key={id} value={id}>{t(gaugeProfileLabelKey(id))}</option>)}
                    </select>
                  </label>
                  <p className="cloud3d-hint">{fill('cloud3d_clearance_hint', {
                    profile: t(gaugeProfileLabelKey(clearanceId)), m: CLEARANCE_LENGTH, ahead: CLEARANCE_AHEAD,
                  })}</p>
                </>
              )}
              {walking && <p className="cloud3d-hint">{t('cloud3d_walk_keys')}</p>}
            </>
          )}
        </div>

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
        {!shared && (
          <>
            <p className="cloud3d-hint">{t('cloud3d_dblclick_hint')}</p>
            <RegistrationPanel reg={reg} rows={allRows} mayEdit={mayEdit} userName={user?.name ?? ''}
              projectTitle={project?.data?.title ?? ''} heightName={heightName} />
            {state.phase === 'ready' && <SharePanel projectId={params.projectId} variantId={params.variantId} rows={allRows} />}
          </>
        )}
      </aside>
    </div>
  )
}
