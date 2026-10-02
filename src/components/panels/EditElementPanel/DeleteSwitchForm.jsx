import { useState } from 'react'
import { commitSwitchDeletion, loadSwitches, loadTracks } from '../../../storage'
import { planSwitchDeletion } from '../../../utils/switchDelete'
import ConfirmModal from '../../ConfirmModal'
import { useI18n } from '../../../locales/i18nContext'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'
import { SWITCH_PICK_LAYERS, hasSwitch } from '../../../map/pick'

/**
 * Delete a turnout (AP 1.2). The switch is picked on the map — its body, or any
 * element of either of its routes — and what the deletion would do is worked
 * out before anything happens (switchDelete.planSwitchDeletion) and shown, so
 * the difference between "the branch goes" and "the switch and both its routes
 * go" is visible from the dialog rather than from the map afterwards.
 */
export default function DeleteSwitchForm({ onCommitted }) {
  const { t, fill } = useI18n()
  const [selected, setSelected]     = useState(null)   // { sw, plan }
  const [confirming, setConfirming] = useState(false)


  useMapPick({
    active: selected === null, layers: SWITCH_PICK_LAYERS, accept: hasSwitch,
    onPick: ({ switchId }) => {
      const sw = loadSwitches().find(s => s.switchId === switchId)
      const plan = sw && planSwitchDeletion(sw, loadTracks())
      if (plan) setSelected({ sw, plan })
    },
  })
  useSelectedOnMap(selected ? { switchId: selected.sw.switchId } : null)

  const handleDelete = () => {
    commitSwitchDeletion(selected.plan)
    setConfirming(false)
    setSelected(null)
  }


  const plan = selected?.plan
  const name = selected ? (selected.sw.name || selected.sw.switchId.slice(0, 8)) : ''

  return (
    <>
      {!selected ? (
        <p>{t('switch_delete_hint')}</p>
      ) : (
        <>
          <p>{fill('switch_delete_selected', { name, label: selected.sw.label ?? '' })}</p>
          <p className="selecting-hint">{t(`switch_delete_reason_${plan.reason}`)}</p>
          <ul className="form-list">
            <li>{fill('switch_delete_elements', { n: plan.removedElements })}</li>
            {plan.removedTracks.length > 0 && (
              <li>{fill('switch_delete_tracks', { names: plan.removedTracks.join(', ') })}</li>
            )}
            {plan.joined && <li>{t('switch_delete_joined')}</li>}
            {plan.mergedElements > 0 && (
              <li>{fill('switch_delete_merged', { n: plan.mergedElements, m: plan.mergedInto })}</li>
            )}
          </ul>
          <button className="panel-btn panel-btn-full panel-btn-danger" onClick={() => setConfirming(true)}>
            {t('switch_delete')}
          </button>
        </>
      )}
      <button className="panel-btn panel-btn-full mt-2 secondary" onClick={onCommitted}>
        {t('btn_cancel')}
      </button>

      {confirming && (
        <ConfirmModal
          message={fill('switch_delete_confirm', { name })}
          onConfirm={handleDelete}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
