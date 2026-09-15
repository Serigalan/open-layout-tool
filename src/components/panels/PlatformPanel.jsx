import { useEffect, useMemo, useState } from 'react'
import {
  loadTracks, loadPlatforms, savePlatform, updatePlatform, deletePlatform, generateId,
} from '../../storage'
import { wgs84ToUTM } from '../../utils/coordinateUtils'
import { trackLength } from '../../utils/heightUtils'
import { FILTER_NONE, HIT_TOLERANCE, filterForTrack } from '../../utils/mapConstants'
import { PLATFORM_FILL_COLOR, PLATFORM_FILL_OPACITY } from '../../utils/mapRenderUtils'
import {
  PLATFORM_FRONT_OFFSET, PLATFORM_BACK_OFFSET, PLATFORM_CODE_MAX,
  platformRing, pointAtStation, stationFromClick, platformLength,
} from '../../utils/platformUtils'
import useTrackHover from '../../hooks/useTrackHover'
import usePreviewLayers from '../../hooks/usePreviewLayers'
import UtmCoordFields from '../UtmCoordFields'
import StationNameInput from './StationNameInput'

const PREVIEW_FILL_SOURCE = 'platform-preview-fill-source'
const PREVIEW_LINE_SOURCE = 'platform-preview-line-source'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

// The preview wears the same grey as a committed platform, with a dashed
// outline on top to say it is not one yet.
const PREVIEW_LAYERS = [
  {
    sourceId: PREVIEW_FILL_SOURCE,
    layer: {
      id: 'platform-preview-fill-layer', type: 'fill',
      paint: { 'fill-color': PLATFORM_FILL_COLOR, 'fill-opacity': PLATFORM_FILL_OPACITY },
    },
  },
  {
    sourceId: PREVIEW_LINE_SOURCE,
    layer: {
      id: 'platform-preview-line-layer', type: 'line',
      paint: { 'line-color': '#ff8c00', 'line-width': 2, 'line-dasharray': [4, 3] },
    },
  },
]

/** Shortest platform that is worth drawing [m]. */
const MIN_LENGTH = 1

const ringFC = (ring, type) => ring
  ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
    geometry: type === 'fill' ? { type: 'Polygon', coordinates: [ring] } : { type: 'LineString', coordinates: ring } }] }
  : EMPTY_FC

const fmt = (v) => String(Math.round(v * 1000) / 1000)

/**
 * Create platforms along a track: pick the track, then the two points that
 * bound the platform on it. Both are stations along the track, so the platform
 * follows whatever the track does between them — the edges are offsets of its
 * centreline, the front edge (Bahnsteigkante) 1.67 m from the axis and the back
 * edge 4.67 m, on the side the form selects.
 *
 * An existing platform can be picked from the list to be edited or deleted; the
 * record keeps only its plane data (track, stations, side), and the polygon on
 * the map is derived from it.
 */
