import { useState } from 'react'
import { loadTracks, replaceAllTracks } from '../../../storage'
import { SIDE_NAMES, buildTypeFields } from '../../../utils/identifierUtils'
import useTrackFields from '../../../hooks/useTrackFields'
import TrackFields from '../TrackFields'
import StatusField from '../StatusField'
import { trackStatus } from '../../../utils/planStatus'
import HeightDatumField from '../HeightDatumField'
import { DEFAULT_HEIGHT_EPSG } from '../../../utils/heightDatums'
import { trackTypeName } from '../../../utils/trackGroups'
import { useI18n } from '../../../locales/i18nContext'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'
import CommitBar from '../../form/CommitBar'
import FormSection from '../../form/FormSection'
import CancelButton from '../../form/CancelButton'
import { firstReason } from '../../form/firstReason'

export default function EditPropertiesForm({ onCommitted }) {
  const { t } = useI18n()
  const { fields, errors, setErrors, setField, lineNumberError } = useTrackFields()
  const [selectedTrackId, setSelectedTrackId] = useState(null)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState(false)
  const [status, setStatus] = useState('existing')


  // The properties belong to the track, so the whole track is highlighted —
  // clicking one of its elements only says which track is meant.
  useMapPick({
    active: selectedTrackId === null, noSwitchBranch: true, hover: 'element',
    onPick: ({ trackId }) => {
      const track = loadTracks().find(tr => tr.id === trackId)
      if (!track) return
      setSelectedTrackId(trackId)
      setName(track.name ?? '')
      setStatus(trackStatus(track))
      setField('owner',       track.owner       ?? 'DB')
      setField('type',        trackTypeName(track, 'line_track'))
      setField('lineNumber',  track.lineNumber  ?? '')
      setField('lineName',    track.lineName    ?? '')
      setField('side',        SIDE_NAMES[track.side]        ?? 'sorting')
      setField('stationName', track.stationName ?? '')
      setField('uicStation',  track.uicStation  ?? '')
      setField('trackNumber', track.trackNumber ?? '')
      setField('lineCategory', track.lineCategory ?? '')
      setField('trackUse',    track.trackUse    ?? 'main')
      setField('heightEpsg',  String(track.heightEpsg ?? DEFAULT_HEIGHT_EPSG))
    },
  })
  useSelectedOnMap(selectedTrackId ? { trackId: selectedTrackId } : null)

  const handleCommit = () => {
    setErrors([])
    if (lineNumberError) return

    const existingNames = new Set(
      loadTracks().filter(t => t.id !== selectedTrackId).map(t => t.name).filter(Boolean)
    )
    if (name && existingNames.has(name)) {
      setNameError(true)
      return
    }
    setNameError(false)

    const tracks = loadTracks()
    if (!tracks.some(t => t.id === selectedTrackId)) return

    // Only the selected track is written — the properties describe this track,
    // and a neighbour that happens to connect to it may well be a different line.
    const newTracks = tracks.map(track => track.id !== selectedTrackId ? track : {
      ...track,
      name,
      owner: fields.owner,
      ...buildTypeFields(fields),
      // Existing is what a track without a status is, so it is not written.
      status: status === 'existing' ? undefined : status,
    })

    replaceAllTracks(newTracks)
    onCommitted?.()
  }

  return (
    <>
      {!selectedTrackId ? (
        <p>{t('edit_element_hint')}</p>
      ) : (
        <>
          <FormSection title={t('section_meta')}>
            <TrackFields fields={fields} setField={setField} setErrors={setErrors} errors={errors}
              name={name} onNameChange={(val) => { setName(val); setNameError(false) }} nameError={nameError} />
            <StatusField value={status} onChange={setStatus} />
          </FormSection>
          <FormSection title={t('section_geometry')}>
            <HeightDatumField value={fields.heightEpsg} onChange={v => setField('heightEpsg', v)} />
          </FormSection>
        </>
      )}
      {selectedTrackId ? (
        <>
          <CommitBar onCommit={handleCommit} onCancel={onCommitted} reason={firstReason(lineNumberError && t(`line_number_error_${lineNumberError}`))} />
        </>
      ) : (
        <CancelButton className="panel-btn panel-btn-full mt-8 secondary" onClick={onCommitted} />
      )}
    </>
  )
}
