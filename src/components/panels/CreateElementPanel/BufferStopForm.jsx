import { useEffect, useMemo, useRef, useState } from 'react'
import { loadTracks, loadSwitches, loadEndMarks, saveEndMark, deleteEndMark } from '../../../storage'
import { classifyTrackEnds, freeEnds } from '../../../utils/topology'
import {
  BUFFER_STOP_TYPES, DEFAULT_BUFFER_STOP_TYPE, BUFFER_STOP_LENGTH, BUFFER_STOP,
  defaultBrakeLength, bufferStopFits, newBufferStop,
} from '../../../utils/trackEndMarks'
import { bufferStopFeatures } from '../../../utils/bufferStopGeometry'
import { trackLength } from '../../../utils/heightUtils'
import usePreviewLayers from '../../../hooks/usePreviewLayers'
import { mapIsLive } from '../../../utils/mapConstants'

/** How close (px) the cursor has to come to an end for it to be the one meant. */
const PICK_PX = 14

const ENDS_SOURCE   = 'buffer-stop-ends-source'
const SHAPE_SOURCE  = 'buffer-stop-preview-source'
const BRAKE_SOURCE  = 'buffer-stop-preview-brake-source'

const PREVIEW_LAYERS = [
  {
    sourceId: BRAKE_SOURCE,
    layer: {
      id: 'buffer-stop-preview-brake-layer', type: 'line',
      paint: { 'line-color': '#a52a1f', 'line-width': 3, 'line-dasharray': [1.5, 1] },
    },
  },
  {
    sourceId: SHAPE_SOURCE,
    layer: {
      id: 'buffer-stop-preview-layer', type: 'line',
      paint: { 'line-color': '#a52a1f', 'line-width': 5 },
    },
  },
  {
    sourceId: ENDS_SOURCE,
    layer: {
      id: 'buffer-stop-ends-layer', type: 'circle',
      paint: {
        'circle-radius': ['case', ['get', 'active'], 7, 5],
        'circle-color': ['case', ['get', 'active'], '#ff8c00', '#6c5ce7'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    },
  },
]

const EMPTY = { type: 'FeatureCollection', features: [] }
const keyOf = (end) => (end ? `${end.trackId}|${end.endpoint}` : null)

/**
 * Put a buffer stop on a free track end, or — `edit` — change or remove one
 * that stands. The ends to choose from are drawn on the map as dots, and the
 * one under the cursor is the one a click takes: an end is a point, and a
 * point is easier hit from a dot than from a line that runs on either side of
 * it.
 *
 * Type and brake length are the whole of a buffer stop (ROADMAP decisions 76,
 * 77): the type proposes the brake length until the brake length has been
 * typed in by hand, and the stop is 2.20 m long in front of it.
 */
export default function BufferStopForm({ t, map, project, onTrackSaved, onCommitted, edit = false }) {
  const [version, setVersion] = useState(0)
  const { tracks, candidates, marks } = useMemo(() => {
    const tracks = loadTracks()
    const marks = loadEndMarks()
    const ends = classifyTrackEnds(tracks, loadSwitches(), marks)
    const candidates = edit ? ends.filter(e => e.state === BUFFER_STOP) : freeEnds(ends)
    return { tracks, candidates, marks }
    // `version` re-reads the store after a commit in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, edit, version])

  const [hover, setHover]       = useState(null)
  const [picked, setPicked]     = useState(null)
  const [type, setType]         = useState(DEFAULT_BUFFER_STOP_TYPE)
  const [brake, setBrake]       = useState(String(defaultBrakeLength(DEFAULT_BUFFER_STOP_TYPE)))
  const [brakeTyped, setBrakeTyped] = useState(false)

  usePreviewLayers(map, PREVIEW_LAYERS, { resetCursor: true })

  const track = picked ? tracks.find(tr => tr.id === picked.trackId) : null
  const mark  = picked && edit ? marks.find(m => m.id === picked.markId) : null
  const have  = track ? trackLength(track) : 0
  const brakeValue = brake.trim() === '' ? NaN : Number(brake.replace(',', '.'))
  const brakeInvalid = !(Number.isFinite(brakeValue) && brakeValue >= 0)
  const tooShort = !brakeInvalid && track && !bufferStopFits(have, brakeValue)

  // The dots, the one under the cursor or picked drawn larger.
  useEffect(() => {
    const m = map?.current
    const src = m?.getSource(ENDS_SOURCE)
    if (!src) return
    const active = new Set([keyOf(hover), keyOf(picked)].filter(Boolean))
    src.setData({
      type: 'FeatureCollection',
      features: candidates.map(e => ({
        type: 'Feature',
        properties: { active: active.has(keyOf(e)) },
        geometry: { type: 'Point', coordinates: e.lngLat },
      })),
    })
  }, [map, candidates, hover, picked])

  // The stop as it would stand.
  useEffect(() => {
    const m = map?.current
    if (!m?.getSource(SHAPE_SOURCE)) return
    const feats = track && !brakeInvalid
      ? bufferStopFeatures([track], [newBufferStop(track.id, picked.endpoint, type, brakeValue)])
      : []
    m.getSource(SHAPE_SOURCE).setData({ type: 'FeatureCollection', features: feats.filter(f => f.properties.part !== 'brake') })
    m.getSource(BRAKE_SOURCE)?.setData({ type: 'FeatureCollection', features: feats.filter(f => f.properties.part === 'brake') })
  }, [map, track, picked, type, brakeValue, brakeInvalid])

  // Picking: the nearest end within PICK_PX of the cursor.
  const candidatesRef = useRef(candidates)
  useEffect(() => { candidatesRef.current = candidates }, [candidates])
  useEffect(() => {
    const m = map?.current
    if (!m) return
    const nearest = (point) => {
      let best = null, bestD = PICK_PX
      for (const end of candidatesRef.current) {
        const p = m.project(end.lngLat)
        const d = Math.hypot(p.x - point.x, p.y - point.y)
        if (d < bestD) { best = end; bestD = d }
      }
      return best
    }
    const onMove = (e) => {
      const end = nearest(e.point)
      m.getCanvas().style.cursor = end ? 'pointer' : ''
      setHover(prev => (keyOf(prev) === keyOf(end) ? prev : end))
    }
    const onClick = (e) => {
      const end = nearest(e.point)
      if (!end) return
      setPicked(end)
      if (edit) {
        const existing = loadEndMarks().find(mk => mk.id === end.markId)
        if (existing) {
          setType(existing.type ?? DEFAULT_BUFFER_STOP_TYPE)
          setBrake(String(existing.brakeLength ?? 0))
          setBrakeTyped(true)
        }
      }
    }
    m.on('mousemove', onMove)
    m.on('click', onClick)
    return () => {
      m.off('mousemove', onMove)
      m.off('click', onClick)
      if (mapIsLive(map, m)) m.getCanvas().style.cursor = ''
    }
  }, [map, edit, project.id])

  const clearMap = () => {
    const m = map?.current
    for (const id of [ENDS_SOURCE, SHAPE_SOURCE, BRAKE_SOURCE]) m?.getSource(id)?.setData(EMPTY)
  }

  const handleType = (value) => {
    const next = Number(value)
    setType(next)
    // The type proposes the brake length only until somebody has said otherwise.
    if (!brakeTyped) setBrake(String(defaultBrakeLength(next)))
  }

  const finish = () => {
    setPicked(null)
    setHover(null)
    setVersion(v => v + 1)
    onTrackSaved?.()
    onCommitted?.()
  }

  const handleCommit = () => {
    if (!track || brakeInvalid || tooShort) return
    const record = mark
      ? { ...mark, type, brakeLength: brakeValue }
      : newBufferStop(track.id, picked.endpoint, type, brakeValue)
    saveEndMark(record)
    clearMap()
    finish()
  }

  const handleDelete = () => {
    if (!mark) return
    deleteEndMark(mark.id)
    clearMap()
    finish()
  }

  const fill = (key, values) =>
    Object.entries(values).reduce((msg, [k, v]) => msg.replace(`{${k}}`, v), t(key))
  const endName = (end) => fill('buffer_stop_at', {
    track: tracks.find(tr => tr.id === end.trackId)?.name || end.trackId.slice(0, 8),
    end: t(end.endpoint === 'BEGIN' ? 'end_begin' : 'end_end'),
  })

  if (!candidates.length) {
    return (
      <>
        <p className="selecting-hint">{t(edit ? 'buffer_stop_none_existing' : 'buffer_stop_none')}</p>
        <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onCommitted}>
          {t('btn_cancel')}
        </button>
      </>
    )
  }

  return (
    <>
      {!picked && <p className="selecting-hint">{t(edit ? 'buffer_stop_pick_existing' : 'buffer_stop_pick')}</p>}

      {picked && (
        <div className="element-form">
          <p style={{ margin: 0 }}><strong>{endName(picked)}</strong></p>
          <div className="form-field">
            <label>{t('buffer_stop_type')}</label>
            <select value={type} onChange={e => handleType(e.target.value)}>
              {BUFFER_STOP_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label>{t('buffer_stop_brake')}</label>
            <input type="number" min="0" step="0.1" value={brake}
              onChange={e => { setBrake(e.target.value); setBrakeTyped(true) }} />
          </div>
          <p className="selecting-hint">{t('buffer_stop_hint')}</p>
        </div>
      )}

      {picked && brakeInvalid && <p className="form-error">{t('buffer_stop_brake_invalid')}</p>}
      {picked && tooShort && (
        <p className="form-error">{fill('buffer_stop_too_short', {
          need: (brakeValue + BUFFER_STOP_LENGTH).toFixed(2), have: have.toFixed(2),
        })}</p>
      )}

      {picked && (
        <button className="panel-btn panel-btn-full" disabled={brakeInvalid || tooShort}
          style={{ opacity: brakeInvalid || tooShort ? 0.5 : 1 }} onClick={handleCommit}>
          {t('btn_commit')}
        </button>
      )}
      {picked && mark && (
        <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#c0392b' }} onClick={handleDelete}>
          {t('buffer_stop_delete')}
        </button>
      )}
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onCommitted}>
        {t('btn_cancel')}
      </button>
    </>
  )
}
