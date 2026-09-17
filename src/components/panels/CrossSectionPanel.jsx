import { useEffect, useState } from 'react'
import { loadTracks, updateTrack, updateProject } from '../../storage'
import { FILTER_NONE, HIT_TOLERANCE, filterForElement, mapIsLive } from '../../utils/mapConstants'
import {
  RAIL_TYPES, SLEEPER_TYPES, resolveSuperstructure, sectionStates,
} from '../../utils/crossSectionUtils'
import { GAUGE_PROFILES, DEFAULT_GAUGE_PROFILE } from '../../utils/gaugeProfiles'
import useTrackHover from '../../hooks/useTrackHover'

/**
 * Cross section of one element: its superstructure, the clearance profile the
 * project is designed against, and the drawing of both in the overlay.
 *
 * It hangs on an element, not on a track, and that is the whole point — the
 * cant turns the section and the curvature decides what a clearance check even
 * means, and both belong to the element. The superstructure is stated on the
 * track and overridden per element where it changes part way along
 * (Entscheidung 9), the same resolution rule the cant already follows.
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

  // ── Superstructure: the track states it, an element may override it ───────
  const setTrackField = (field, value) => {
    if (!track) return
    updateTrack(project.id, { ...track, [field]: value || undefined })
    onTrackSaved?.()
  }

  const setElementField = (field, value) => {
    if (!track || !el) return
    const elements = track.elements.map((e, i) => {
      if (i !== picked.elIdx) return e
      const { [field]: _drop, ...rest } = e
      return value ? { ...rest, [field]: value } : rest
    })
    updateTrack(project.id, { ...track, elements })
    onTrackSaved?.()
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

  const inherited = resolveSuperstructure(track, {})
  const states = el ? sectionStates(el) : []

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
            {states.map((s) => (
              <div className="form-field" key={s.id}>
                <label>
                  {t('cant')}
                  {s.id !== 'const' ? ` · ${t(s.id === 'start' ? 'cross_section_at_start' : 'cross_section_at_end')}` : ''}
                </label>
                <input type="text" readOnly
                  value={`${s.cant} mm${s.radius != null ? ` · R ${Math.round(Math.abs(s.radius))} m` : ` · ${t('table_type_straight')}`}`} />
              </div>
            ))}
          </div>

          <div className="element-form">
            <span className="create-element-section">{t('cross_section_superstructure')}</span>
            <div className="form-field">
              <label>{t('cross_section_rail_track')}</label>
              <select value={track.rail ?? ''} onChange={(e) => setTrackField('rail', e.target.value)}>
                <option value="">–</option>
                {RAIL_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>{t('cross_section_sleeper_track')}</label>
              <select value={track.sleeper ?? ''} onChange={(e) => setTrackField('sleeper', e.target.value)}>
                <option value="">–</option>
                {SLEEPER_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>{t('cross_section_rail_element')}</label>
              <select value={el.rail ?? ''} onChange={(e) => setElementField('rail', e.target.value)}>
                <option value="">{`${t('cross_section_from_track')}${inherited.rail ? ` (${inherited.rail})` : ''}`}</option>
                {RAIL_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>{t('cross_section_sleeper_element')}</label>
              <select value={el.sleeper ?? ''} onChange={(e) => setElementField('sleeper', e.target.value)}>
                <option value="">{`${t('cross_section_from_track')}${inherited.sleeper ? ` (${inherited.sleeper})` : ''}`}</option>
                {SLEEPER_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
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
