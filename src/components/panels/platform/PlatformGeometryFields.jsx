import { PLATFORM_FRONT_OFFSET, PLATFORM_HEIGHTS, platformLength, pointAtStation, platformEdgeElevation } from '../../../utils/platformUtils'
import { trackLength } from '../../../utils/heightUtils'
import { trackLabel } from '../../../utils/trackModel'
import { useI18n } from '../../../locales/i18nContext'
import FormSection from '../../form/FormSection'
import ReadOnlyField from '../../form/ReadOnlyField'
import UtmCoordFields from '../../UtmCoordFields'
import NumberInput from '../../form/NumberInput'
import { splitUnit } from '../../../locales/i18n'

/**
 * Where the platform lies on its track: the two stations, the side, its
 * height over top of rail and the distance of its front edge from the axis —
 * and what follows from them: its length, the back edge, the absolute height
 * of the edge where the track carries a gradient, and the two end points.
 * `onStation` is a station typed in (which ends picking it on the map).
 */
export default function PlatformGeometryFields({ f, set, onStation, track, draft, valid }) {
  const { t } = useI18n()
  const total = track ? trackLength(track) : 0
  const startPoint = valid ? pointAtStation(track, draft.startStation) : null
  const endPoint   = valid ? pointAtStation(track, draft.endStation)   : null
  // The edge is only located vertically where the track carries heights.
  const edgeStart  = valid ? platformEdgeElevation(draft, track, draft.startStation) : null
  const edgeEnd    = valid ? platformEdgeElevation(draft, track, draft.endStation)   : null
  const station = (key, label) => (
    <div className="form-field">
      <label>{t(label)}</label>
      <NumberInput step="0.001" min="0" max={total} value={f[key]} onChange={e => onStation(key, e.target.value)} />
    </div>
  )
  const point = (label, p) => p && (
    <UtmCoordFields label={t(label)} zone={track.epsg} readOnly
      easting={p.utm.easting.toFixed(2)} northing={p.utm.northing.toFixed(2)} />
  )
  return (
    <FormSection title={t('section_geometry')}>
      <ReadOnlyField label={t('platform_track')} value={trackLabel(track)} />
      {station('start', 'platform_start')}
      {station('end', 'platform_end')}
      <ReadOnlyField label={t('field_length')} value={valid ? `${platformLength(draft).toFixed(3)} m` : '–'} />
      <div className="form-field">
        <label>{t('platform_side')}</label>
        <select value={f.side} onChange={e => set('side', e.target.value)}>
          <option value="left">{t('switch_side_left')}</option>
          <option value="right">{t('switch_side_right')}</option>
        </select>
      </div>
      <div className="form-field">
        <label>{t('platform_height')}</label>
        <select value={f.freeHeight ? 'free' : String(f.height)}
          onChange={(e) => {
            if (e.target.value === 'free') set('freeHeight', true)
            else { set('freeHeight', false); set('height', Number(e.target.value)) }
          }}>
          {PLATFORM_HEIGHTS.map(h => <option key={h} value={String(h)}>{`${h} mm`}</option>)}
          <option value="free">{t('platform_height_free')}</option>
        </select>
      </div>
      {f.freeHeight && (
        <div className="form-field">
          <label>{t('platform_height_value')}</label>
          <NumberInput step="10" min="0" value={f.height}
            onChange={e => set('height', e.target.value === '' ? '' : Number(e.target.value))} />
        </div>
      )}
      <div className="form-field">
        <label>{splitUnit(t('platform_front_edge')).text}</label>
        <NumberInput step="0.01" min="0" value={f.frontOffset}
          onChange={e => set('frontOffset', e.target.value === '' ? '' : Number(e.target.value))} unit="m" />
        {Number(f.frontOffset) !== PLATFORM_FRONT_OFFSET && (
          <button type="button" className="field-override" onClick={() => set('frontOffset', PLATFORM_FRONT_OFFSET)}>
            {`${t('platform_front_edge_manual')} (${PLATFORM_FRONT_OFFSET.toFixed(2)} m)`}
          </button>
        )}
      </div>
      <ReadOnlyField label={t('platform_back_edge')} value={valid ? `${draft.backOffset.toFixed(2)} m` : '–'} />
      {edgeStart != null && (
        <ReadOnlyField label={t('platform_edge_elevation')} value={`${edgeStart.toFixed(3)} m … ${edgeEnd.toFixed(3)} m`} />
      )}
      {point('platform_point_start', startPoint)}
      {point('platform_point_end', endPoint)}
    </FormSection>
  )
}
