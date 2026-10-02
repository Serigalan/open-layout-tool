import { useCallback, useEffect, useRef, useState } from 'react'
import { saveTrack, loadTracks } from '../../../storage'
import { generateId, buildTypeFields } from '../../../utils/identifierUtils'
import { rebuildCoords, recalcAbsLengths } from '../../../utils/trackModel'
import { offsetTrackElements } from '../../../utils/parallelUtils'
import { setLineData, setMarkerData, clearPreview } from '../../../utils/mapRenderUtils'
import { FILTER_NONE, HIT_TOLERANCE, mapIsLive } from '../../../utils/mapConstants'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import TrackFields from '../TrackFields'
import HeightDatumField from '../HeightDatumField'
import { elementsPath } from '../../../utils/lineLookup'
import RuleFindings from '../RuleFindings'
import { hasRuleError } from '../../../utils/trassierungCheck'
import { useI18n } from '../../../locales/i18nContext'
import { useMap } from '../../../map/MapContext'
import { useProject } from '../../../hooks/useStore'
import { TRACKS_LAYER, TRACKS_SELECTED_LAYER } from '../../../map/layerIds'

export default function ParallelTrackForm({ onDone }) {
  const { t } = useI18n()
  const map = useMap()
  const project = useProject()
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
  // A parallel inherits the geometry it was offset from, so a rule the source
  // breaks is one the copy breaks too — and a copy of a chain that cannot be
  // built is not something to write a second time.
  const blocked = hasRuleError(elements ?? [])
  const { name, setName } = useTrackName(project.id, fields, { geometry, setField })

  useEffect(() => {
    const m = map?.current
    return () => {
      if (!mapIsLive(map, m)) return
      clearPreview(m)
      m.getCanvas().style.cursor = ''
      m.setFilter(TRACKS_SELECTED_LAYER, FILTER_NONE)
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
      const features = m.queryRenderedFeatures(bbox, { layers: [TRACKS_LAYER] })
        .filter(f => !f.properties.switchBranch)
      if (features.length === 0) return

      const { trackId } = features[0].properties
      const track = loadTracks().find(tr => tr.id === trackId)
      if (!track?.elements?.length) return

      sourceRef.current = track
      setSourceEpsg(track.epsg)
      m.setFilter(TRACKS_SELECTED_LAYER, ['==', ['get', 'trackId'], trackId])
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
    const existingNames = new Set(loadTracks().map(t => t.name).filter(Boolean))
    if (name && existingNames.has(name)) { setNameError(true); return }
    setNameError(false)

    const els = recalcAbsLengths(elements)
    saveTrack({
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
      map.current.setFilter(TRACKS_SELECTED_LAYER, FILTER_NONE)
    }
    onDone?.()
  }

  return (
    <>
      <div className="element-form">
        <span className="create-element-section">{t('section_meta')}</span>
        <TrackFields fields={fields} setField={setField} setErrors={setErrors} errors={errors}
          name={name} onNameChange={handleNameChange} nameError={nameError} />
      </div>

      {!selecting && (
        <div className="element-form">
          <span className="create-element-section">{t('section_geometry')}</span>
          <div className="form-field">
            <label>{t('field_offset')}</label>
            <input type="number" step="0.01" value={offset} onChange={e => handleOffsetChange(e.target.value)} />
          </div>
          <HeightDatumField value={fields.heightEpsg} onChange={v => setField('heightEpsg', v)} />
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
          {elements && <RuleFindings elements={elements} />}
          <button className="panel-btn panel-btn-full"
            style={{ opacity: (elements && !blocked) ? 1 : 0.5 }}
            disabled={!elements || blocked} onClick={handleCommit}>
            {t('btn_commit')}
          </button>
          <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onDone}>
            {t('btn_cancel')}
          </button>
        </>
      )}
    </>
  )
}
