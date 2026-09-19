import { useEffect, useState } from 'react'
import { loadTracks, updateTrack, updateProject } from '../../storage'
import { trackLength } from '../../utils/heightUtils'
import { wgs84ToUTM } from '../../utils/coordinateUtils'
import { stationFromClick } from '../../utils/platformUtils'
import { HIT_TOLERANCE } from '../../utils/mapConstants'
import {
  RAILS, SLEEPERS, DEFAULT_RAIL, DEFAULT_SLEEPER,
} from '../../utils/crossSectionUtils'
import { GAUGE_PROFILES, DEFAULT_GAUGE_PROFILE } from '../../utils/gaugeProfiles'
import useTrackHover from '../../hooks/useTrackHover'

/**
 * The cross section of a track, at a station of it: the clearance profile the
 * project is designed against, the superstructure of the track, and the
 * drawing of both in the overlay — where a slider walks the station along the
 * track, and the cant is read as it holds right there (interpolated inside a
 * transition, constant elsewhere).
 *
 * The superstructure belongs to the track as stretches along it (Entscheidung
 * 18): every track is 54 E 4 on B70 from begin to end, and only an adjustment
 * is written down.
 */
export default function CrossSectionPanel({ t, map, project, onTrackSaved, onShowCrossSection, crossSectionAt }) {
  const [trackId, setTrackId] = useState(null)

  const tracks = loadTracks(project.id)
  const track  = tracks.find(tr => tr.id === trackId) ?? null
  const shown  = crossSectionAt != null && crossSectionAt.trackId === trackId

  useTrackHover(map, trackId ? 'editing' : 'select', 'select', project, true)

  // ── Pick the track — and with the click, the station ──────────────────────
  useEffect(() => {
    if (!map?.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'pointer'

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const feature = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })[0]
      if (!feature) return
      const { trackId: clickedId, elementIndex } = feature.properties
      const clicked = loadTracks(project.id).find(tr => tr.id === clickedId)
      if (!clicked) return
      const clickUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], clicked.epsg)
      const station   = stationFromClick(clicked, Number(elementIndex), clickUtm)
      setTrackId(clicked.id)
      onShowCrossSection?.({ trackId: clicked.id, station: station ?? 0 })
    }

    m.on('click', onClick)
    return () => { m.off('click', onClick); m.getCanvas().style.cursor = '' }
  }, [map, project.id, onShowCrossSection])

  // ── The superstructure stretches of the track ─────────────────────────────
  const writeRanges = (field, ranges) => {
    if (!track) return
    updateTrack(project.id, { ...track, [field]: ranges.length ? ranges : undefined })
    onTrackSaved?.()
  }

  const addRange = (field, type) => {
    const ranges = track?.[field] ?? []
    writeRanges(field, [...ranges, { type, from: 0, to: Math.round(trackLength(track) * 1000) / 1000 }])
  }

  const patchRange = (field, index, patch) => {
    writeRanges(field, (track?.[field] ?? []).map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const dropRange = (field, index) => {
    writeRanges(field, (track?.[field] ?? []).filter((_, i) => i !== index))
  }

  const clear = () => setTrackId(null)

  /** The stretches of one kind, as rows that can be edited and removed. */
  const rangeEditor = (field, table, defaultType) => {
    const ranges = track?.[field] ?? []
    const total  = Math.round(trackLength(track) * 1000) / 1000
    return (
      <>
        <div className="form-field">
          <label>{t(field === 'rails' ? 'cross_section_rail_default' : 'cross_section_sleeper_default')}</label>
          <input type="text" readOnly value={`${table[defaultType].label} · 0 – ${total} m`} />
        </div>
        {ranges.map((r, i) => (
          <div className="form-field" key={`${field}${i}`}>
            <label>{t('cross_section_range')}</label>
            <div className="range-row">
              <select value={r.type} onChange={e => patchRange(field, i, { type: e.target.value })}>
                {Object.entries(table).map(([key, v]) => (
                  <option key={key} value={key}>{v.label}</option>
                ))}
              </select>
              <input type="number" step="0.001" min="0" max={total} value={r.from ?? 0}
                onChange={e => patchRange(field, i, { from: Number(e.target.value) })} />
              <input type="number" step="0.001" min="0" max={total} value={r.to ?? total}
                onChange={e => patchRange(field, i, { to: Number(e.target.value) })} />
              <button type="button" className="field-override" onClick={() => dropRange(field, i)}>✕</button>
            </div>
            {table[r.type]?.use && (
              <span className="range-use">{t(`cross_section_use_${table[r.type].use}`)}</span>
            )}
          </div>
        ))}
        <button className="panel-btn panel-btn-full" style={{ marginTop: 2 }}
          onClick={() => addRange(field, defaultType)}>
          {t('cross_section_add_range')}
        </button>
      </>
    )
  }

  return (
    <>
      <h2>{t('cross_section_title')}</h2>
      {!track && <p>{t('cross_section_hint')}</p>}

      {tracks.length > 0 && (
        <div className="create-element-options">
          {tracks.map((tr) => (
            <button
              key={tr.id}
              className={`create-element-btn${trackId === tr.id ? ' active' : ''}`}
              onClick={() => setTrackId(tr.id)}
            >
              {tr.name || tr.id.slice(0, 8)}
            </button>
          ))}
        </div>
      )}

      <div className="element-form">
        <span className="create-element-section">{t('cross_section_profile_section')}</span>
        <div className="form-field">
          <label>{t('cross_section_profile')}</label>
          <select value={project.gaugeProfile ?? DEFAULT_GAUGE_PROFILE}
            onChange={(e) => { updateProject(project.id, { gaugeProfile: e.target.value }); onTrackSaved?.() }}>
            {Object.entries(GAUGE_PROFILES).map(([key, p]) => (
              <option key={key} value={key}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      {track && (
        <>
          <div className="element-form">
            <span className="create-element-section">{t('cross_section_rails')}</span>
            {rangeEditor('rails', RAILS, DEFAULT_RAIL)}
          </div>

          <div className="element-form">
            <span className="create-element-section">{t('cross_section_sleepers')}</span>
            {rangeEditor('sleepers', SLEEPERS, DEFAULT_SLEEPER)}
          </div>

          {!shown && (
            <button className="panel-btn panel-btn-full" style={{ marginTop: 8 }}
              onClick={() => onShowCrossSection?.({ trackId, station: crossSectionAt?.station ?? 0 })}>
              {t('cross_section_show')}
            </button>
          )}
          <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={clear}>
            {t('btn_cancel')}
          </button>
        </>
      )}
    </>
  )
}
