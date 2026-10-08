import { useState } from 'react'
import { loadSwitches, loadTracks, updateSwitch } from '../../../storage'
import { switchStatus } from '../../../utils/planStatus'
import StatusField from '../StatusField'
import { SWITCH_PICK_LAYERS, hasSwitch } from '../../../map/pick'
import { useI18n } from '../../../locales/i18nContext'
import CommitBar from '../../form/CommitBar'
import CancelButton from '../../form/CancelButton'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'

/**
 * The planning status of a switch, picked on the map like a switch to delete.
 * Left open, the status follows the switch's tracks (planStatus.switchStatus),
 * which is what it is for most switches — only one renewed in a standing
 * track, or kept where its branch goes, needs a status of its own.
 */
export default function SwitchStatusForm({ onCommitted }) {
  const { t, fill } = useI18n()
  const [selected, setSelected] = useState(null)   // switch record
  const [status, setStatus] = useState(null)


  useMapPick({
    active: selected === null, layers: SWITCH_PICK_LAYERS, accept: hasSwitch,
    onPick: ({ switchId }) => {
      const sw = loadSwitches().find(s => s.switchId === switchId)
      if (!sw) return
      setSelected(sw)
      setStatus(sw.status ?? null)
    },
  })
  useSelectedOnMap(selected ? { switchId: selected.switchId } : null)

  const derived = selected
    ? switchStatus({ ...selected, status: null }, new Map(loadTracks().map(tr => [tr.id, tr])))
    : null

  const handleCommit = () => {
    updateSwitch(selected.switchId, { status: status ?? undefined })
    onCommitted?.()
  }

  return (
    <>
      {!selected ? (
        <p>{t('switch_status_hint')}</p>
      ) : (
        <div className="element-form">
          <p>{fill('switch_status_selected', { name: selected.name || selected.switchId.slice(0, 8) })}</p>
          <StatusField value={status} onChange={setStatus} auto={derived} />
        </div>
      )}
      {selected
        ? <CommitBar onCommit={handleCommit} onCancel={onCommitted} />
        : <CancelButton onClick={onCommitted} />}
    </>
  )
}
