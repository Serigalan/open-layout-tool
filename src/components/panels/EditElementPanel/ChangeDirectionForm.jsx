import { useState } from 'react'
import { reverseTrackDirection } from '../../../storage'
import { useI18n } from '../../../locales/i18nContext'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'

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
          <button className="panel-btn panel-btn-full mt-8" onClick={handleCommit}>
            {t('btn_commit')}
          </button>
          <button className="panel-btn panel-btn-full mt-2 secondary" onClick={onCommitted}>
            {t('btn_cancel')}
          </button>
        </>
      ) : (
        <button className="panel-btn panel-btn-full mt-8 secondary" onClick={onCommitted}>
          {t('btn_cancel')}
        </button>
      )}
    </>
  )
}