export default function PlatformPanel({ t, map, project, onTrackSaved }) {
  const [phase, setPhase]     = useState('select')   // 'select' | 'edit'
  const [editingId, setEditingId] = useState(null)   // set when an existing platform is being edited
  const [trackId, setTrackId] = useState(null)
  const [start, setStart]     = useState('')
  const [end, setEnd]         = useState('')
  const [picking, setPicking] = useState(null)       // 'start' | 'end' | null
  const [side, setSide]       = useState('right')
  const [stationName, setStationName] = useState('')
  const [code, setCode]       = useState('')

  useTrackHover(map, phase, 'select', project, true)

  usePreviewLayers(map, PREVIEW_LAYERS, {
    resetFilters: ['tracks-hover-layer', 'tracks-selected-layer'],
    resetCursor: true,
  })

  const tracks    = loadTracks(project.id)
  const platforms = loadPlatforms(project.id)
  const track     = trackId ? tracks.find(tr => tr.id === trackId) : null
  const total     = track ? trackLength(track) : 0

  // ── Pick the host track ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'select' || !map?.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'pointer'

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })
        .filter(f => !f.properties.switchBranch)
      if (!features.length) return
      const id = features[0].properties.trackId
      if (!loadTracks(project.id).some(tr => tr.id === id)) return
      m.setFilter('tracks-selected-layer', filterForTrack(id))
      setTrackId(id)
      setPhase('edit')
      setPicking('start')
    }

    m.on('click', onClick)
    return () => { m.off('click', onClick); m.getCanvas().style.cursor = '' }
  }, [phase, map, project.id])

  // ── Pick the two points on that track ─────────────────────────────────────
  useEffect(() => {
    if (phase !== 'edit' || !picking || !map?.current || !track) return
    const m = map.current
    m.getCanvas().style.cursor = 'crosshair'

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      // Only the selected track carries the stations the platform is built on.
      const feature = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })
        .find(f => f.properties.trackId === track.id)
      if (!feature) return
      const clickUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], track.epsg)
      const station  = stationFromClick(track, Number(feature.properties.elementIndex), clickUtm)
      if (station == null) return
      if (picking === 'start') { setStart(fmt(station)); setPicking('end') }
      else                     { setEnd(fmt(station));   setPicking(null) }
    }

    m.on('click', onClick)
    return () => { m.off('click', onClick); m.getCanvas().style.cursor = '' }
  }, [phase, picking, map, track])

  // ── Derived platform and its preview ──────────────────────────────────────
  const s1 = Number(start)
  const s2 = Number(end)
  const inRange = [s1, s2].every(s => Number.isFinite(s) && s >= 0 && s <= total + 1e-6)
  const valid   = !!track && inRange && Math.abs(s2 - s1) >= MIN_LENGTH

  const draft = useMemo(() => ({
    trackId,
    startStation: Math.min(s1, s2),
    endStation:   Math.max(s1, s2),
    side,
    frontOffset:  PLATFORM_FRONT_OFFSET,
    backOffset:   PLATFORM_BACK_OFFSET,
    stationName,
    code,
  }), [trackId, s1, s2, side, stationName, code])

  const ring = valid ? platformRing(draft, track) : null

  useEffect(() => {
    const m = map?.current
    if (!m) return
    m.getSource(PREVIEW_FILL_SOURCE)?.setData(ringFC(ring, 'fill'))
    m.getSource(PREVIEW_LINE_SOURCE)?.setData(ringFC(ring, 'line'))
  }, [ring, map])

  const clearPreview = () => {
    const m = map?.current
    if (!m) return
    m.getSource(PREVIEW_FILL_SOURCE)?.setData(EMPTY_FC)
    m.getSource(PREVIEW_LINE_SOURCE)?.setData(EMPTY_FC)
    m.setFilter('tracks-selected-layer', FILTER_NONE)
  }

  const reset = () => {
    clearPreview()
    setPhase('select'); setEditingId(null); setTrackId(null)
    setStart(''); setEnd(''); setPicking(null)
    setSide('right'); setStationName(''); setCode('')
  }

  const loadForEdit = (platform) => {
    map?.current?.setFilter('tracks-selected-layer', filterForTrack(platform.trackId))
    setEditingId(platform.id)
    setTrackId(platform.trackId)
    setStart(fmt(platform.startStation))
    setEnd(fmt(platform.endStation))
    setSide(platform.side ?? 'right')
    setStationName(platform.stationName ?? '')
    setCode(platform.code ?? '')
    setPicking(null)
    setPhase('edit')
  }

  const handleCommit = () => {
    if (!ring) return
    // The polygon rides along in memory so the map can draw it right away; it is
    // stripped on persist and rebuilt from the stations on load.
    const record = { id: editingId ?? generateId(), ...draft, coords: ring }
    if (editingId) updatePlatform(project.id, record)
    else           savePlatform(project.id, record)
    onTrackSaved?.()
    reset()
  }

  const handleDelete = () => {
    if (!editingId) return
    deletePlatform(project.id, editingId)
    onTrackSaved?.()
    reset()
  }

  const startPoint = valid ? pointAtStation(track, draft.startStation) : null
  const endPoint   = valid ? pointAtStation(track, draft.endStation)   : null
  const trackLabel = (tr) => tr?.name || tr?.id?.slice(0, 8) || '–'

  if (phase === 'select') {
    return (
      <>
        <h2>{t('platform_title')}</h2>
        <p>{t('platform_hint_track')}</p>
        {platforms.length > 0 && (
          <div className="create-element-options">
            <span className="create-element-section">{t('platform_existing')}</span>
            {platforms.map((p) => (
              <button key={p.id} className="create-element-btn" onClick={() => loadForEdit(p)}>
                {[p.code, p.stationName].filter(Boolean).join(' · ') || t('platform_unnamed')}
                {` — ${platformLength(p).toFixed(1)} m`}
              </button>
            ))}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <h2>{t('platform_title')}</h2>
      {picking && (
        <p className="selecting-hint">
          {t(picking === 'start' ? 'platform_hint_start' : 'platform_hint_end')}
        </p>
      )}

      <div className="element-form">
        <span className="create-element-section">Geometry Data</span>
        <div className="form-field">
          <label>{t('platform_track')}</label>
          <input type="text" readOnly value={trackLabel(track)} />
        </div>
        <div className="form-field">
          <label>{t('platform_start')}</label>
          <input type="number" step="0.001" min="0" max={total} value={start}
            onChange={e => { setStart(e.target.value); setPicking(null) }} />
        </div>
        <div className="form-field">
          <label>{t('platform_end')}</label>
          <input type="number" step="0.001" min="0" max={total} value={end}
            onChange={e => { setEnd(e.target.value); setPicking(null) }} />
        </div>
        <div className="form-field">
          <label>{t('field_length')}</label>
          <input type="text" readOnly value={valid ? `${platformLength(draft).toFixed(3)} m` : '–'} />
        </div>
        <div className="form-field">
          <label>{t('platform_side')}</label>
          <select value={side} onChange={e => setSide(e.target.value)}>
            <option value="left">{t('switch_side_left')}</option>
            <option value="right">{t('switch_side_right')}</option>
          </select>
        </div>
        <div className="form-field">
          <label>{t('platform_front_edge')}</label>
          <input type="text" readOnly value={`${PLATFORM_FRONT_OFFSET.toFixed(2)} m`} />
        </div>
        <div className="form-field">
          <label>{t('platform_back_edge')}</label>
          <input type="text" readOnly value={`${PLATFORM_BACK_OFFSET.toFixed(2)} m`} />
        </div>
        {startPoint && (
          <UtmCoordFields label={t('platform_point_start')} zone={track.epsg} readOnly
            easting={startPoint.utm.easting.toFixed(2)} northing={startPoint.utm.northing.toFixed(2)} />
        )}
        {endPoint && (
          <UtmCoordFields label={t('platform_point_end')} zone={track.epsg} readOnly
            easting={endPoint.utm.easting.toFixed(2)} northing={endPoint.utm.northing.toFixed(2)} />
        )}
      </div>

      <div className="element-form">
        <span className="create-element-section">Meta Data</span>
        <div className="form-field">
          <label>{t('station_name')}</label>
          <StationNameInput
            value={stationName}
            onChange={(e) => setStationName(e.target.value)}
            onSelectSuggestion={(s) => setStationName(s.name)}
          />
        </div>
        <div className="form-field">
          <label>{t('platform_code')}</label>
          <input type="text" value={code} maxLength={PLATFORM_CODE_MAX}
            onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PLATFORM_CODE_MAX))} />
        </div>
      </div>

      {!valid && <p className="form-error">{t('platform_error_range')}</p>}

      <button className="panel-btn panel-btn-full" style={{ marginTop: 8, opacity: valid ? 1 : 0.5 }}
        onClick={handleCommit} disabled={!valid}>
        {t('btn_commit')}
      </button>
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2 }}
        onClick={() => { setStart(''); setEnd(''); setPicking('start') }}>
        {t('platform_repick')}
      </button>
      {editingId && (
        <button className="panel-btn panel-btn-full panel-btn-danger" style={{ marginTop: 2 }} onClick={handleDelete}>
          {t('platform_delete')}
        </button>
      )}
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={reset}>
        {t('btn_cancel')}
      </button>
    </>
  )
}
