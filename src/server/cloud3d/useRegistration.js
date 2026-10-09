import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { serverLevel } from '../../core/utils/pointCloud/projectClouds'
import { cloudPlane, cloudToPlane, planeMapper } from '../../core/utils/pointCloud/cloudCrs'
import { solveRegistration, applyMatrix, IDENTITY } from '../../core/utils/pointCloud/registration'
import { cloudPlacement } from './placement'
import { PALETTE } from '../../core/styles/palette'

/**
 * Re-referencing a cloud in the 3D window (AP 13.13, 13.14): a session holds
 * the reference cloud and the cloud to be fitted, the pairs picked in both —
 * in 3D here, in the cross section of the main window (sent over the
 * channel) — and the parameters asked for. Every change solves anew
 * (registration.js); the fitted cloud is drawn where the solution puts it
 * (placement.js), so a pair that does not fit shows at once.
 *
 * Coordinates of a pair: `ref` in the reference cloud's plane — where it is
 * read, through its own re-referencing if it has one —, `src` in the fitted
 * cloud's file carried into that plane (left as it is for a cloud in a local
 * system). T maps `src` onto `ref`, and is stored with that plane (decision
 * 211): cloudToPlane reads the cloud through it from then on.
 */

/** The colour the fitted cloud is drawn in where it was not drawn before. */
const FITTED_COLOR = PALETTE.view3dPairSrc

const levelCache = new Map()
/** Levels 1–4 of a server cloud, as the viewer takes them. */
function levelsOf(projectId, row) {
  const key = `${row.id}|${row.readyAt}|${row.transform?.id ?? ''}`
  if (!levelCache.has(key)) {
    levelCache.set(key, Promise.all([1, 2, 3, 4].map(l => serverLevel(projectId, row, l)))
      .then(ls => Object.fromEntries(ls.map((index, k) => [k + 1, index]))))
  }
  return levelCache.get(key)
}

/** Post on the channel in `ref` — a closed one (the window going away) takes nothing. */
function postOn(ref, msg) {
  try { ref.current?.postMessage(msg) } catch { /* closed */ }
}

