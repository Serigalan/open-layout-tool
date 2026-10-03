import { useCallback, useRef, useState } from 'react'
import { saveTrack, loadTracks } from '../../../storage'
import { rebuildCoords } from '../../../utils/trackModel'
import { offsetTrackElements } from '../../../utils/parallelUtils'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import TrackFields from '../TrackFields'
import HeightDatumField from '../HeightDatumField'
import { elementsPath } from '../../../utils/lineLookup'
import RuleFindings from '../RuleFindings'
import { hasRuleError } from '../../../utils/trassierungCheck'
import { useI18n } from '../../../locales/i18nContext'
import { useProject } from '../../../hooks/useStore'
import useDrawPreview from '../../../map/useDrawPreview'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'
import { buildParallelTrack, trackMeta } from '../../../utils/commands/tracks'
import CommitBar from '../../form/CommitBar'
import FormSection from '../../form/FormSection'
import { firstReason } from '../../form/firstReason'
import MessageList from '../../form/MessageList'
import NumberInput from '../../form/NumberInput'
import { splitUnit } from '../../../locales/i18n'

export default function ParallelTrackForm({ onDone }) {
  const { t } = useI18n()
  const draw = useDrawPreview()
  const project = useProject()
  const { fields, errors, setErrors, setField, lineNumberError } = useTrackFields()
  const [nameError, setNameError] = useState(false)
  const [selecting, setSelecting] = useState(true)
  const [offset, setOffset]       = useState('4.5')
  const [elements, setElements]   = useState(null)   // offset element chain
  const [invalid, setInvalid]     = useState(false)
  const [sourceEpsg, setSourceEpsg] = useState(null)  // the picked track's plane, which the parallel keeps
  const sourceRef                 = useRef(null)      // the picked track
  const [picked, setPicked]       = useState(null)    // { trackId } on the map
  // The track as it would be saved: the line it lies on names it.
  const geometry = elements && sourceEpsg ? elementsPath(elements, sourceEpsg) : null
  // A parallel inherits the geometry it was offset from, so a rule the source
  // breaks is one the copy breaks too — and a copy of a chain that cannot be
  // built is not something to write a second time.
  const blocked = hasRuleError(elements ?? [])
  const { name, setName } = useTrackName(project.id, fields, { geometry, setField })


  const build = useCallback((track, dist) => {
    const els = offsetTrackElements(track.elements ?? [], dist, track.epsg)
    setElements(els)
    setInvalid(!els)
    if (els) {
      const coords = rebuildCoords(els)
      draw.line(coords, `${(track.elements ?? []).length} ${t('parallel_track_elements')}`)
      draw.markers([coords[0], coords[coords.length - 1]])
    } else {
      draw.clear()
    }
  }, [t, draw])

  // Pick a track to offset.
  useMapPick({
    active: selecting, noSwitchBranch: true,
    onPick: ({ trackId }) => {
      const track = loadTracks().find(tr => tr.id === trackId)
      if (!track?.elements?.length) return
      sourceRef.current = track
      setSourceEpsg(track.epsg)
      setPicked({ trackId })
      setSelecting(false)
      build(track, Number(offset) || 0)
    },
  })
  useSelectedOnMap(picked)

  const handleOffsetChange = (val) => {
    setOffset(val)
    const d = Number(val)
    if (isNaN(d) || !sourceRef.current) return
    build(sourceRef.current, d)
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

    saveTrack(buildParallelTrack({ elements, epsg: sourceRef.current?.epsg, meta: trackMeta(fields, name) }))

    draw.clear()
    onDone?.()
  }

  return (
    <>
      <FormSection title={t('section_meta')}>
        <TrackFields fields={fields} setField={setField} setErrors={setErrors} errors={errors}
          name={name} onNameChange={handleNameChange} nameError={nameError} />
      </FormSection>

      {!selecting && (
        <FormSection title={t('section_geometry')}>
          <div className="form-field">
            <label>{splitUnit(t('field_offset')).text}</label>
            <NumberInput step="0.01" value={offset} onChange={e => handleOffsetChange(e.target.value)} unit="m" />
          </div>
          <HeightDatumField value={fields.heightEpsg} onChange={v => setField('heightEpsg', v)} />
        </FormSection>
      )}

      {selecting && <p className="selecting-hint">{t('parallel_track_select')}</p>}
      {invalid && <p className="form-error">{t('parallel_track_invalid')}</p>}

      <MessageList items={errors} className="form-error-list" small={false} />

      {!selecting && (
        <>
          {/* A whole chain at once — offset from an existing track, so what
              the catalogue has to say about it is mostly what it had to say
              about the track it was drawn beside. */}
          {elements && <RuleFindings elements={elements} />}
          <CommitBar onCommit={handleCommit} onCancel={onDone} disabled={!elements || !!firstReason(lineNumberError && t(`line_number_error_${lineNumberError}`), blocked && t('commit_blocked_rules'))} reason={firstReason(lineNumberError && t(`line_number_error_${lineNumberError}`), blocked && t('commit_blocked_rules'))} className="" />
        </>
      )}
    </>
  )
}
