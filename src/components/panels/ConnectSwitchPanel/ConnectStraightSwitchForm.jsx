import { useEffect, useRef, useState } from 'react'
import {
  addElementToTrack, loadTracks, saveTrack, saveSwitch, generateId,
} from '../../../storage'
import { elementPath } from '../../../utils/lineLookup'
import { computeStraightValuesUtm, computeCurvedValuesUtm, resolveEndBearing, nodeUtm } from '../../../utils/elementUtils'
import { TYPE_NAMES, SIDE_NAMES, buildTypeFields } from '../../../utils/identifierUtils'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import useDerivedField from '../../../hooks/useDerivedField'
import useTrackHover from '../../../hooks/useTrackHover'
import usePreviewLayers from '../../../hooks/usePreviewLayers'
import TrackFields from '../TrackFields'
import SwitchNumberField from './SwitchNumberField'
import useSwitchNumber from '../../../hooks/useSwitchNumber'
import HeightDatumField from '../HeightDatumField'
import {
  HIT_TOLERANCE, computeSwitchCant, computeCantDef, computeCantDefSigned,
  roundCant, CANT_STEP, MAX_CANT, MAX_SWITCH_CANT_DEF,
} from '../../../utils/mapConstants'
import {
  SWITCH_TYPES, switchArcLength, computeSwitchGeometryUtm, asRadius, branchRadius, bauform,
} from '../../../utils/switchUtils'
import {
  SWITCH_LINES_SOURCE, SWITCH_FILL_SOURCE, SWITCH_PREVIEW_LAYERS,
  EMPTY_FC, buildLinesGeoJSON, buildFillGeoJSON,
} from './switchPreview'

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
export default function ConnectStraightSwitchForm({ t, map, project, onTrackSaved, onCommitted, curved = false }) {
  const { fields, errors, setErrors, setField, lineNumberError }                                              = useTrackFields()
  const { fields: mainFields, errors: mainErrors, setErrors: setMainErrors, setField: setMainField, lineNumberError: mainLineNumberError } = useTrackFields()
  const [nameError, setNameError]       = useState(false)
  const [mainNameError, setMainNameError] = useState(false)
  const switchNo                        = useSwitchNumber(project.id)
  const switchName                      = switchNo.name
  const [phase, setPhase]               = useState('select')
  const [anchor, setAnchor]             = useState(null)   // { startUtm, bearing, startWgs } of the picked element end
  const [switchTypeIdx, setSwitchTypeIdx] = useState(2)
  const [side, setSide]                 = useState('left')
  const [trailing, setTrailing]         = useState(false)
  const [speed, setSpeed]               = useState(SWITCH_TYPES[2].speed)
  const [stemInput, setStemInput]       = useState('')   // stem radius of a bent switch [m], signed

  // Bending the switch decides its radii before anything else can be said about
  // it: the branch takes the stem's curvature on top of the form's, so it comes
  // out tighter (inner-bent), wider or even straight (outer-bent).
  const currentSw     = SWITCH_TYPES[switchTypeIdx]
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

  useTrackHover(map, phase, 'select', project)

  // ── Setup preview layers ──────────────────────────────────────────────────────────
  usePreviewLayers(map, SWITCH_PREVIEW_LAYERS, { resetFilters: ['tracks-hover-layer'], resetCursor: true })

  // ── Hover preview (select phase) ─────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'select' || !map?.current) return
    const m = map.current

    const onMouseMove = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })
      if (features.length === 0) {
        m.getSource(SWITCH_LINES_SOURCE)?.setData(EMPTY_FC)
        m.getSource(SWITCH_FILL_SOURCE)?.setData(EMPTY_FC)
        return
      }
      const { trackId, elementIndex } = features[0].properties
      const track = loadTracks(project.id).find(tr => tr.id === trackId)
      const el    = track?.elements?.[Number(elementIndex)]
      if (!el) return

      const endWgs = el.geometry.coordinates[el.geometry.coordinates.length - 1]
      const endUtm = nodeUtm(el.endNode, endWgs, track.epsg)
      const brg    = resolveEndBearing(el, track.epsg)
      // Before a pick there is no entered stem radius yet, so the hover shows
      // the switch bent into the element it would sit on.
      const stem   = curved ? endRadiusOf(el) : null
      const geom   = computeSwitchGeometryUtm(endUtm, brg, SWITCH_TYPES[switchTypeIdxRef.current], sideRef.current, trailingRef.current, endWgs, stem)
      m.getSource(SWITCH_LINES_SOURCE)?.setData(buildLinesGeoJSON(geom))
      m.getSource(SWITCH_FILL_SOURCE)?.setData(buildFillGeoJSON(geom))
    }

    m.on('mousemove', onMouseMove)
    return () => m.off('mousemove', onMouseMove)
  }, [phase, map, project.id, curved])

  // ── Click to select element (select phase) ────────────────────────────────
  useEffect(() => {
    if (phase !== 'select' || !map?.current) return
    const m = map.current

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })
      if (!features.length) return

      const { trackId, elementIndex } = features[0].properties
      const elIdx = Number(elementIndex)
      const tracks = loadTracks(project.id)
      const track  = tracks.find(tr => tr.id === trackId)
      const el     = track?.elements?.[elIdx]
      if (!el) return

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
      setMainField('type',        TYPE_NAMES[track.trackType]   ?? 'station_track')
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
    }

    m.on('click', onClick)
    return () => m.off('click', onClick)
  }, [phase, map, project.id, setField, setMainField, curved])

  // ── Update preview when options change (editing phase) ───────────────────
  useEffect(() => {
    if (phase !== 'editing' || !map?.current || !startWgsRef.current) return
    const m    = map.current
    const geom = computeSwitchGeometryUtm(startUtmRef.current, bearingRef.current, SWITCH_TYPES[switchTypeIdx], side, trailing, startWgsRef.current, stemSigned)
    m.getSource(SWITCH_LINES_SOURCE)?.setData(buildLinesGeoJSON(geom))
    m.getSource(SWITCH_FILL_SOURCE)?.setData(buildFillGeoJSON(geom))
  }, [phase, switchTypeIdx, side, trailing, stemSigned, map])

  const handleSwitchTypeChange = (idx) => {
    setSwitchTypeIdx(idx)
    setSpeed(SWITCH_TYPES[idx].speed)
  }

  const clearPreview = () => {
    if (!map?.current) return
    map.current.getSource(SWITCH_LINES_SOURCE)?.setData(EMPTY_FC)
    map.current.getSource(SWITCH_FILL_SOURCE)?.setData(EMPTY_FC)
  }

  const handleCancel = () => {
    clearPreview()
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

    const existingNames = new Set(loadTracks(project.id).map(t => t.name).filter(Boolean))
    let hasError = false
    if (name && (existingNames.has(name) || (!trailing && name === mainName))) {
      setNameError(true); hasError = true
    } else { setNameError(false) }
    if (!trailing && mainName && (existingNames.has(mainName) || mainName === name)) {
      setMainNameError(true); hasError = true
    } else { setMainNameError(false) }
    if (!switchNo.claim()) hasError = true
    if (hasError) return

    const sw          = SWITCH_TYPES[switchTypeIdx]
    const sourceTrack = sourceTrackRef.current
    if (!sourceTrack || !startWgsRef.current) return

    const geom = computeSwitchGeometryUtm(startUtmRef.current, bearingRef.current, sw, side, trailing, startWgsRef.current, stemSigned)
    const { straightCoords, arcCoords, fillCoords, labelCoords, lcsCoords, signedR, mainSignedR, startUtm, straightUtm, arcOriginUtm, curvedUtm } = geom

    // ── Compute element data from geometry ─────────────────────────────────
    // Each route is built as whatever it came out as: bent, the through route is
    // an arc on the stem radius, and the branch is the one that can be straight.
    const sv = mainSignedR
      ? computeCurvedValuesUtm(startUtm, straightUtm, mainSignedR)
      : computeStraightValuesUtm(startUtm, straightUtm)
    const cv = signedR
      ? computeCurvedValuesUtm(arcOriginUtm, curvedUtm, signedR)
      : computeStraightValuesUtm(arcOriginUtm, curvedUtm)
    // One turnout, one cant. The through route of a trailing switch is built
    // against the direction the branch leaves the toe in, and cant is stored by
    // the raised rail, so it turns with the direction.
    const mainCant = trailing ? -cant : cant

    const straightEl = {
      elementType:  mainSignedR ? 1 : 0,
      startNode:    sv.startNode,
      endNode:      sv.endNode,
      bearing:      sv.bearing,
      length:       sv.length,
      absLength:    sv.length,
      switchBranch: true,
      switchRoute:  'main',
      switchName,
      switchLabel:  sw.label,
      ...(mainSignedR ? { endBearing: sv.endBearing, radius: mainSignedR, cant: mainCant } : {}),
      geometry:     { type: 'LineString', coordinates: straightCoords },
    }
    const curvedEl = {
      elementType:  signedR ? 1 : 0,
      startNode:    cv.startNode,
      endNode:      cv.endNode,
      bearing:      cv.bearing,
      length:       cv.length,
      absLength:    cv.length,
      switchBranch: true,
      switchRoute:  'branch',
      switchName,
      switchLabel:  sw.label,
      ...(signedR ? { endBearing: cv.endBearing, radius: signedR } : {}),
      cant,
      geometry:     { type: 'LineString', coordinates: arcCoords },
    }

    // ── Curved (diverging) branch track ────────────────────────────────────
    const curvedId    = generateId()
    const curvedTrack = {
      id:          curvedId,
      name,
      owner:       fields.owner,
      ...buildTypeFields(fields),
      epsg:     cv.epsg,
      coordinates: arcCoords,
      elements:    [curvedEl],
    }

    let portA_trackId, portB2_trackId

    if (trailing) {
      // Trailing: straight extends the source track
      addElementToTrack(project.id, selectedTrackIdRef.current, straightEl)
      portA_trackId  = null // portA track created later
      portB2_trackId = selectedTrackIdRef.current
    } else {
      // Facing: straight is a new independent track inheriting source metadata
      const straightId    = generateId()
      const straightTrack = {
        id:          straightId,
        name:        mainName,
        owner:       mainFields.owner,
        ...buildTypeFields(mainFields),
        epsg:     sv.epsg,
        coordinates: straightCoords,
        elements:    [straightEl],
      }
      saveTrack(project.id, straightTrack)
      portA_trackId  = sourceTrack.id
      portB2_trackId = straightId
    }

    saveTrack(project.id, curvedTrack)

    saveSwitch(project.id, {
      number:         switchNo.number,
      name:           switchName,
      label:          sw.label,
      trailing,
      speed,
      // Stem radius of a bent switch, signed away from the node — the frame the
      // symbol is rebuilt in. Absent means the through route is straight.
      ...(geom.stemAtToe ? { mainRadius: geom.stemAtToe } : {}),
      // Node position: the toe (facing) resp. the far end of the appended
      // straight (trailing). The source track ends there; both new branch
      // tracks start there.
      portA_trackId,
      portA_endpoint:  trailing ? null : 'END',
      portB1_trackId: curvedId,
      portB1_endpoint: 'BEGIN',
      portB2_trackId,
      portB2_endpoint: trailing ? 'END' : 'BEGIN',
      fillCoords,
      labelCoords,
      bauform: geom.bauform,
      lcsCoords,
    })

    resetName()
    resetMainName()
    setNameError(false)
    switchNo.reset()
    onTrackSaved?.()
    clearPreview()
    onCommitted?.()
  }

  const arcLen  = switchArcLength(currentSw.R, currentSw.ratio)
  // Deficiency per route. Bent, the two share one cant that only one of them is
  // banked for, so the sign of the cant is read against each rather than dropped.
  const cantDef = curved ? computeCantDefSigned(speed, branchSignedR, cant)
    : computeCantDef(speed, currentSw.R, cant)
  const stemDef = curved ? computeCantDefSigned(speed, stemAtToe, cant) : null
  const cantErr = Math.abs(cant) > MAX_CANT
  const defErr  = cantDef > MAX_SWITCH_CANT_DEF || (stemDef ?? 0) > MAX_SWITCH_CANT_DEF

  return (
    <>
      <div className="toggle-switch-wrap">
        <span style={{ color: !trailing ? 'var(--color-primary)' : '#aaa', fontWeight: !trailing ? 600 : 400 }}>
          {t('switch_facing')}
        </span>
        <label className="toggle-switch">
          <input type="checkbox" checked={trailing} onChange={e => setTrailing(e.target.checked)} />
          <span className="toggle-slider" />
        </label>
        <span style={{ color: trailing ? 'var(--color-primary)' : '#aaa', fontWeight: trailing ? 600 : 400 }}>
          {t('switch_trailing')}
        </span>
      </div>

      <div className="element-form">
        <span className="create-element-section">Geometry Data</span>
        <div className="form-field">
          <label>{t('switch_form')}</label>
          <select value={switchTypeIdx} onChange={e => handleSwitchTypeChange(Number(e.target.value))}>
            {SWITCH_TYPES.map((sw, i) => (
              <option key={i} value={i}>{sw.label}</option>
            ))}
          </select>
        </div>
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
            <div className="form-field">
              <label>{t('switch_bauform')}</label>
              <input type="text" readOnly value={t(`switch_bauform_${bauform(stemAtToe, branchSignedR)}`)} />
            </div>
          </>
        )}
        <div className="form-field">
          <label>{t('field_speed')}</label>
          <input type="number" min="0" value={speed} onChange={e => setSpeed(Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label>{t('cant')}</label>
          <input type="number" min={-MAX_CANT} max={MAX_CANT} step={CANT_STEP} value={cant} onChange={e => setCant(roundCant(Math.max(-MAX_CANT, Math.min(MAX_CANT, Number(e.target.value) || 0))))} />
        </div>
        {curved && (
          <div className="form-field">
            <label>{t('switch_stem_cant_def')}</label>
            <input type="number" readOnly value={stemDef ?? 0} />
          </div>
        )}
        <div className="form-field">
          <label>{curved ? t('switch_branch_cant_def') : t('cant_def')}</label>
          <input type="number" readOnly value={cantDef} />
        </div>
        <div className="form-field">
          <label>{t('arc_length')}</label>
          <input type="text" readOnly value={`~${arcLen.toFixed(1)} m`} />
        </div>
        <div className="form-field">
          <label>{curved ? t('switch_branch_radius') : t('field_radius')}</label>
          <input type="text" readOnly value={
            !curved ? `${currentSw.R} m`
              : branchSignedR == null ? t('switch_branch_straight')
                : `${Math.round(branchSignedR)} m`
          } />
        </div>
        {/* Both tracks describe the same spot, so they share one height datum. */}
        <HeightDatumField t={t} value={fields.heightEpsg}
          onChange={v => { setField('heightEpsg', v); setMainField('heightEpsg', v) }} />
      </div>

      <div className="element-form">
        <span className="create-element-section">{t('switch_meta_data')}</span>
        <SwitchNumberField t={t} number={switchNo.number} onChange={switchNo.setNumber}
          name={switchNo.name} taken={switchNo.taken} />
      </div>

      {!trailing && (
        <div className="element-form">
          <span className="create-element-section">Meta Data (Main Track)</span>
          <TrackFields t={t} fields={mainFields} setField={setMainField} setErrors={setMainErrors} errors={mainErrors}
            name={mainName} onNameChange={(val) => { setMainName(val); setMainNameError(false) }} nameError={mainNameError} />
        </div>
      )}

      <div className="element-form">
        <span className="create-element-section">Meta Data (Divergent Track)</span>
        <TrackFields t={t} fields={fields} setField={setField} setErrors={setErrors} errors={errors}
          name={name} onNameChange={handleNameChange} nameError={nameError} />
      </div>

      {phase === 'select' && <p>{t(curved ? 'switch_curved_hint' : 'switch_hint')}</p>}

      {phase === 'editing' && (
        <>
          {cantErr && <p className="form-error">{t('cant_error')}</p>}
          {defErr  && <p className="form-error">{t('cant_def_error')}</p>}
          <button className="panel-btn panel-btn-full" style={{ marginTop: 8, opacity: (cantErr || defErr) ? 0.5 : 1 }} onClick={handleCommit} disabled={cantErr || defErr}>
            {t('btn_commit')}
          </button>
          <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={handleCancel}>
            {t('btn_cancel')}
          </button>
        </>
      )}
    </>
  )
}
