import { useState } from 'react'
import { deleteElement } from '../../../storage'
import { useI18n } from '../../../locales/i18nContext'
import { useProject } from '../../../hooks/useStore'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'

export default function DeleteForm({ onCommitted }) {
  const { t } = useI18n()
  const project = useProject()
  const [selectedTrackId, setSelectedTrackId] = useState(null)
  const [selectedElementIndex, setSelectedElementIndex] = useState(null)

  // A click picks the element (a switch's own branch is deleted with the
  // switch, not here); a click beside the tracks lets it go again.
  useMapPick({
    noSwitchBranch: true,
    onPick: ({ trackId, elementIndex }) => { setSelectedTrackId(trackId); setSelectedElementIndex(elementIndex) },
    onMiss: () => { setSelectedTrackId(null); setSelectedElementIndex(null) },
  })
  useSelectedOnMap(selectedTrackId === null ? null : { trackId: selectedTrackId, elementIndex: selectedElementIndex })

  const handleDelete = () => {
    if (selectedTrackId === null || selectedElementIndex === null || !project) return
    deleteElement(selectedTrackId, selectedElementIndex)
    setSelectedTrackId(null)
    setSelectedElementIndex(null)
    onCommitted?.()
  }

  return (
    <>
      {selectedTrackId === null ? (
        <p>{t('edit_element_hint')}</p>
      ) : (
        <>
          <p>{t('edit_element_selected')}: <code>{selectedTrackId}[{selectedElementIndex}]</code></p>
          <button className="panel-btn panel-btn-full panel-btn-danger" onClick={handleDelete}>
            {t('edit_element_delete')}
          </button>
        </>
      )}
    </>
  )
}
