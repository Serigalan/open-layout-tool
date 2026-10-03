import { PAPER_FORMATS, SCALES } from '../../../utils/planExport'
import { SCHEMATIC_SCALES } from '../../../utils/planSchematicPlan'
import { DEFAULT_CORRIDOR } from '../../../utils/planSchematic'
import { groupHeading, groupTracks, trackListLabel } from '../../../utils/trackGroups'
import { useI18n } from '../../../locales/i18nContext'
import { useTracks } from '../../../hooks/useStore'

/** One select of the sheet settings. */
function Choice({ label, value, onChange, children }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}>{children}</select>
    </div>
  )
}

/**
 * Which plan, at which scale, on which paper, and how the sheets are laid:
 * turned by the tracks or by hand, along which track, split with an overlap —
 * or, for the overview, how far around the reference track it reaches.
 * `o` holds the settings, `set(key, value)` changes one.
 */
export default function PlanSheetFields({ o, set }) {
  const { t } = useI18n()
  const tracks = useTracks().filter(tr => (tr.elements ?? []).length > 0)
  const schematic = o.kind === 'schematic'
  return (
    <div className="element-form">
      <Choice label={t('plan_kind')} value={o.kind} onChange={v => set('kind', v)}>
        <option value="site">{t('plan_kind_site')}</option>
        <option value="schematic">{t('plan_kind_schematic')}</option>
      </Choice>
      {schematic ? (
        <Choice label={t('plan_scale')} value={o.schematicScaleKey} onChange={v => set('schematicScaleKey', v)}>
          {Object.keys(SCHEMATIC_SCALES).map(k => <option key={k} value={k}>1:{Number(k).toLocaleString('de-DE')}</option>)}
        </Choice>
      ) : (
        <Choice label={t('plan_scale')} value={o.scaleKey} onChange={v => set('scaleKey', v)}>
          {Object.keys(SCALES).map(k => <option key={k} value={k}>1:{k}</option>)}
        </Choice>
      )}
      <Choice label={t('plan_paper')} value={o.paperKey} onChange={v => set('paperKey', v)}>
        {Object.keys(PAPER_FORMATS).map(k => <option key={k} value={k}>{k} mm</option>)}
      </Choice>
      {!schematic && (
        <>
          <Choice label={t('plan_orientation')} value={o.mode} onChange={v => set('mode', v)}>
            <option value="auto">{t('plan_orientation_auto')}</option>
            <option value="north">{t('plan_orientation_north')}</option>
            <option value="south">{t('plan_orientation_south')}</option>
            <option value="manual">{t('plan_orientation_manual')}</option>
          </Choice>
          {o.mode === 'manual' && (
            <div className="form-field">
              <label>{t('plan_rotation')}: {o.rotation}°</label>
              <input type="range" min="0" max="359" step="1" value={o.rotation}
                onChange={e => set('rotation', Number(e.target.value))} />
            </div>
          )}
        </>
      )}
      <Choice label={t(schematic ? 'plan_reference_track' : 'plan_lead_track')} value={o.leadTrackId}
        onChange={v => set('leadTrackId', v)}>
        <option value="">{t('plan_lead_auto')}</option>
        {groupTracks(tracks).map(group => (
          <optgroup key={group.key} label={groupHeading(t, group)}>
            {group.tracks.map(tr => <option key={tr.id} value={tr.id}>{trackListLabel(tr)}</option>)}
          </optgroup>
        ))}
      </Choice>
      {schematic ? (
        <div className="form-field">
          <label>{t('plan_corridor')}</label>
          <input type="number" min="20" step="50" value={o.corridor}
            onChange={e => set('corridor', Math.max(20, Number(e.target.value) || DEFAULT_CORRIDOR))} />
        </div>
      ) : (
        <>
          <label className="transition-curve-row">
            <input type="checkbox" checked={o.split} onChange={e => set('split', e.target.checked)} />
            <span>{t('plan_split')}</span>
          </label>
          {o.split && (
            <div className="form-field">
              <label>{t('plan_overlap')}</label>
              <input type="number" min="0" step="10" value={o.overlap}
                onChange={e => set('overlap', Math.max(0, Number(e.target.value) || 0))} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
