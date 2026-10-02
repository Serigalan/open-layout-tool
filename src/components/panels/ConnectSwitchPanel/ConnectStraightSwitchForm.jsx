import { useEffect, useRef, useState } from 'react'
import { loadTracks, commitSwitchConnection } from '../../../storage'
import { SIDE_NAMES } from '../../../utils/identifierUtils'
import { elementPath } from '../../../utils/lineLookup'
import { resolveEndBearing, nodeUtm } from '../../../utils/elementUtils'
import { trackTypeName } from '../../../utils/trackGroups'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import useDerivedField from '../../../hooks/useDerivedField'
import TrackFields from '../TrackFields'
import SwitchNumberField from '../SwitchNumberField'
import SwitchCantField from './SwitchCantField'
import SwitchFormField from './SwitchFormField'
import useSwitchNumber from '../../../hooks/useSwitchNumber'
import HeightDatumField from '../HeightDatumField'
import { computeSwitchCant, computeCantDef, computeCantDefSigned, switchCantError, MAX_SWITCH_CANT_DEF } from '../../../utils/mapConstants'
import { pickAt } from '../../../map/pick'
import {
  SWITCH_PICK_TYPES, DEFAULT_SWITCH_TYPE_IDX, switchBranchLength, computeSwitchGeometryUtm, asRadius, branchRadius, bauform,
} from '../../../utils/switchUtils'
import { switchEndAnchorRefusal } from '../../../utils/switchPlacement'
import { SWITCH_LINES_SOURCE, SWITCH_FILL_SOURCE, SWITCH_PREVIEW_LAYERS, buildLinesGeoJSON, buildFillGeoJSON } from '../switchPreview'
import { useI18n } from '../../../locales/i18nContext'
import { useMap } from '../../../map/MapContext'
import { useProject } from '../../../hooks/useStore'
import { TRACKS_HOVER_LAYER } from '../../../map/layerIds'
import usePreview from '../../../map/usePreview'
import useMapPick from '../../../map/useMapPick'
import useMapEvents from '../../../map/useMapEvents'
import { buildSwitchAtTrackEnd } from '../../../utils/commands/switches'
import CommitBar from '../../form/CommitBar'
import DirectionToggle from '../../form/DirectionToggle'
import ReadOnlyField from '../../form/ReadOnlyField'
import FormSection from '../../form/FormSection'

/**
 * Radius an element ends on, in its running direction — the curvature a switch
 * attached to that end is bent into. A transition curve ends on its second
 * radius, an arc on its own, a straight on none.
 */
const endRadiusOf = (el) => asRadius(el?.elementType === 2 ? el?.r2 : el?.radius)

/**
 * A switch at the end of an existing element: the through route and the branch
 * are both created here, so nothing of the switch exists on the map yet.
 *
 * With `curved` the switch is bent — laid into a curve of the stem radius the
 * form asks for (prefilled from the element it is attached to). Both routes
 * then take that curvature on top of their own, so the through route becomes an
 * arc and the branch takes the sum of both (see branchRadius); the two share
 * one cant, since a turnout sits on one set of sleepers.
 */
