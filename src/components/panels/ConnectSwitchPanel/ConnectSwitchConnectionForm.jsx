import { useEffect, useRef, useState } from 'react'
import {
  addElementToTrack, loadTracks, saveTrack, saveSwitch, generateId, withUndo,
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
import SwitchCantField from './SwitchCantField'
import useSwitchNumber from '../../../hooks/useSwitchNumber'
import HeightDatumField from '../HeightDatumField'
import {
  HIT_TOLERANCE, cantExceptionFields, computeSwitchCant, computeCantDef, switchCantError,
  MAX_SWITCH_CANT_DEF,
} from '../../../utils/mapConstants'
import { SWITCH_TYPES, switchBranchLength, computeSwitchGeometryUtm } from '../../../utils/switchUtils'
import { newSwitchFields, switchElementMark } from '../../../utils/switchModel'
import { switchEndAnchorRefusal } from '../../../utils/switchPlacement'
import {
  SWITCH_LINES_SOURCE, SWITCH_FILL_SOURCE, SWITCH_PREVIEW_LAYERS,
  EMPTY_FC, buildLinesGeoJSON, buildFillGeoJSON,
} from './switchPreview'

// ── ConnectSwitchConnectionForm ──────────────────────────────────────────────

const CONNECTION_SPEEDS   = [50, 60, 80, 100]
const SPEED_TO_TYPE_IDX   = { 50: 1, 60: 2, 80: 3, 100: 4 }

export default function ConnectSwitchConnectionForm({ t, map, project, onTrackSaved, onCommitted }) {
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
  const [speed, setSpeed]               = useState(60)
  const [side, setSide]                 = useState('left')
  const [trailing, setTrailing]         = useState(false)

  const switchTypeIdx = SPEED_TO_TYPE_IDX[speed] ?? 2
  // Follows speed and switch type unless the user overrode it for that pair.
  const [cant, setCant] = useDerivedField(`${speed}|${switchTypeIdx}`, computeSwitchCant(speed, SWITCH_TYPES[switchTypeIdx].R))
  // Why this turnout may carry more than MAX_SWITCH_CANT. Empty unless the user
  // pushed it there, and the commit stays blocked until it is written.
  const [cantReason, setCantReason] = useState('')

  // The tracks as they would be saved, each named by the line it lies on: the
  // branch always, the through route where it becomes a track of its own
  // (facing — trailing, it extends the picked track instead).
  const switchGeom = phase === 'editing' && anchor
    ? computeSwitchGeometryUtm(anchor.startUtm, anchor.bearing, SWITCH_TYPES[switchTypeIdx], side, trailing, anchor.startWgs)
    : null
  const branchGeometry = switchGeom
    ? elementPath(switchGeom.arcOriginUtm, switchGeom.curvedUtm, switchGeom.signedR) : null
  const mainGeometry = switchGeom && !trailing
    ? elementPath(switchGeom.startUtm, switchGeom.straightUtm) : null
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
      // Only where one may actually go — the preview is the answer to "here?",
      // so it must not stand somewhere the commit would then refuse.
      if (switchEndAnchorRefusal(track, Number(elementIndex))) {
        m.getSource(SWITCH_LINES_SOURCE)?.setData(EMPTY_FC)
        m.getSource(SWITCH_FILL_SOURCE)?.setData(EMPTY_FC)
        return
      }

      const endWgs = el.geometry.coordinates[el.geometry.coordinates.length - 1]
      const endUtm = nodeUtm(el.endNode, endWgs, track.epsg)
      const brg    = resolveEndBearing(el, track.epsg)
      const geom   = computeSwitchGeometryUtm(endUtm, brg, SWITCH_TYPES[switchTypeIdxRef.current], sideRef.current, trailingRef.current, endWgs)
      m.getSource(SWITCH_LINES_SOURCE)?.setData(buildLinesGeoJSON(geom))
      m.getSource(SWITCH_FILL_SOURCE)?.setData(buildFillGeoJSON(geom))
    }

    m.on('mousemove', onMouseMove)
    return () => m.off('mousemove', onMouseMove)
  }, [phase, map, project.id])

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
      const refusal = switchEndAnchorRefusal(track, elIdx)
      if (refusal) { setPickError(refusal); return }
      setPickError(null)

      const endWgs = el.geometry.coordinates[el.geometry.coordinates.length - 1]
      const brg    = resolveEndBearing(el, track.epsg)

      startWgsRef.current        = endWgs
      startUtmRef.current        = nodeUtm(el.endNode, endWgs, track.epsg)
      bearingRef.current         = brg
      sourceTrackRef.current     = track
      selectedTrackIdRef.current = trackId
      selectedElIdxRef.current   = elIdx
      setAnchor({ startUtm: startUtmRef.current, bearing: brg, startWgs: endWgs })

      setMainField('owner',       track.owner       ?? 'DB')
      setMainField('type',        TYPE_NAMES[track.trackType]   ?? 'station_track')
      setMainField('lineNumber',  track.lineNumber  ?? '')
      setMainField('lineName',    track.lineName    ?? '')
      setMainField('side',        SIDE_NAMES[track.side]        ?? 'sorting')
      setMainField('stationName', track.stationName ?? '')
      setMainField('uicStation',  track.uicStation  ?? '')
      setMainField('trackNumber', track.trackNumber ?? '')

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
  }, [phase, map, project.id, setField, setMainField])

  // ── Update preview when options change (editing phase) ───────────────────
  useEffect(() => {
    if (phase !== 'editing' || !map?.current || !startWgsRef.current) return
    const m    = map.current
    const geom = computeSwitchGeometryUtm(startUtmRef.current, bearingRef.current, SWITCH_TYPES[switchTypeIdx], side, trailing, startWgsRef.current)
    m.getSource(SWITCH_LINES_SOURCE)?.setData(buildLinesGeoJSON(geom))
    m.getSource(SWITCH_FILL_SOURCE)?.setData(buildFillGeoJSON(geom))
  }, [phase, switchTypeIdx, side, trailing, map])

  const clearPreview = () => {
    if (!map?.current) return
    map.current.getSource(SWITCH_LINES_SOURCE)?.setData(EMPTY_FC)
    map.current.getSource(SWITCH_FILL_SOURCE)?.setData(EMPTY_FC)
  }

  const handleCancel = () => {
    clearPreview()
    setPickError(null)
    setPhase('select')
    onCommitted?.()
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

    const geom = computeSwitchGeometryUtm(startUtmRef.current, bearingRef.current, sw, side, trailing, startWgsRef.current)
    const { straightCoords, arcCoords, fillCoords, labelCoords, lcsCoords, signedR, startUtm, straightUtm, arcOriginUtm, curvedUtm } = geom

    const sv = computeStraightValuesUtm(startUtm, straightUtm)
    const cv = computeCurvedValuesUtm(arcOriginUtm, curvedUtm, signedR)

    // The identity the record and the elements of both routes share: the id ties
    // them together, and it has to exist before the first element is marked.
    const identity = { ...newSwitchFields(), name: switchName, label: sw.label }

    const straightEl = {
      elementType:  0,
      startNode:    sv.startNode,
      endNode:      sv.endNode,
      bearing:      sv.bearing,
      length:       sv.length,
      absLength:    sv.length,
      ...switchElementMark(identity, 'main'),
      geometry:     { type: 'LineString', coordinates: straightCoords },
    }
    const curvedEl = {
      elementType:  1,
      startNode:    cv.startNode,
      endNode:      cv.endNode,
      bearing:      cv.bearing,
      length:       cv.length,
      absLength:    cv.length,
      ...switchElementMark(identity, 'branch'),
      endBearing:   cv.endBearing,
      radius:       signedR,
      cant,
      ...cantExceptionFields(cant, cantReason),
      geometry:     { type: 'LineString', coordinates: arcCoords },
    }

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

    // One undo step for the whole switch: appended or new straight, branch
    // track and record together.
    withUndo(() => {
      let portA_trackId, portB2_trackId

      if (trailing) {
        addElementToTrack(project.id, selectedTrackIdRef.current, straightEl)
        portA_trackId  = null
        portB2_trackId = selectedTrackIdRef.current
      } else {
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
        ...identity,
        number:         switchNo.number,
        trailing,
        speed,
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
    })

    resetName()
    resetMainName()
    setNameError(false)
    switchNo.reset()
    onTrackSaved?.()
    clearPreview()
    onCommitted?.()
  }

  const currentSw = SWITCH_TYPES[switchTypeIdx]
  const arcLen    = switchBranchLength(currentSw)

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
          <label>{t('field_speed')}</label>
          <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
            {CONNECTION_SPEEDS.map(s => (
              <option key={s} value={s}>{s} km/h</option>
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
        <SwitchCantField t={t} cant={cant} onCant={setCant}
          reason={cantReason} onReason={setCantReason} />
        <div className="form-field">
          <label>{t('cant_def')}</label>
          <input type="number" readOnly value={computeCantDef(speed, SWITCH_TYPES[switchTypeIdx].R, cant)} />
        </div>
        <div className="form-field">
          <label>{t('arc_length')}</label>
          <input type="text" readOnly value={`~${arcLen.toFixed(1)} m`} />
        </div>
        <div className="form-field">
          <label>{t('field_radius')}</label>
          <input type="text" readOnly value={`${currentSw.R} m`} />
        </div>
        <div className="form-field">
          <label>{t('switch_form')}</label>
          <input type="text" readOnly value={currentSw.label} />
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
          name={name} onNameChange={(val) => { setName(val); setNameError(false) }} nameError={nameError} />
      </div>

      {phase === 'select' && (
        <>
          <p>{t('switch_hint')}</p>
          {pickError && <p className="form-error">{t(pickError)}</p>}
        </>
      )}

      {phase === 'editing' && (() => {
        const cantDef = computeCantDef(speed, SWITCH_TYPES[switchTypeIdx].R, cant)
        const cantErr = switchCantError(cant, cantReason)
        const defErr  = cantDef > MAX_SWITCH_CANT_DEF
        return (
          <>
            {cantErr && <p className="form-error">{t(`switch_cant_error_${cantErr}`)}</p>}
            {defErr  && <p className="form-error">{t('switch_cant_def_error')}</p>}
            <button className="panel-btn panel-btn-full" style={{ marginTop: 8, opacity: (cantErr || defErr) ? 0.5 : 1 }} onClick={handleCommit} disabled={!!cantErr || defErr}>
              {t('btn_commit')}
            </button>
            <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={handleCancel}>
              {t('btn_cancel')}
            </button>
          </>
        )
      })()}
    </>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────
