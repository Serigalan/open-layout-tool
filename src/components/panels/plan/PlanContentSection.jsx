import { BACKGROUNDS } from '../../../utils/planAssemble'
import { useI18n } from '../../../locales/i18nContext'
import { useProject } from '../../../hooks/useStore'
import FormSection from '../../form/FormSection'

const CONTENT_KEYS = [
  ['mainPoints', 'plan_show_main'],
  ['kilometrage', 'plan_show_km'],
  ['labels',     'plan_show_labels'],
  ['switches',   'plan_show_switches'],
  ['trackNames', 'plan_show_names'],
]

/** What the overview can show, keyed as buildSchematicPlan reads it. */
const SCHEMATIC_CONTENT_KEYS = [
  ['km',         'plan_show_km'],
  ['switches',   'plan_show_switches'],
  ['trackNames', 'plan_show_names'],
  ['platforms',  'plan_show_platforms'],
]

/** What the plan shows, and over which backdrop. */
export default function PlanContentSection({ o, set }) {
  const { t } = useI18n()
  const noKm = (useProject()?.kmLines ?? []).length === 0
  const schematic = o.kind === 'schematic'
  const [field, keys] = schematic ? ['schematicShow', SCHEMATIC_CONTENT_KEYS] : ['show', CONTENT_KEYS]
  const shown = o[field]
  return (
    <FormSection title={t('plan_content')}>
      {keys.map(([key, labelKey]) => (
        <label className="transition-curve-row" key={key}>
          <input type="checkbox" checked={shown[key]} onChange={e => set(field, { ...shown, [key]: e.target.checked })} />
          <span>{t(labelKey)}</span>
        </label>
      ))}
      {(schematic ? shown.km : shown.kilometrage) && noKm && (
        <p className="form-error">{t(schematic ? 'plan_schematic_km_missing' : 'plan_km_missing')}</p>
      )}
      {!schematic && (
        <div className="form-field">
          <label>{t('plan_background')}</label>
          <select value={o.background} onChange={e => set('background', e.target.value)}>
            {BACKGROUNDS.map(b => <option key={b.key} value={b.key}>{t(b.labelKey)}</option>)}
          </select>
        </div>
      )}
    </FormSection>
  )
}
