import { useEffect, useState } from 'react'
import { loadTracks, updateTrack, updateProject } from '../../storage'
import { trackLength } from '../../utils/heightUtils'
import { FILTER_NONE, HIT_TOLERANCE, filterForElement, mapIsLive } from '../../utils/mapConstants'
import {
  RAILS, SLEEPERS, DEFAULT_RAIL, DEFAULT_SLEEPER,
  superstructureAt, sectionStates, elementStartStation,
} from '../../utils/crossSectionUtils'
import { GAUGE_PROFILES, DEFAULT_GAUGE_PROFILE } from '../../utils/gaugeProfiles'
import useTrackHover from '../../hooks/useTrackHover'

/**
 * Cross section of one element: the clearance profile the project is designed
 * against, the superstructure of the track it sits on, and the drawing of both
 * in the overlay.
 *
 * The section is taken at an element, and that is the whole point — the cant
 * turns it and the curvature decides what a clearance check even means, and
 * both belong to the element. The superstructure belongs to the track instead,
 * as stretches along it (Entscheidung 18): every track is 54 E 4 on B70 from
 * begin to end, and only an adjustment is written down.
 */
export default function CrossSectionPanel({ t, map, project, onTrackSaved, onShowCrossSection, crossSectionAt }) {
  const [picked, setPicked] = useState(null)   // { trackId, elIdx }

  const tracks = loadTracks(project.id)
  const track  = picked ? tracks.find(tr => tr.id === picked.trackId) : null
  const el     = track?.elements?.[picked?.elIdx]
  const shown  = crossSectionAt && picked
    && crossSectionAt.trackId === picked.trackId && crossSectionAt.elIdx === picked.elIdx

  useTrackHover(map, picked ? 'editing' : 'select', 'select', project, true)

  useEffect(() => {
    const m = map?.current
    return () => {
      if (!mapIsLive(map, m)) return
      m.setFilter('tracks-selected-layer', FILTER_NONE)
      m.getCanvas().style.cursor = ''
    }
  }, [map])

  // ── Pick the element the section is taken at ──────────────────────────────
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
      const { trackId, elementIndex } = feature.properties
      const elIdx = Number(elementIndex)
      if (!loadTracks(project.id).some(tr => tr.id === trackId)) return
      m.setFilter('tracks-selected-layer', filterForElement(trackId, elIdx))
      setPicked({ trackId, elIdx })
      onShowCrossSection?.({ trackId, elIdx })
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

  const clear = () => {
    map?.current?.setFilter('tracks-selected-layer', FILTER_NONE)
    setPicked(null)
    onShowCrossSection?.(null)
  }

  const elementLabel = (element, index) => {
    if (element?.elementType === 2) {
      return `${index + 1} · ${t(element.transitionType === 'bloss' ? 'table_type_bloss' : 'table_type_transition')}`
    }
    if (element?.radius != null) return `${index + 1} · R ${Math.round(Math.abs(element.radius))} m`
    return `${index + 1} · ${t('table_type_straight')}`
  }

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

  const states = el ? sectionStates(el, elementStartStation(track, picked.elIdx)) : []

  return (
    <>
      <h2>{t('cross_section_title')}</h2>
      {!picked && <p>{t('cross_section_hint')}</p>}

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

      {picked && el && (
        <>
          <div className="element-form">
            <span className="create-element-section">{t('cross_section_alignment')}</span>
            <div className="form-field">
              <label>{t('platform_track')}</label>
              <input type="text" readOnly value={track.name || track.id.slice(0, 8)} />
            </div>
            <div className="form-field">
              <label>{t('cross_section_element')}</label>
              <input type="text" readOnly value={elementLabel(el, picked.elIdx)} />
            </div>
            {states.map((s) => {
              const built = superstructureAt(track, s.station)
              return (
                <div className="form-field" key={s.id}>
                  <label>
                    {`${t('cant')} · ${s.station.toFixed(1)} m`}
                    {s.id !== 'const' ? ` · ${t(s.id === 'start' ? 'cross_section_at_start' : 'cross_section_at_end')}` : ''}
                  </label>
                  <input type="text" readOnly
                    value={`${s.cant} mm · ${s.radius != null ? `R ${Math.round(Math.abs(s.radius))} m` : t('table_type_straight')}`
                      + ` · ${RAILS[built.rail].label} · ${SLEEPERS[built.sleeper].label}`} />
                </div>
              )
            })}
          </div>

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
              onClick={() => onShowCrossSection?.(picked)}>
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
