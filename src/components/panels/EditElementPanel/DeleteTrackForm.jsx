import { useState } from 'react'
import { deleteTrack, loadTracks, switchesOnTrack } from '../../../storage'
import ConfirmModal from '../../ConfirmModal'
import { useI18n } from '../../../locales/i18nContext'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'
import CancelButton from '../../form/CancelButton'

export default function DeleteTrackForm({ onCommitted }) {
  const { t, fill } = useI18n()
  // { id, name, elements, switchNames } – switch branches are not offered: their
  // geometry belongs to a switch and goes with it, not on its own.
  const [selected, setSelected]     = useState(null)
  const [confirming, setConfirming] = useState(false)


  // Click to pick the track — the whole track is highlighted, since the whole
  // track is what gets deleted.
  useMapPick({
    active: selected === null, noSwitchBranch: true, hover: 'element',
    onPick: ({ trackId }) => {
      const track = loadTracks().find(tr => tr.id === trackId)
      if (!track) return
      setSelected({
        id:          trackId,
        name:        track.name || trackId.slice(0, 8),
        elements:    (track.elements ?? []).length,
        switchNames: switchesOnTrack(trackId).map((sw, i) => sw.name || `#${i + 1}`),
      })
    },
  })
  useSelectedOnMap(selected ? { trackId: selected.id } : null)

  const handleDelete = () => {
    deleteTrack(selected.id)
    setConfirming(false)
    setSelected(null)
  }


  return (
    <>
      {!selected ? (
        <p>{t('edit_element_hint')}</p>
      ) : (
        <>
          <p>{fill('edit_track_delete_selected', { name: selected.name, elements: selected.elements })}</p>
          {selected.switchNames.length > 0 && (
            <p className="form-error">{fill('edit_track_delete_switches', { names: selected.switchNames.join(', ') })}</p>
          )}
          <button className="panel-btn panel-btn-full panel-btn-danger" onClick={() => setConfirming(true)}>
            {t('edit_track_delete')}
          </button>
        </>
      )}
      <CancelButton className="panel-btn panel-btn-full mt-2 secondary" onClick={onCommitted} />

      {confirming && (
        <ConfirmModal
          message={fill('edit_track_delete_confirm', { name: selected.name, elements: selected.elements })}
          onConfirm={handleDelete}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
