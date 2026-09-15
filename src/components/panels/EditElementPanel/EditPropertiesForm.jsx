import { useEffect, useState } from 'react'
import { loadTracks, replaceAllTracks } from '../../../storage'
import { TYPE_NAMES, SIDE_NAMES, buildTypeFields } from '../../../utils/identifierUtils'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackHover from '../../../hooks/useTrackHover'
import TrackFields from '../TrackFields'
import HeightDatumField from '../HeightDatumField'
import { FILTER_NONE, HIT_TOLERANCE, filterForTrack, DEFAULT_HEIGHT_EPSG, mapIsLive } from '../../../utils/mapConstants'

export default function EditPropertiesForm({ t, map, project, onCommitted, onTrackSaved }) {
  const { fields, errors, setErrors, setField, lineNumberError } = useTrackFields()
  const [selectedTrackId, setSelectedTrackId] = useState(null)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState(false)

  useTrackHover(map, selectedTrackId === null ? 'select' : 'editing', 'select', project, true)

  useEffect(() => {
    const m = map?.current
    return () => {
      if (!mapIsLive(map, m)) return
      m.setFilter('tracks-selected-layer', FILTER_NONE)
      m.getCanvas().style.cursor = ''
    }
  }, [map])

  // Click to select track
  useEffect(() => {
    if (selectedTrackId !== null || !map?.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'pointer'

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] }).filter(f => !f.properties.switchBranch)
      if (features.length === 0) return
      const { trackId } = features[0].properties
      const track = loadTracks(project.id).find(tr => tr.id === trackId)
      if (!track) return

      // The properties belong to the track, so the whole track is highlighted —
      // clicking one of its elements only says which track is meant.
      m.setFilter('tracks-selected-layer', filterForTrack(trackId))
      setSelectedTrackId(trackId)
      setName(track.name ?? '')
      setField('owner',       track.owner       ?? 'DB')
      setField('type',        TYPE_NAMES[track.trackType]   ?? 'line_track')
      setField('lineNumber',  track.lineNumber  ?? '')
      setField('lineName',    track.lineName    ?? '')
      setField('side',        SIDE_NAMES[track.side]        ?? 'sorting')
      setField('stationName', track.stationName ?? '')
      setField('uicStation',  track.uicStation  ?? '')
      setField('trackNumber', track.trackNumber ?? '')
      setField('heightEpsg',  String(track.heightEpsg ?? DEFAULT_HEIGHT_EPSG))
    }

    m.on('click', onClick)
    return () => { m.off('click', onClick); m.getCanvas().style.cursor = '' }
  }, [selectedTrackId, map, project.id, setField])

  const handleCommit = () => {
    setErrors([])
    if (lineNumberError) return

    const existingNames = new Set(
      loadTracks(project.id).filter(t => t.id !== selectedTrackId).map(t => t.name).filter(Boolean)
    )
    if (name && existingNames.has(name)) {
      setNameError(true)
      return
    }
    setNameError(false)

    const tracks = loadTracks(project.id)
    if (!tracks.some(t => t.id === selectedTrackId)) return

    // Only the selected track is written — the properties describe this track,
    // and a neighbour that happens to connect to it may well be a different line.
    const newTracks = tracks.map(track => track.id !== selectedTrackId ? track : {
      ...track,
      name,
      owner: fields.owner,
      ...buildTypeFields(fields),
    })

    replaceAllTracks(project.id, newTracks)
    onTrackSaved?.()
    onCommitted?.()
  }

  return (
    <>
      {!selectedTrackId ? (
        <p>{t('edit_element_hint')}</p>
      ) : (
        <>
          <div className="element-form">
            <span className="create-element-section">Meta Data</span>
            <TrackFields t={t} fields={fields} setField={setField} setErrors={setErrors} errors={errors}
              name={name} onNameChange={(val) => { setName(val); setNameError(false) }} nameError={nameError} />
          </div>
          <div className="element-form">
            <span className="create-element-section">Geometry Data</span>
            <HeightDatumField t={t} value={fields.heightEpsg} onChange={v => setField('heightEpsg', v)} />
          </div>
        </>
      )}
      {selectedTrackId ? (
        <>
          <button className="panel-btn panel-btn-full" style={{ marginTop: 8 }} onClick={handleCommit}>
            {t('btn_commit')}
          </button>
          <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onCommitted}>
            {t('btn_cancel')}
          </button>
        </>
      ) : (
        <button className="panel-btn panel-btn-full" style={{ marginTop: 8, background: '#888' }} onClick={onCommitted}>
          {t('btn_cancel')}
        </button>
      )}
    </>
  )
}
