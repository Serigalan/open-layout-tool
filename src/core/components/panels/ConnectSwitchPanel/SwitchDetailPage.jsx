import { useState } from 'react'
import { SWITCH_PICK_TYPES } from '../../../utils/switch'
import { RAILS, DEFAULT_RAIL } from '../../../utils/crossSection'
import { useI18n } from '../../../locales/i18nContext'
import { useSwitches } from '../../../hooks/useStore'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'
import { SWITCH_PICK_LAYERS, hasSwitch } from '../../../map/pick'

const isTurnout = (sw) => (sw?.kind ?? 'turnout') === 'turnout'

/**
 * Which turnout the detail shows (Paket WD, decision 341): one clicked on the
 * map, or a form of the catalogue on a rail profile — the profile picks the
 * variant, and with it the sleepers before WA and behind the ldS. What is
 * picked opens the detail over the map (`onShow(target)`), where it is drawn.
 */
export default function SwitchDetailPage({ target, onShow }) {
  const { t } = useI18n()
  const switches = useSwitches()
  const [note, setNote] = useState(null)

  useMapPick({
    layers: SWITCH_PICK_LAYERS, accept: hasSwitch,
    onPick: ({ switchId }) => {
      const sw = switches.find(s => s.switchId === switchId)
      if (!isTurnout(sw)) { setNote(t('switch_detail_turnouts_only')); return }
      setNote(null)
      onShow({ switchId })
    },
  })
  useSelectedOnMap(target?.switchId ? { switchId: target.switchId } : null)

  const picked = target?.switchId ? switches.find(s => s.switchId === target.switchId) : null
  const formLabel = target?.formLabel ?? ''
  const rail = target?.rail ?? DEFAULT_RAIL
  const optionen = (klasse) => SWITCH_PICK_TYPES
    .filter(form => form.klasse === klasse)
    .map(form => <option key={form.label} value={form.label}>{form.label}</option>)

  return (
    <>
      <p className="selecting-hint">{t('switch_detail_pick')}</p>
      {note && <p className="msg-warn">{note}</p>}
      {picked && (
        <p className="msg-hint">
          <strong>{[picked.name, picked.label].filter(Boolean).join(' · ')}</strong>
        </p>
      )}
      <div className="form-field">
        <label>{t('switch_detail_form')}</label>
        <select value={formLabel} onChange={e => onShow(e.target.value ? { formLabel: e.target.value, rail } : null)}>
          <option value="">{t('switch_detail_form_none')}</option>
          <optgroup label={t('switch_form_regel')}>{optionen('regel')}</optgroup>
          <optgroup label={t('switch_form_sonder')}>{optionen('sonderbauform')}</optgroup>
        </select>
      </div>
      {formLabel && (
        <div className="form-field">
          <label>{t('switch_detail_rail')}</label>
          <select value={rail} onChange={e => onShow({ formLabel, rail: e.target.value })}>
            {Object.entries(RAILS).map(([key, r]) => <option key={key} value={key}>{r.label}</option>)}
          </select>
        </div>
      )}
    </>
  )
}
