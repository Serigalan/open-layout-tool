import { useEffect, useMemo, useState } from 'react'
import { loadTracks, savePlatform, updatePlatform, deletePlatform } from '../../storage'
import { generateId } from '../../utils/identifierUtils'
import { wgs84ToUTM } from '../../utils/coordinateUtils'
import { PLATFORM_FILL_COLOR, PLATFORM_FILL_OPACITY } from '../../utils/mapRenderUtils'
import { PLATFORM_CODE_MAX, platformRing, stationFromClick, platformLength } from '../../utils/platformUtils'
import { EMPTY_PLATFORM_FORM, pickedStation, platformDraft, platformForm, platformFormValid } from '../../utils/platformForm'
import { useI18n } from '../../locales/i18nContext'
import CommitBar from '../form/CommitBar'
import { usePlatforms, useTracks } from '../../hooks/useStore'
import usePreview from '../../map/usePreview'
import useMapPick, { useSelectedOnMap } from '../../map/useMapPick'
import useMapEvents from '../../map/useMapEvents'
import { PALETTE } from '../../styles/palette'
import FormSection from '../form/FormSection'
import StationNameInput from './StationNameInput'
import PlatformGeometryFields from './platform/PlatformGeometryFields'

const PREVIEW_FILL_SOURCE = 'platform-preview-fill-source'
const PREVIEW_LINE_SOURCE = 'platform-preview-line-source'

// The preview wears the same grey as a committed platform, with a dashed
// outline on top to say it is not one yet.
const PREVIEW_LAYERS = [
  {
    sourceId: PREVIEW_FILL_SOURCE,
    layer: { id: 'platform-preview-fill-layer', type: 'fill', paint: { 'fill-color': PLATFORM_FILL_COLOR, 'fill-opacity': PLATFORM_FILL_OPACITY } },
  },
  {
    sourceId: PREVIEW_LINE_SOURCE,
    layer: { id: 'platform-preview-line-layer', type: 'line', paint: { 'line-color': PALETTE.mapHover, 'line-width': 2, 'line-dasharray': [4, 3] } },
  },
]

const ringFC = (ring, type) => ring
  ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
    geometry: type === 'fill' ? { type: 'Polygon', coordinates: [ring] } : { type: 'LineString', coordinates: ring } }] }
  : null

/**
 * Create platforms along a track: pick the track, then the two points that
 * bound the platform on it. Both are stations along the track, so the platform
 * follows whatever the track does between them — the edges are offsets of its
 * centreline, the front edge (Bahnsteigkante) at the standard distance from the
 * axis and the back edge a platform width behind it, on the side the form
 * selects.
 *
 * The height is stated over top of rail; what the form shows absolutely is read
 * off the track's own gradient at the platform's ends and never stored.
 *
 * An existing platform can be picked from the list to be edited or deleted; the
 * record keeps only its plane data (track, stations, side, height), and the
 * polygon on the map is derived from it (R5.5: the fields in utils/platformForm).
 */
export default function PlatformPanel() {
  const { t } = useI18n()
  const [editing, setEditing] = useState(null)    // null while choosing; { id } (null for a new one) while editing
  const [f, setF] = useState(EMPTY_PLATFORM_FORM)
  const set = (key, value) => setF(prev => ({ ...prev, [key]: value }))
  const [picking, setPicking] = useState(null)    // 'start' | 'end' | null
  const preview = usePreview(PREVIEW_LAYERS)
  const tracks = useTracks()
  const platforms = usePlatforms()
  const track = f.trackId ? tracks.find(tr => tr.id === f.trackId) : null

  // ── Pick the host track ───────────────────────────────────────────────────
  useMapPick({
    active: !editing, noSwitchBranch: true, hover: 'element',
    onPick: ({ trackId }) => {
      if (!loadTracks().some(tr => tr.id === trackId)) return
      setF({ ...EMPTY_PLATFORM_FORM, trackId })
      setEditing({ id: null })
      setPicking('start')
    },
  })
  useSelectedOnMap(f.trackId ? { trackId: f.trackId } : null)

  // ── Pick the two points on that track ─────────────────────────────────────
  // Only the selected track carries the stations the platform is built on.
  const pickingStations = !!editing && !!picking && !!track
  useMapPick({
    active: pickingStations, track: track?.id, cursor: false,
    onPick: ({ elementIndex }, e) => {
      const station = stationFromClick(track, elementIndex, wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], track.epsg))
      if (station == null) return
      set(picking, pickedStation(station))
      setPicking(picking === 'start' ? 'end' : null)
    },
  })
  useMapEvents(pickingStations, {}, { cursor: 'crosshair' })

  // ── Derived platform and its preview ──────────────────────────────────────
  const valid = platformFormValid(f, track)
  const draft = useMemo(() => platformDraft(f), [f])
  const ring = valid ? platformRing(draft, track) : null
  useEffect(() => {
    preview.set(PREVIEW_FILL_SOURCE, ringFC(ring, 'fill'))
    preview.set(PREVIEW_LINE_SOURCE, ringFC(ring, 'line'))
  }, [ring, preview])

  const reset = () => { preview.clear(); setEditing(null); setF(EMPTY_PLATFORM_FORM); setPicking(null) }

  const handleCommit = () => {
    if (!ring) return
    // The polygon rides along in memory so the map can draw it right away; it is
    // stripped on persist and rebuilt from the stations on load.
    const record = { id: editing.id ?? generateId(), ...draft, coords: ring }
    if (editing.id) updatePlatform(record)
    else savePlatform(record)
    reset()
  }

  if (!editing) {
    return (
      <>
        <h2>{t('platform_title')}</h2>
        <p>{t('platform_hint_track')}</p>
        {platforms.length > 0 && (
          <div className="create-element-options">
            <span className="create-element-section">{t('platform_existing')}</span>
            {platforms.map((p) => (
              <button key={p.id} className="create-element-btn"
                onClick={() => { setF(platformForm(p)); setEditing({ id: p.id }); setPicking(null) }}>
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
      {picking && <p className="selecting-hint">{t(picking === 'start' ? 'platform_hint_start' : 'platform_hint_end')}</p>}
      <PlatformGeometryFields f={f} set={set} track={track} draft={draft} valid={valid}
        onStation={(key, value) => { set(key, value); setPicking(null) }} />
      <FormSection title={t('section_meta')}>
        <div className="form-field">
          <label>{t('station_name')}</label>
          <StationNameInput value={f.stationName} onChange={(e) => set('stationName', e.target.value)}
            onSelectSuggestion={(s) => set('stationName', s.name)} />
        </div>
        <div className="form-field">
          <label>{t('platform_code')}</label>
          <input type="text" value={f.code} maxLength={PLATFORM_CODE_MAX}
            onChange={e => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PLATFORM_CODE_MAX))} />
        </div>
      </FormSection>
      {!valid && <p className="form-error">{t('platform_error_range')}</p>}
      <button className="panel-btn panel-btn-full mt-8" onClick={() => { set('start', ''); set('end', ''); setPicking('start') }}>
        {t('platform_repick')}
      </button>
      {editing.id && (
        <button className="panel-btn panel-btn-full panel-btn-danger mt-2" onClick={() => { deletePlatform(editing.id); reset() }}>
          {t('platform_delete')}
        </button>
      )}
      <CommitBar onCommit={handleCommit} onCancel={reset} disabled={!valid} />
    </>
  )
}