export default function ConnectStraightSwitchForm({ onCommitted, curved = false }) {
  const { t } = useI18n()
  const map = useMap()
  const project = useProject()
  const { fields, errors, setErrors, setField, lineNumberError }                                              = useTrackFields()
  const { fields: mainFields, errors: mainErrors, setErrors: setMainErrors, setField: setMainField, lineNumberError: mainLineNumberError } = useTrackFields()
  const [nameError, setNameError]       = useState(false)
  // Why the last click was no place for a turnout (switchEndAnchorRefusal).
  const [pickError, setPickError]       = useState(null)
  const [mainNameError, setMainNameError] = useState(false)
  const switchNo                        = useSwitchNumber(project.id)
  const switchName                      = switchNo.name
  const [phase, setPhase]               = useState('select')
  const [anchor, setAnchor]             = useState(null)   // { startUtm, bearing, startWgs } of the picked element end
  const [switchTypeIdx, setSwitchTypeIdx] = useState(DEFAULT_SWITCH_TYPE_IDX)
  const [side, setSide]                 = useState('left')
  const [trailing, setTrailing]         = useState(false)
  const [speed, setSpeed]               = useState(SWITCH_PICK_TYPES[DEFAULT_SWITCH_TYPE_IDX].speed)
  const [stemInput, setStemInput]       = useState('')   // stem radius of a bent switch [m], signed

  // Bending the switch decides its radii before anything else can be said about
  // it: the branch takes the stem's curvature on top of the form's, so it comes
  // out tighter (inner-bent), wider or even straight (outer-bent).
  const currentSw     = SWITCH_PICK_TYPES[switchTypeIdx]
  const stemSigned    = curved ? asRadius(Number(stemInput)) : null
  const stemAtToe     = stemSigned == null ? null : (trailing ? -stemSigned : stemSigned)
  const formSignedR   = side === 'left' ? -currentSw.R : currentSw.R
  const branchSignedR = branchRadius(formSignedR, stemAtToe)
  // The tighter of the two routes governs the one cant they share.
  const routeRadii = [stemAtToe, branchSignedR].filter(r => r != null)
  const governingR = routeRadii.length
    ? routeRadii.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a))
    : formSignedR
  // Follows speed and switch type — and, bent, the stem — unless the user
  // overrode it for exactly that combination.
  const cantKey  = curved ? `${speed}|${switchTypeIdx}|${side}|${trailing}|${stemInput}` : `${speed}|${switchTypeIdx}`
  const [cant, setCant] = useDerivedField(cantKey,
    computeSwitchCant(speed, curved ? governingR : currentSw.R))
  // Why this turnout may carry more than MAX_SWITCH_CANT. Empty unless the user
  // pushed it there, and the commit stays blocked until it is written.
  const [cantReason, setCantReason] = useState('')

  // The tracks as they would be saved, each named by the line it lies on: the
  // branch always, the through route where it becomes a track of its own
  // (facing — trailing, it extends the picked track instead).
  const switchGeom = phase === 'editing' && anchor
    ? computeSwitchGeometryUtm(anchor.startUtm, anchor.bearing, currentSw, side, trailing, anchor.startWgs, stemSigned)
    : null
  const branchGeometry = switchGeom
    ? elementPath(switchGeom.arcOriginUtm, switchGeom.curvedUtm, switchGeom.signedR) : null
  const mainGeometry = switchGeom && !trailing
    ? elementPath(switchGeom.startUtm, switchGeom.straightUtm, switchGeom.mainSignedR) : null
  const { name, setName, reset: resetName } = useTrackName(project.id, fields, { geometry: branchGeometry, setField })
  // Both lie at the same kilometrage, so the through route steps past the branch's name.
  const { name: mainName, setName: setMainName, reset: resetMainName } = useTrackName(
    project.id, mainFields, { geometry: mainGeometry, setField: setMainField, alsoTaken: [name] })

  const switchTypeIdxRef   = useRef(switchTypeIdx)
  const sideRef            = useRef(side)
  const trailingRef        = useRef(trailing)
  const startWgsRef        = useRef(null)   // WGS84 twin of the start, for the drawn coordinates
  const startUtmRef        = useRef(null)   // the start in the track's plane — all geometry runs from here
  const bearingRef         = useRef(null)
  const sourceTrackRef     = useRef(null)
  const selectedTrackIdRef = useRef(null)
  const selectedElIdxRef   = useRef(null)

  useEffect(() => { switchTypeIdxRef.current = switchTypeIdx }, [switchTypeIdx])
  useEffect(() => { sideRef.current = side },                   [side])
  useEffect(() => { trailingRef.current = trailing },           [trailing])


  // ── Setup preview layers ──────────────────────────────────────────────────────────
  const preview = usePreview(SWITCH_PREVIEW_LAYERS, { resetFilters: [TRACKS_HOVER_LAYER], resetCursor: true })

  // ── Hover preview (select phase) ─────────────────────────────────────────
  useMapEvents(phase === 'select', {
    mousemove: (e, m) => {
      const hit = pickAt(m, e.point)
      if (!hit) {
        preview.set(SWITCH_LINES_SOURCE, null)
        preview.set(SWITCH_FILL_SOURCE, null)
        return
      }
      const { trackId, elementIndex } = hit
      const track = loadTracks().find(tr => tr.id === trackId)
      const el    = track?.elements?.[elementIndex]
      if (!el) return
      // Only where one may actually go — the preview is the answer to "here?",
      // so it must not stand somewhere the commit would then refuse.
      if (switchEndAnchorRefusal(track, elementIndex)) {
        preview.set(SWITCH_LINES_SOURCE, null)
        preview.set(SWITCH_FILL_SOURCE, null)
        return
      }

      const endWgs = el.geometry.coordinates[el.geometry.coordinates.length - 1]
      const endUtm = nodeUtm(el.endNode, endWgs, track.epsg)
      const brg    = resolveEndBearing(el, track.epsg)
      // Before a pick there is no entered stem radius yet, so the hover shows
      // the switch bent into the element it would sit on.
      const stem   = curved ? endRadiusOf(el) : null
      const geom   = computeSwitchGeometryUtm(endUtm, brg, SWITCH_PICK_TYPES[switchTypeIdxRef.current], sideRef.current, trailingRef.current, endWgs, stem)
      preview.set(SWITCH_LINES_SOURCE, buildLinesGeoJSON(geom))
      preview.set(SWITCH_FILL_SOURCE, buildFillGeoJSON(geom))
    },
  })

  // ── Click to select element (select phase) ────────────────────────────────
  useMapPick({
    active: phase === 'select', hover: 'element',
    onPick: ({ trackId, elementIndex }) => {
      const elIdx = elementIndex
      const tracks = loadTracks()
      const track  = tracks.find(tr => tr.id === trackId)
      const el     = track?.elements?.[elIdx]
      if (!el) return
      const refusal = switchEndAnchorRefusal(track, elIdx)
      if (refusal) { setPickError(refusal); return }
      setPickError(null)

      const endWgs = el.geometry.coordinates[el.geometry.coordinates.length - 1]
      const brg    = resolveEndBearing(el, track.epsg)

      const stem = endRadiusOf(el)
      setStemInput(curved && stem != null ? String(stem) : '')

      startWgsRef.current        = endWgs
      startUtmRef.current        = nodeUtm(el.endNode, endWgs, track.epsg)
      bearingRef.current         = brg
      sourceTrackRef.current     = track
      selectedTrackIdRef.current = trackId
      selectedElIdxRef.current   = elIdx

      setAnchor({ startUtm: startUtmRef.current, bearing: brg, startWgs: endWgs })

      // Main track: pre-populate from selected track; its name follows from these
      setMainField('owner',       track.owner       ?? 'DB')
      setMainField('type',        trackTypeName(track, 'station_track'))
      setMainField('lineNumber',  track.lineNumber  ?? '')
      setMainField('lineName',    track.lineName    ?? '')
      setMainField('side',        SIDE_NAMES[track.side]        ?? 'sorting')
      setMainField('stationName', track.stationName ?? '')
      setMainField('uicStation',  track.uicStation  ?? '')
      setMainField('trackNumber', track.trackNumber ?? '')

      // Divergent track: reset to defaults, keep auto-generated name
      setField('owner',       'DB')
      setField('type',        'line_track')
      setField('lineNumber',  '')
      setField('lineName',    '')
      setField('side',        'sorting')
      setField('stationName', '')
      setField('uicStation',  '')
      setField('trackNumber', '')
      setPhase('editing')
    },
  })

  // ── Update preview when options change (editing phase) ───────────────────
  useEffect(() => {
    if (phase !== 'editing' || !startWgsRef.current) return
    const geom = computeSwitchGeometryUtm(startUtmRef.current, bearingRef.current, SWITCH_PICK_TYPES[switchTypeIdx], side, trailing, startWgsRef.current, stemSigned)
    preview.set(SWITCH_LINES_SOURCE, buildLinesGeoJSON(geom))
    preview.set(SWITCH_FILL_SOURCE, buildFillGeoJSON(geom))
  }, [phase, switchTypeIdx, side, trailing, stemSigned, map, preview])

  const handleSwitchTypeChange = (idx) => {
    setSwitchTypeIdx(idx)
    setSpeed(SWITCH_PICK_TYPES[idx].speed)
  }


  const handleCancel = () => {
    preview.clear()
    setPickError(null)
    setPhase('select')
    onCommitted?.()
  }

  const handleNameChange = (val) => {
    setName(val)
    setNameError(false)
  }

  const handleCommit = () => {
    setErrors([])
    setMainErrors([])
    if (lineNumberError || (!trailing && mainLineNumberError)) return

    const existingNames = new Set(loadTracks().map(t => t.name).filter(Boolean))
    let hasError = false
    if (name && (existingNames.has(name) || (!trailing && name === mainName))) {
      setNameError(true); hasError = true
    } else { setNameError(false) }
    if (!trailing && mainName && (existingNames.has(mainName) || mainName === name)) {
      setMainNameError(true); hasError = true
    } else { setMainNameError(false) }
    if (!switchNo.claim()) hasError = true
    if (hasError) return

    const sw          = SWITCH_PICK_TYPES[switchTypeIdx]
    const sourceTrack = sourceTrackRef.current
    if (!sourceTrack || !startWgsRef.current) return

    commitSwitchConnection(buildSwitchAtTrackEnd({
      start: startUtmRef.current, bearing: bearingRef.current, startWgs: startWgsRef.current,
      sourceTrackId: trailing ? selectedTrackIdRef.current : sourceTrack.id,
      sw, side, trailing, stemSigned: stemSigned, cant, cantReason, speed,
      switchName, switchNumber: switchNo.number, name, fields, mainName, mainFields,
    }))

    resetName()
    resetMainName()
    setNameError(false)
    switchNo.reset()
    preview.clear()
    onCommitted?.()
  }

  const arcLen  = switchBranchLength(currentSw)
  // Deficiency per route. Bent, the two share one cant that only one of them is
  // banked for, so the sign of the cant is read against each rather than dropped.
  const cantDef = curved ? computeCantDefSigned(speed, branchSignedR, cant)
    : computeCantDef(speed, currentSw.R, cant)
  const stemDef = curved ? computeCantDefSigned(speed, stemAtToe, cant) : null
  const cantErr = switchCantError(cant, cantReason)
  const defErr  = cantDef > MAX_SWITCH_CANT_DEF || (stemDef ?? 0) > MAX_SWITCH_CANT_DEF

  return (
    <>
      <DirectionToggle value={trailing} onChange={setTrailing} left={t('switch_facing')} right={t('switch_trailing')} />

      <FormSection title={t('section_geometry')}>
        <SwitchFormField value={switchTypeIdx} onChange={handleSwitchTypeChange} hideSymmetric={curved} />
        <div className="form-field">
          <label>{t('switch_side')}</label>
          <select value={side} onChange={e => setSide(e.target.value)}>
            <option value="left">{t('switch_side_left')}</option>
            <option value="right">{t('switch_side_right')}</option>
          </select>
        </div>
        {curved && (
          <>
            <div className="form-field">
              <label>{t('switch_stem_radius')}</label>
              <input type="number" step="any" value={stemInput}
                onChange={e => setStemInput(e.target.value)} />
            </div>
            <ReadOnlyField label={t('switch_bauform')} value={t(`switch_bauform_${bauform(stemAtToe, branchSignedR)}`)} />
          </>
        )}
        <div className="form-field">
          <label>{t('field_speed')}</label>
          <input type="number" min="0" value={speed} onChange={e => setSpeed(Number(e.target.value))} />
        </div>
        <SwitchCantField cant={cant} onCant={setCant}
          reason={cantReason} onReason={setCantReason} />
        {curved && (
          <ReadOnlyField type="number" label={t('switch_stem_cant_def')} value={stemDef ?? 0} />
        )}
        <ReadOnlyField type="number" label={curved ? t('switch_branch_cant_def') : t('cant_def')} value={cantDef} />
        <ReadOnlyField label={t('arc_length')} value={`~${arcLen.toFixed(1)} m`} />
        <ReadOnlyField label={curved ? t('switch_branch_radius') : t('field_radius')} value={
            !curved ? `${currentSw.R} m`
              : branchSignedR == null ? t('switch_branch_straight')
                : `${Math.round(branchSignedR)} m`
          } />
        {/* Both tracks describe the same spot, so they share one height datum. */}
        <HeightDatumField value={fields.heightEpsg}
          onChange={v => { setField('heightEpsg', v); setMainField('heightEpsg', v) }} />
      </FormSection>

      <FormSection title={t('switch_meta_data')}>
        <SwitchNumberField number={switchNo.number} onChange={switchNo.setNumber}
          name={switchNo.name} taken={switchNo.taken} />
      </FormSection>

      {!trailing && (
        <FormSection title={t('section_meta_main')}>
          <TrackFields fields={mainFields} setField={setMainField} setErrors={setMainErrors} errors={mainErrors}
            name={mainName} onNameChange={(val) => { setMainName(val); setMainNameError(false) }} nameError={mainNameError} />
        </FormSection>
      )}

      <FormSection title={t('section_meta_divergent')}>
        <TrackFields fields={fields} setField={setField} setErrors={setErrors} errors={errors}
          name={name} onNameChange={handleNameChange} nameError={nameError} />
      </FormSection>

      {phase === 'select' && (
        <>
          <p>{t(curved ? 'switch_curved_hint' : 'switch_hint')}</p>
          {pickError && <p className="form-error">{t(pickError)}</p>}
        </>
      )}

      {phase === 'editing' && (
        <>
          {cantErr && <p className="form-error">{t(`switch_cant_error_${cantErr}`)}</p>}
          {defErr  && <p className="form-error">{t('switch_cant_def_error')}</p>}
          <CommitBar onCommit={handleCommit} onCancel={handleCancel} disabled={!!cantErr || defErr} />
        </>
      )}
    </>
  )
}
