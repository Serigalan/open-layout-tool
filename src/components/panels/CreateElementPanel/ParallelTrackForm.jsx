import { useCallback, useEffect, useRef, useState } from 'react'
import { saveTrack, loadTracks, generateId, rebuildCoords, recalcAbsLengths } from '../../../storage'
import { offsetTrackElements } from '../../../utils/parallelUtils'
import { buildTypeFields } from '../../../utils/identifierUtils'
import { setLineData, setMarkerData, clearPreview } from '../../../utils/mapRenderUtils'
import { FILTER_NONE, HIT_TOLERANCE, mapIsLive } from '../../../utils/mapConstants'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import TrackFields from '../TrackFields'
import HeightDatumField from '../HeightDatumField'
import { elementsPath } from '../../../utils/lineLookup'
import RuleFindings from '../RuleFindings'

export default function ParallelTrackForm({ t, map, project, onTrackSaved }) {
  const { fields, errors, setErrors, setField, lineNumberError } = useTrackFields()
  const [nameError, setNameError] = useState(false)
  const [selecting, setSelecting] = useState(true)
  const [offset, setOffset]       = useState('4.5')
  const [elements, setElements]   = useState(null)   // offset element chain
  const [invalid, setInvalid]     = useState(false)
  const [sourceEpsg, setSourceEpsg] = useState(null)  // the picked track's plane, which the parallel keeps
  const sourceRef                 = useRef(null)      // the picked track
  // The track as it would be saved: the line it lies on names it.
  const geometry = elements && sourceEpsg ? elementsPath(elements, sourceEpsg) : null
  const { name, setName } = useTrackName(project.id, fields, { geometry, setField })

  useEffect(() => {
    const m = map?.current
    return () => {
      if (!mapIsLive(map, m)) return
      clearPreview(m)
      m.getCanvas().style.cursor = ''
      m.setFilter('tracks-selected-layer', FILTER_NONE)
    }
  }, [map])

  const build = useCallback((track, dist, m) => {
    const els = offsetTrackElements(track.elements ?? [], dist, track.epsg)
    setElements(els)
    setInvalid(!els)
    if (m) {
      if (els) {
        const coords = rebuildCoords(els)
        setLineData(m, coords, `${(track.elements ?? []).length} ${t('parallel_track_elements')}`)
        setMarkerData(m, [coords[0], coords[coords.length - 1]])
      } else {
        clearPreview(m)
      }
    }
  }, [t])

  // Pick a track to offset.
  useEffect(() => {
    if (!selecting || !map?.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'pointer'

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })
        .filter(f => !f.properties.switchBranch)
      if (features.length === 0) return

      const { trackId } = features[0].properties
      const track = loadTracks(project.id).find(tr => tr.id === trackId)
      if (!track?.elements?.length) return

      sourceRef.current = track
      setSourceEpsg(track.epsg)
      m.setFilter('tracks-selected-layer', ['==', ['get', 'trackId'], trackId])
      m.getCanvas().style.cursor = ''
      m.off('click', onClick)
      setSelecting(false)
      build(track, Number(offset) || 0, m)
    }

    m.on('click', onClick)
    return () => { m.off('click', onClick); m.getCanvas().style.cursor = '' }
  }, [selecting, map, build, offset, project.id])

  const handleOffsetChange = (val) => {
    setOffset(val)
    const d = Number(val)
    if (isNaN(d) || !sourceRef.current) return
    build(sourceRef.current, d, map?.current)
  }

  const handleNameChange = (val) => {
    setName(val)
    setNameError(false)
  }

  const handleCommit = () => {
    setErrors([])
    if (lineNumberError || !elements) return
    const existingNames = new Set(loadTracks(project.id).map(t => t.name).filter(Boolean))
    if (name && existingNames.has(name)) { setNameError(true); return }
    setNameError(false)

    const els = recalcAbsLengths(elements)
    saveTrack(project.id, {
      id:          generateId(),
      name,
      owner:       fields.owner,
      ...buildTypeFields(fields),
      coordinates: rebuildCoords(els),
      epsg:     sourceRef.current?.epsg,
      elements:    els,
    })

    if (map?.current) {
      clearPreview(map.current)
      map.current.setFilter('tracks-selected-layer', FILTER_NONE)
    }
    onTrackSaved?.()
  }

  return (
    <>
      <div className="element-form">
        <span className="create-element-section">Meta Data</span>
        <TrackFields t={t} fields={fields} setField={setField} setErrors={setErrors} errors={errors}
          name={name} onNameChange={handleNameChange} nameError={nameError} />
      </div>

      {!selecting && (
        <div className="element-form">
          <span className="create-element-section">Geometry Data</span>
          <div className="form-field">
            <label>{t('field_offset')}</label>
            <input type="number" step="0.01" value={offset} onChange={e => handleOffsetChange(e.target.value)} />
          </div>
          <HeightDatumField t={t} value={fields.heightEpsg} onChange={v => setField('heightEpsg', v)} />
        </div>
      )}

      {selecting && <p className="selecting-hint">{t('parallel_track_select')}</p>}
      {invalid && <p className="form-error">{t('parallel_track_invalid')}</p>}

      {errors.length > 0 && (
        <p className="form-error">
          ⚠ <span className="form-error-required">{t('error_required')}</span>: {errors.join(', ')}
        </p>
      )}

      {!selecting && (
        <>
          {/* A whole chain at once — offset from an existing track, so what
              the catalogue has to say about it is mostly what it had to say
              about the track it was drawn beside. */}
          {elements && <RuleFindings t={t} elements={elements} />}
          <button className="panel-btn panel-btn-full" style={{ opacity: elements ? 1 : 0.5 }} disabled={!elements} onClick={handleCommit}>
            {t('btn_commit')}
          </button>
          <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onTrackSaved}>
            {t('btn_cancel')}
          </button>
        </>
      )}
    </>
  )
}
