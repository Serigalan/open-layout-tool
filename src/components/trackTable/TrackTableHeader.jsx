import { catalogSpeedRange } from '../../utils/regelkatalog'
import { cantDefLimit, MAX_SWITCH_CANT_DEF } from '../../utils/rules/cant'
import { SPEED_STEP } from '../../utils/rules/speed'
import { useI18n } from '../../locales/i18nContext'
import { lengthText } from './rowText'
import CloseButton from '../form/CloseButton'

/**
 * The bar above the table: the track and its length, the line speed and the
 * button that fills the speed column up to it, what the edits reached (or why
 * the last one was refused), Save and close.
 */
export function TrackTableBar({ title, length, cap, onCap, onMaxSpeeds, reachError, notice, reached, dirty, changed, onSave, onClose }) {
  const { t, fill } = useI18n()
  return (
    <div className="track-table-header">
      <span className="track-table-title">
        {title}
        <span className="track-table-subtitle">{lengthText(length)} m</span>
      </span>
      <div className="row-wide">
        <label className="track-table-cap" title={t('table_speed_cap_hint')}>
          {t('table_speed_cap')}
          <input className="track-table-input track-table-cap-input" type="number" min="0" step={SPEED_STEP}
            placeholder="–" value={cap} onChange={e => onCap(e.target.value)} />
        </label>
        <button className="track-table-vmax-btn" onClick={onMaxSpeeds} title={t('table_set_max_speeds_hint')}>
          {t('table_set_max_speeds')}
        </button>
        {reachError && <span className="track-table-reach-error">{t(reachError)}</span>}
        {!reachError && notice && <span className="track-table-reach">{t(notice)}</span>}
        {!reachError && !notice && reached.trackIds.length > 1 && (
          <span className="track-table-reach">
            {fill('table_edit_reach', { tracks: String(reached.trackIds.length), switches: String(reached.switchIds.length) })}
          </span>
        )}
        {/* Nothing here is written until this is pressed, so it says whether
            anything is waiting — and on how many tracks, since an edit reaches
            past the one on screen. */}
        <button className={`track-table-save-btn${dirty ? ' track-table-save-btn-dirty' : ''}`}
          onClick={onSave} disabled={!dirty}
          title={dirty ? fill('table_unsaved', { tracks: String(changed) }) : undefined}>
          {dirty ? `${t('btn_save')} •` : t('btn_save')}
        </button>
        <CloseButton onClick={onClose} />
      </div>
    </div>
  )
}

/** The column heads. */
export function TrackTableHead() {
  const { t, fill } = useI18n()
  return (
    <thead>
      <tr>
        <th>#</th>
        <th title={t('table_rules_hint')}>{t('table_rules')}</th>
        <th title={t('table_station_hint')}>{t('table_station')} (m)</th>
        <th>{t('table_type')}</th>
        <th>{t('table_bearing')} (°)</th>
        <th>{t('table_end_bearing')} (°)</th>
        <th>{t('table_length')} (m)</th>
        <th>{t('table_radius')} (m)</th>
        <th>{t('table_speed')} (km/h)</th>
        <th>{t('table_cant')} (mm)</th>
        <th>{t('table_cant_exception')}</th>
        <th>{t('table_cant_def')} (mm)</th>
        {/* One limit per speed, so the column's tooltip names the step rather
            than a single number (LP.KB.02). */}
        <th title={fill('table_max_speed_hint', { mm: String(cantDefLimit(catalogSpeedRange.min)), fast: String(cantDefLimit(catalogSpeedRange.max)), sw: String(MAX_SWITCH_CANT_DEF) })}>
          {t('table_max_speed')} (km/h)
        </th>
        <th title={t('table_crs_hint')}>{t('table_crs')}</th>
      </tr>
    </thead>
  )
}