export default function useRegistration({ projectId, rows, viewerRef, viewCrs, ready, channelRef, onSaved }) {
  // A message to the main window — none where the channel is closed already.
  const post = (msg) => postOn(channelRef, msg)
  const [session, setSession] = useState(null)   // { refId, adjId }
  const [pairs, setPairs] = useState([])
  const [options, setOptions] = useState({ tilts: false, scale: false })
  const [picking, setPicking] = useState(false)
  const [pending, setPending] = useState(null)   // { side: 'ref' | 'adj', point, cloud }
  const [split, setSplit] = useState(false)
  const [history, setHistory] = useState([])
  const [message, setMessage] = useState(null)   // { kind, key, params }

  const refRow = rows.find(r => r.id === session?.refId) ?? null
  const adjRow = rows.find(r => r.id === session?.adjId) ?? null
  const refPlane = refRow ? cloudPlane(refRow) : null
  // Section pairs alone start from the transformation in force, if it is in the same plane.
  const start = adjRow?.transform && Number(adjRow.transform.crs) === Number(refPlane) ? adjRow.transform.matrix : null
  const solution = useMemo(
    () => (refRow && adjRow && pairs.some(p => p.on !== false) ? solveRegistration(pairs, { ...options, start }) : null),
    [refRow, adjRow, pairs, options, start],
  )
  // Where the fitted cloud is drawn: by the solution, else by what is in force
  // — a cloud of a known system where it is, one of a local system nowhere.
  const preview = solution?.ok ? solution.matrix : (start ?? (adjRow?.crs != null ? IDENTITY : null))
  const previewKey = preview ? preview.map(v => v.toPrecision(12)).join(',') : ''

  // ── drawing the fitted cloud where the preview puts it ────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !ready || !adjRow || !refPlane) return undefined
    let live = true
    levelsOf(projectId, adjRow).then((levels) => {
      if (!live || viewerRef.current !== viewer) return
      if (!preview) {
        if (viewer.hasCloud(adjRow.id) && adjRow.crs == null) viewer.removeCloud(adjRow.id)
        return
      }
      const place = cloudPlacement(levels[1], viewCrs, { matrix: preview, crs: refPlane })
      if (viewer.hasCloud(adjRow.id)) viewer.setPlacement(adjRow.id, place)
      else viewer.addCloud({ key: adjRow.id, row: adjRow, levels, place, color: FITTED_COLOR })
    })
    return () => { live = false }
    // the preview by its key: a new array of the same matrix moves nothing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, adjRow?.id, refPlane, previewKey, viewCrs])

  /** Put a cloud back where it is read without a session. */
  const restore = async (row) => {
    const viewer = viewerRef.current
    if (!viewer || !row || !viewer.hasCloud(row.id)) return
    if (row.crs == null && !row.transform) { viewer.removeCloud(row.id); return }
    const levels = await levelsOf(projectId, row)
    viewer.setPlacement(row.id, cloudPlacement(levels[1], viewCrs))
  }

  // ── the session ────────────────────────────────────────────────────────────
  const begin = (refId, adjId) => {
    if (adjRow && adjRow.id !== adjId) restore(adjRow)
    // Half a session — one cloud chosen — shows the history of the cloud to be fitted.
    setSession(refId || adjId ? { refId: refId && refId !== adjId ? refId : null, adjId: adjId || null } : null)
    setPairs([])
    setPending(null)
    setMessage(null)
    setSplit(Boolean(adjId) && rows.find(r => r.id === adjId)?.crs == null && !rows.find(r => r.id === adjId)?.transform)
  }
  const end = () => {
    restore(adjRow)
    setSession(null)
    setPairs([])
    setPending(null)
    setPicking(false)
    setSplit(false)
  }

  const loadHistory = () => {
    if (!adjRow) return
    api.cloudTransforms(projectId, adjRow.id).then(r => setHistory(r.transforms)).catch(() => setHistory([]))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (adjRow) loadHistory(); else setHistory([]) }, [adjRow?.id, adjRow?.transform?.id])

  // The main window learns of the session — its cross section shows both
  // clouds and lets pairs be picked there.
  const sessionMsg = session && refRow && adjRow
    ? { refId: refRow.id, adjId: adjRow.id, refPlane, matrix: preview, refName: refRow.name, adjName: adjRow.name }
    : null
  const sessionKey = sessionMsg ? `${sessionMsg.refId}|${sessionMsg.adjId}|${refPlane}|${previewKey}` : ''
  useEffect(() => {
    post({ type: 'registration', session: sessionMsg })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])
  useEffect(() => {
    // Closed or left, the window takes its session along.
    const gone = () => postOn(channelRef, { type: 'registration', session: null })
    window.addEventListener('pagehide', gone)
    return () => { window.removeEventListener('pagehide', gone); gone() }
  }, [channelRef])
  /** Say again what the session is — a cross section opened later asks. */
  const announce = () => post({ type: 'registration', session: sessionMsg })

  // ── pairs ──────────────────────────────────────────────────────────────────
  const nextId = () => {
    const used = new Set(pairs.map(p => p.id))
    let k = pairs.length + 1
    while (used.has(`P${k}`)) k++
    return `P${k}`
  }
  const addPair = (pair) => setPairs(list => [...list, { id: nextId(), label: '', on: true, ...pair }])

  /** A point of the reference cloud's file, where the pair takes it. */
  const refPoint = (file) => {
    const map = cloudToPlane(refRow, refPlane)
    return map ? map(...file) : [...file]
  }
  /** A point of the fitted cloud's file, carried into the reference plane — not through any T. */
  const srcPoint = (file) => {
    if (adjRow.crs == null || Number(adjRow.crs) === Number(refPlane)) return [...file]
    const [e, n] = planeMapper(adjRow.crs, refPlane)(file[0], file[1])
    return [e, n, file[2]]
  }

  /**
   * A point picked in 3D (`cloudId`, its original `file` coordinates): one of
   * each cloud makes a pair, in either order. `bearing` the track's there,
   * for the residuals across and along.
   */
  const pick = ({ cloudId, file, bearing = null }) => {
    if (!refRow || !adjRow) return
    const side = cloudId === session.refId ? 'ref' : cloudId === session.adjId ? 'adj' : null
    if (!side) { setMessage({ kind: 'warn', key: 'cloud3d_reg_pick_other' }); return }
    const point = side === 'ref' ? refPoint(file) : srcPoint(file)
    setMessage(null)
    if (pending && pending.side !== side) {
      const ref = side === 'ref' ? point : pending.point
      const src = side === 'adj' ? point : pending.point
      addPair({ kind: '3d', ref, src, ...(bearing ?? pending.bearing) != null ? { bearing: bearing ?? pending.bearing } : {} })
      setPending(null)
    } else {
      setPending({ side, point, bearing })
    }
  }

  /** A pair from the cross section of the main window. */
  const receive = (pair) => {
    if (!refRow || !adjRow || pair?.refId !== refRow.id || pair?.adjId !== adjRow.id) return
    addPair({ kind: 'section', ref: pair.ref, src: pair.src, bearing: pair.bearing })
  }

  const update = (id, change) => setPairs(list => list.map(p => (p.id === id ? { ...p, ...change } : p)))
  const remove = (id) => setPairs(list => list.filter(p => p.id !== id))

  // ── keeping it ─────────────────────────────────────────────────────────────
  const save = async (meta) => {
    if (!solution?.ok) return
    try {
      await api.saveCloudTransform(projectId, adjRow.id, {
        matrix: solution.matrix,
        crs: Number(refPlane),
        referenceCloudId: refRow.id,
        params: {
          options, estimated: solution.estimated, values: solution.params, sigmas: solution.sigmas,
          sigma0: solution.sigma0, rms: solution.rms, max: solution.max, centre: solution.centre,
          equations: solution.equations, unknowns: solution.unknowns, ...meta,
        },
        pairs,
        residuals: Object.fromEntries(solution.residuals.map(r => [r.id, r])),
      })
      setMessage({ kind: 'done', key: 'cloud3d_reg_saved' })
      post({ type: 'clouds' })
      await onSaved?.()
    } catch (err) {
      setMessage({ kind: 'warn', key: `cloud3d_reg_err_${err.code}`, fallback: err.message })
    }
  }

  /** Put an earlier transformation in force again, or none. */
  const activate = async (id) => {
    try {
      await api.activateCloudTransform(projectId, adjRow.id, id)
      post({ type: 'clouds' })
      await onSaved?.()
    } catch (err) {
      setMessage({ kind: 'warn', key: `cloud3d_reg_err_${err.code}`, fallback: err.message })
    }
  }

  /** Where the pairs are drawn in the view: the reference's points, and the fitted cloud's moved by the preview. */
  const markers = useMemo(() => {
    if (!refPlane || !viewCrs) return { ref: [], src: [] }
    const toView = planeMapper(refPlane, viewCrs)
    const put = ([e, n, z]) => { const [x, y] = toView(e, n); return [x, y, z] }
    return {
      ref: pairs.map(p => put(p.ref)),
      src: preview ? pairs.map(p => put(applyMatrix(preview, p.src))) : [],
      pending: pending ? [put(pending.side === 'ref' || !preview ? pending.point : applyMatrix(preview, pending.point))] : [],
    }
  }, [pairs, pending, preview, refPlane, viewCrs])

  return {
    session, refRow, adjRow, refPlane, begin, end, announce,
    pairs, update, remove, receive, pick, pending, clearPending: () => setPending(null),
    options, setOptions, solution, preview,
    picking, setPicking, split, setSplit,
    history, activate, save, message, markers,
  }
}
