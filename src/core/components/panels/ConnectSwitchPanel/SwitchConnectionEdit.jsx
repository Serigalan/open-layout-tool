import { useState } from 'react'
import { loadSwitches, loadTracks } from '../../../storage'
import { editStart, switchConnectionOf, takeApart } from '../../../utils/commands'
import { trackLabel } from '../../../utils/track'
import { useI18n } from '../../../locales/i18nContext'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'
import CancelButton from '../../form/CancelButton'
import SCurveForm from './SCurveForm'

/**
 * Editing a switch connection (Entscheidung 364): a click on the connecting
 * track — a track between two turnouts' routes with one to three elements of
 * its own — takes it apart in memory and opens the switch connection dialog
 * on it, the turnouts free to move along their tracks, their form and the
 * speed fixed. What cannot be edited says why; what the construction does not
 * lay as it lies opens all the same, with the reason (editStart `closes`).
 */
export default function SwitchConnectionEdit({ onCommitted }) {
  const { t, fill } = useI18n()
  const [edit, setEdit] = useState(null)       // { found, apart, start }
  const [status, setStatus] = useState(null)   // a locale key: why the track picked cannot be edited

  useMapPick({
    active: !edit, hover: 'element',
    onPick: ({ trackId }) => {
      const tracks = loadTracks(), switches = loadSwitches()
      const found = switchConnectionOf({ trackId, tracks, switches })
      if (found.error) { setStatus(found.error); return }
      const apart = takeApart(found, { tracks, switches })
      if (apart.error) { setStatus(apart.error); return }
      const start = editStart(found, apart)
      setStatus(null)
      setEdit({ found, apart, start })
    },
  })
  useSelectedOnMap(edit ? { trackId: edit.found.conn.id } : null)

  if (edit) {
    const [first, second] = edit.found.turnouts.map(tu => tu.sw.name ?? '')
    return (
      <>
        <p className="msg-info">
          {fill('crossover_edit_selected', { name: trackLabel(edit.found.conn), w1: first, w2: second })}
        </p>
        {/* As it lies, the construction does not lay it: the reason shows below. */}
        {!edit.start.closes && <p className="msg-hint">{t('crossover_edit_not_closing')}</p>}
        <SCurveForm key={edit.found.conn.id} edit={edit} onCommitted={(laid) => {
          // Cancelled (nothing laid): back to picking another one.
          if (laid) onCommitted?.(laid)
          else setEdit(null)
        }} />
      </>
    )
  }
  return (
    <>
      <p>{t('crossover_edit_hint')}</p>
      {status && <p className="msg-error">{t(status)}</p>}
      <CancelButton className="panel-btn panel-btn-full mt-8 secondary" onClick={() => onCommitted?.()} />
    </>
  )
}
