import { useState } from 'react'
import { loadTracks, updateTrack, updateProject, currentProject } from '../../storage'
import { trackLength } from '../../utils/heightUtils'
import { wgs84ToUTM } from '../../utils/coordinateUtils'
import { stationFromClick } from '../../utils/platformUtils'
import {
  RAILS, SLEEPERS, DEFAULT_RAIL, DEFAULT_SLEEPER,
} from '../../utils/crossSectionUtils'
import {
  GAUGE_PROFILES, DEFAULT_GAUGE_PROFILE, gaugeProfileLabelKey, LICHTRAUM_SOURCE,
} from '../../utils/gaugeProfiles'
import GroupedTrackList from './GroupedTrackList'
import ClearanceScanSection from './ClearanceScanSection'
import { useI18n } from '../../locales/i18nContext'
import useMapPick from '../../map/useMapPick'
import ReadOnlyField from '../form/ReadOnlyField'
import FormSection from '../form/FormSection'
import CancelButton from '../form/CancelButton'
import NumberInput from '../form/NumberInput'

/**
 * The cross section of a track, at a station of it: the clearance profile the
 * project is designed against, the superstructure of the track, and the
 * drawing of both in the overlay — where a slider walks the station along the
 * track, and the cant is read as it holds right there (interpolated inside a
 * transition, constant elsewhere).
 *
 * The superstructure belongs to the track as stretches along it (Entscheidung
 * 18): every track is 54 E4 on B70 from begin to end, and only an adjustment
 * is written down.
 */
export default function CrossSectionPanel({ onShowCrossSection, crossSectionAt }) {
  const { t } = useI18n()
  const [trackId, setTrackId] = useState(null)

  // The overlay may walk on to the next track at an end; the panel follows it,
  // so the superstructure shown is the one of the track in the section.
  // Adjusted while rendering, the way React has it for state that follows a prop.
  const shownId = crossSectionAt?.trackId ?? null
  const [followed, setFollowed] = useState(shownId)
  if (shownId !== followed) {
    setFollowed(shownId)
    if (shownId) setTrackId(shownId)
  }

  const tracks = loadTracks()
  const track  = tracks.find(tr => tr.id === trackId) ?? null
  const shown  = crossSectionAt != null && crossSectionAt.trackId === trackId

  // ── Pick the track — and with the click, the station ──────────────────────
  useMapPick({
    hover: trackId ? null : 'element',
    onPick: ({ trackId: clickedId, elementIndex }, e) => {
      const clicked = loadTracks().find(tr => tr.id === clickedId)
      if (!clicked) return
      const clickUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], clicked.epsg)
      const station  = stationFromClick(clicked, elementIndex, clickUtm)
      setTrackId(clicked.id)
      onShowCrossSection?.({ trackId: clicked.id, station: station ?? 0 })
    },
  })

  // ── The superstructure stretches of the track ─────────────────────────────
  const writeRanges = (field, ranges) => {
    if (!track) return
    updateTrack({ ...track, [field]: ranges.length ? ranges : undefined })
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
        <ReadOnlyField label={t(field === 'rails' ? 'cross_section_rail_default' : 'cross_section_sleeper_default')} value={`${table[defaultType].label} · 0 – ${total} m`} />
        {ranges.map((r, i) => (
          <div className="form-field" key={`${field}${i}`}>
            <label>{t('cross_section_range')}</label>
            <div className="range-row">
              <select value={r.type} onChange={e => patchRange(field, i, { type: e.target.value })}>
                {Object.entries(table).map(([key, v]) => (
                  <option key={key} value={key}>{v.label}</option>
                ))}
              </select>
              <NumberInput step="0.001" min="0" max={total} value={r.from ?? 0}
                onChange={e => patchRange(field, i, { from: Number(e.target.value) })} />
              <NumberInput step="0.001" min="0" max={total} value={r.to ?? total}
                onChange={e => patchRange(field, i, { to: Number(e.target.value) })} />
              <button type="button" className="field-override" onClick={() => dropRange(field, i)} aria-label={t('btn_remove')} title={t('btn_remove')}>✕</button>
            </div>
            {table[r.type]?.use && (
              <span className="range-use">{t(`cross_section_use_${table[r.type].use}`)}</span>
            )}
          </div>
        ))}
        <button className="panel-btn panel-btn-full mt-2"
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
        <GroupedTrackList tracks={tracks}
          isActive={(tr) => tr.id === trackId}
          onPick={(tr) => {
            setTrackId(tr.id)
            // Picked from the list, the track opens at its begin — or stays
            // where it is shown already.
            if (crossSectionAt?.trackId !== tr.id) onShowCrossSection?.({ trackId: tr.id, station: 0 })
          }} />
      )}

      <FormSection title={t('cross_section_profile_section')}>
        <div className="form-field">
          <label>{t('cross_section_profile')}</label>
          <select value={currentProject()?.gaugeProfile ?? DEFAULT_GAUGE_PROFILE}
            onChange={(e) => { updateProject({ gaugeProfile: e.target.value }) }}>
            {Object.entries(GAUGE_PROFILES).map(([key]) => (
              <option key={key} value={key}>{`${t(gaugeProfileLabelKey(key))} · ${LICHTRAUM_SOURCE}`}</option>
            ))}
          </select>
        </div>
      </FormSection>

      {track && (
        <>
          <FormSection title={t('cross_section_rails')}>
            {rangeEditor('rails', RAILS, DEFAULT_RAIL)}
          </FormSection>

          <FormSection title={t('cross_section_sleepers')}>
            {rangeEditor('sleepers', SLEEPERS, DEFAULT_SLEEPER)}
          </FormSection>

          <ClearanceScanSection track={track} onShowCrossSection={onShowCrossSection} />

          {!shown && (
            <button className="panel-btn panel-btn-full mt-8"
              onClick={() => onShowCrossSection?.({ trackId, station: crossSectionAt?.station ?? 0 })}>
              {t('cross_section_show')}
            </button>
          )}
          <CancelButton className="panel-btn panel-btn-full mt-2 secondary" onClick={clear} />
        </>
      )}
    </>
  )
}
