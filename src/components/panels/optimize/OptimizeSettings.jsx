import { useI18n } from '../../../locales/i18nContext'
import ReadOnlyField from '../../form/ReadOnlyField'
import NumberInput from '../../form/NumberInput'
import { splitUnit } from '../../../locales/i18n'

/**
 * What a run is held to: the corridor the track may move in, a target speed,
 * the level of the rulebook — Regelwert or Ermessensgrenze; the deficiency,
 * the ramps and every other limit follow from it on the server — and which
 * rulebook. `s` holds the settings, `set(key, value)` changes one.
 */
export default function OptimizeSettings({ label, what, s, set, regelwerke, onShowRegelwerk }) {
  const { t } = useI18n()
  const regelwerkId = s.regelwerkId || regelwerke[0]?.id
  return (
    <div className="element-form">
      <ReadOnlyField label={what} value={label} />
      <div className="form-field">
        <label>{t('optimize_corridor')}: {s.corridorCm} cm</label>
        <input type="range" min="0" max="50" step="1" value={s.corridorCm}
          onChange={e => set('corridorCm', Number(e.target.value))} />
      </div>
      <div className="form-field">
        <label>{splitUnit(t('optimize_vmax')).text}</label>
        <NumberInput min="0" step="10" placeholder={t('optimize_vmax_open')}
          value={s.vMax} onChange={e => set('vMax', e.target.value)} unit="km/h" />
      </div>
      <div className="form-field">
        <label>{t('optimize_grenzwert')}</label>
        <select value={s.grenzwert} onChange={e => set('grenzwert', e.target.value)}>
          <option value="reg">{t('optimize_grenzwert_reg')}</option>
          <option value="discretion">{t('optimize_grenzwert_discretion')}</option>
        </select>
        {/* The catalogue says of every warning that it needs a written
            justification — the panel says so before the run, not after. */}
        {s.grenzwert === 'discretion' && (
          <span className="msg-warn msg-small">{t('optimize_grenzwert_discretion_hint')}</span>
        )}
      </div>
      {regelwerke.length > 0 && (
        <div className="form-field">
          <label>{t('optimize_regelwerk')}</label>
          {regelwerke.length > 1 ? (
            <select value={regelwerkId} onChange={e => set('regelwerkId', e.target.value)}>
              {regelwerke.map(rw => <option key={rw.id} value={rw.id}>{rw.name}</option>)}
            </select>
          ) : (
            <input type="text" readOnly value={regelwerke[0].name} />
          )}
          {/* The same popup the edit panel opens, on the regelwerk this run
              would use — one viewer, not a second copy of the table. */}
          <button className="link-btn msg-info msg-small" type="button" onClick={() => onShowRegelwerk?.(regelwerkId)}>
            {t('optimize_regelwerk_show')}
          </button>
        </div>
      )}
    </div>
  )
}
