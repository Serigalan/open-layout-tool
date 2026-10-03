import { useState } from 'react'
import { reverseTrackDirection } from '../../../storage'
import { useI18n } from '../../../locales/i18nContext'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'
import CommitBar from '../../form/CommitBar'
import CancelButton from '../../form/CancelButton'

export default function ChangeDirectionForm({ onCommitted }) {
  const { t } = useI18n()
  const [selectedTrackId, setSelectedTrackId] = useState(null)

  // The whole track is reversed, so the whole track is what is picked.
  useMapPick({
    active: selectedTrackId === null, noSwitchBranch: true, hover: 'element',
    onPick: ({ trackId }) => setSelectedTrackId(trackId),
  })
  useSelectedOnMap(selectedTrackId ? { trackId: selectedTrackId } : null)

  const handleCommit = () => {
    if (!selectedTrackId) return
    reverseTrackDirection(selectedTrackId)
    onCommitted?.()
  }

  return (
    <>
      {!selectedTrackId
        ? <p>{t('edit_element_hint')}</p>
        : <p>{t('edit_element_selected')}</p>
      }
      {selectedTrackId ? (
        <>
          <CommitBar onCommit={handleCommit} onCancel={onCommitted} />
        </>
      ) : (
        <CancelButton className="panel-btn panel-btn-full mt-8 secondary" onClick={onCommitted} />
      )}
    </>
  )
}
