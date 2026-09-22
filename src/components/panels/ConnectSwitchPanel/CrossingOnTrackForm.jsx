import { useEffect, useMemo, useState } from 'react'
import {
  loadTracks, commitSwitchConnection, generateId, recalcAbsLengths,
} from '../../../storage'
import { wgs84ToUTM } from '../../../utils/coordinateUtils'
import { splitElementAt, splitTrackAtJoint, carveSwitchRoute } from '../../../utils/trackSplitUtils'
import {
  CROSSING_TYPES, crossingAngle, crossingEndDistance, crossingLegRadius, crossingLegSignedRadius,
  crossingLegFitsTrack, computeCrossingGeometryUtm, crossingElements,
} from '../../../utils/switchUtils'
import { newSwitchFields, switchElementMark } from '../../../utils/switchModel'
import { clickStation, placeSwitchOnTrack } from '../../../utils/switchPlacement'
import { trackLength } from '../../../utils/heightUtils'
import { buildTypeFields } from '../../../utils/identifierUtils'
import { HIT_TOLERANCE } from '../../../utils/mapConstants'
import { elementPath } from '../../../utils/lineLookup'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import useTrackHover from '../../../hooks/useTrackHover'
import useSwitchNumber from '../../../hooks/useSwitchNumber'
import usePreviewLayers from '../../../hooks/usePreviewLayers'
import TrackFields from '../TrackFields'
import SwitchNumberField from '../SwitchNumberField'
import HeightDatumField from '../HeightDatumField'
import {
  SWITCH_LINES_SOURCE, SWITCH_FILL_SOURCE, SWITCH_PREVIEW_LAYERS,
  EMPTY_FC, buildCrossingPreview,
} from '../switchPreview'

/**
 * A crossing or crossing switch laid INTO an existing track (AP 3.3) — the
 * crossing kinds' counterpart of SwitchOnTrackForm. The crossing point is where
 * the track was clicked; the main route (A→C) runs through the track, so it is
 * the track itself: parted at the crossing point, its halves carry the legs out
 * to ports A and C as their own carved, marked elements — no new track on the
 * picked line, exactly as a turnout's through route stays in its host. The cross
 * route (B→D) is new: two tracks of their own through the crossing point, at
 * the form's crossing angle on the side the field says. The connecting routes
 * of a crossing switch are committed as tracks of their own, one element each,
 * marked 'slip1'/'slip2' — the same shape the end-anchored CrossingForm
 * commits (crossingElements), so everything that reads a crossing back (the
 * symbol, the deletion, the OSRD codec) reads this one the same way.
 *
 * The track under the body has to be the form's main leg, the end distance to
 * each side of the point: straight for the 3.2 forms, and for a
 * Bogenkreuzungsweiche (AP 3.4) an arc on its leg radius, curved away from the
 * cross route's side. The placement refuses anything else. placeSwitchOnTrack
 * does the walking — both halves of the main route are its through route, one
 * call each, with the branching left out that a turnout adds.
 */
export default function CrossingOnTrackForm({ t, map, project, onTrackSaved, onCommitted, initialKind = 'crossing' }) {
  const { fields, errors, setErrors, setField, lineNumberError } = useTrackFields()
  const [nameError, setNameError] = useState(false)
  const [phase, setPhase]         = useState('select')
  const [pick, setPick]           = useState(null)   // { trackId }
  const [station, setStation]     = useState('')     // crossing point along the track [m]
  const [crossSide, setCrossSide] = useState('right') // which side the cross route leaves on
  const [formIdx, setFormIdx]     = useState(() =>
    Math.max(0, CROSSING_TYPES.findIndex(f => f.kind === initialKind)))

  const forms = CROSSING_TYPES
  const form  = forms[formIdx]
  // The two classes the Ril keeps its forms in, as the two groups of the
  // picker: Regelformen (800.0120A01) first, Sonderbauformen (A02) after.
  const formOptionen = (klasse) => forms
    .map((f, i) => ({ f, i }))
    .filter(entry => entry.f.klasse === klasse)
    .map(({ f, i }) => <option key={i} value={i}>{f.label}</option>)

  const alpha = crossingAngle(form) * 180 / Math.PI
  const crossAngle = (crossSide === 'right' ? alpha : -alpha)
  const endDist = crossingEndDistance(form)

  // The designation names a crossing, not a switch — it follows the form's kind.
  const switchNo = useSwitchNumber(project.id, form.kind)

  useTrackHover(map, phase, 'select', project)
  usePreviewLayers(map, SWITCH_PREVIEW_LAYERS, { resetFilters: ['tracks-hover-layer'], resetCursor: true })

  // ── Pick a track and place the crossing point where it was clicked ────────
  useEffect(() => {
    if (phase !== 'select' || !map?.current) return
    const m = map.current
    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })
        .filter(f => !f.properties.switchBranch)
      if (!features.length) return
      const { trackId, elementIndex } = features[0].properties
      const elIdx = Number(elementIndex)
      const track = loadTracks(project.id).find(tr => tr.id === trackId)
      if (!track?.elements?.[elIdx]) return
      setErrors([])
      // The click is projected onto the element in the track's own plane and
      // stated as a station along the whole track — the crossing point.
      const clickUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], track.epsg)
      setPick({ trackId })
      setStation(String(Math.round(clickStation(track, elIdx, clickUtm) * 1000) / 1000))
      setPhase('editing')
    }
    m.on('click', onClick)
    return () => m.off('click', onClick)
  }, [phase, map, project.id, setErrors])

  // ── Derived geometry for the current settings ─────────────────────────────
  const track = pick ? loadTracks(project.id).find(tr => tr.id === pick.trackId) : null
  const pointStation = Number(station)

  // Where the crossing lies and the geometry it produces — derived, so the
  // preview and the commit always agree. Both halves of the main route are a
  // turnout's through route walked from the toe: one call ahead of the point,
  // one behind it, each the end distance long. Everything is read in the
  // track's own plane from the elements' stored nodes.
  const placement = useMemo(() => {
    if (!track || !Number.isFinite(pointStation)) return { error: null }
    if (pointStation < 0 || pointStation > trackLength(track)) {
      return { error: t('switch_on_track_outside') }
    }
    const noRoom = t('crossing_on_track_no_room').replace('{{m}}', endDist.toFixed(1))
    const ahead = placeSwitchOnTrack(track, pointStation, false, endDist)
    if (ahead.error) return { error: ahead.error === 'switch_on_track_no_room' ? noRoom : t(ahead.error) }
    const back = placeSwitchOnTrack(track, pointStation, true, endDist)
    if (back.error) return { error: back.error === 'switch_on_track_no_room' ? noRoom : t(back.error) }
    // The track under the body is its main leg, so it has to be one: straight,
    // or a Bogenkreuzungsweiche's arc — walked backwards, the same arc bends the
    // other way. Anything else would leave the geometry beside the line it
    // should be part of.
    const legR = crossingLegSignedRadius(form, crossAngle)
    if (!crossingLegFitsTrack(ahead.pieces, legR)
      || !crossingLegFitsTrack(back.pieces, legR == null ? null : -legR)) {
      return {
        error: legR == null
          ? t('crossing_on_track_straight_only')
          : t('crossing_on_track_leg_arc').replace('{{r}}', String(crossingLegRadius(form))),
      }
    }
    return {
      error: null, ahead, back,
      geom: computeCrossingGeometryUtm(ahead.toeUtm, ahead.bearing, form, crossAngle),
    }
  }, [track, pointStation, endDist, form, crossAngle, t])

  const placeError = placement.error
  const ahead      = placement.ahead ?? null
  const back       = placement.back ?? null
  const g          = placement.geom ?? null

  // The cross route is the only new line — its forward half carries the name.
  const crossGeometry = g ? elementPath(g.portB_utm, g.portD_utm) : null
  const { name, setName, reset: resetName } = useTrackName(project.id, fields, { geometry: crossGeometry, setField })

  const handleNameChange = (val) => { setName(val); setNameError(false) }

  // ── Preview while editing ──────────────────────────────────────────────────
  useEffect(() => {
    const m = map?.current
    if (!m || phase !== 'editing') return
    if (!g) {
      m.getSource(SWITCH_LINES_SOURCE)?.setData(EMPTY_FC)
      m.getSource(SWITCH_FILL_SOURCE)?.setData(EMPTY_FC)
      return
    }
    const pv = buildCrossingPreview(g)
    m.getSource(SWITCH_LINES_SOURCE)?.setData(pv.lines)
    m.getSource(SWITCH_FILL_SOURCE)?.setData(pv.fill)
  }, [phase, g, map])

  // What the crossing covers, element by element — both halves of the main route.
  const elementsText = ahead && back && track
    ? [...back.spans, ...ahead.spans].sort((a, b) => a.elIdx - b.elIdx).map(sp => {
      const el = track.elements[sp.elIdx]
      const kind = el.elementType === 2 ? 'table_type_transition' : el.radius ? 'table_type_arc' : 'table_type_straight'
      return `${t(kind)} ${sp.length.toFixed(2)} m`
    }).join(' · ')
    : '–'

  const clearPreview = () => {
    if (!map?.current) return
    map.current.getSource(SWITCH_LINES_SOURCE)?.setData(EMPTY_FC)
    map.current.getSource(SWITCH_FILL_SOURCE)?.setData(EMPTY_FC)
  }

  const handleCancel = () => { clearPreview(); setPhase('select'); setPick(null); onCommitted?.() }

  const handleCommit = () => {
    setErrors([])
    if (lineNumberError || !g || !ahead || !track || placeError) return
    const tracks = loadTracks(project.id)
    const existingNames = new Set(tracks.map(tr => tr.name).filter(Boolean))
    if (name && existingNames.has(name)) { setNameError(true); return }
    setNameError(false)
    if (!switchNo.claim()) return

    const identity = { ...newSwitchFields(form.kind), name: switchNo.name, label: form.label }
    const mainMark = switchElementMark(identity, 'main')

    // Part the host track at the crossing point — the main route runs through
    // it, on the joint it falls on or inside its element, as a turnout's toe
    // parts it.
    const split = ahead.joint != null
      ? splitTrackAtJoint(track, ahead.joint, ahead.bearing, existingNames)
      : splitElementAt(track, ahead.elIdx, ahead.toeUtm, ahead.bearing, existingNames)

    // The legs are the crossing's own body on the host line: the elements the
    // end distance reaches out to ports A and C, carved into the halves and
    // marked 'main' — the same carve that marks a turnout's through route.
    const carvedAhead  = carveSwitchRoute(split.ahead, split.aheadEndpoint, g.portC_utm, mainMark, endDist)
    const carvedBehind = carveSwitchRoute(split.behind, split.behindEndpoint, g.portA_utm, mainMark, endDist)
    if (!carvedAhead || !carvedBehind) {
      setErrors([t('crossing_on_track_no_room').replace('{{m}}', endDist.toFixed(1))])
      return
    }

    // One element per cross leg and per connecting route, marked with its route
    // — the same elements the end-anchored crossing commits. The main legs are
    // the host's own, carved above.
    const els = crossingElements(g, identity)
    const tracksOf = (el, trackName = null) => ({
      id: generateId(), name: trackName, owner: fields.owner, ...buildTypeFields(fields),
      epsg: track.epsg, coordinates: el.geometry.coordinates, elements: recalcAbsLengths([el]),
    })
    const legB = tracksOf(els.B)
    const legD = tracksOf(els.D, name)
    const slipTracks = [els.slip1, els.slip2].filter(Boolean).map(el => tracksOf(el))

    // The record keeps only the ports: the main route's name the parted halves
    // of the host track — port A the one behind the point, port C the one
    // ahead, each at the end that meets it — and the cross route's name its own
    // two halves. Both routes are read back from the marked elements.
    const switchRecord = {
      ...identity,
      number: switchNo.number,
      portA_trackId: carvedBehind.id, portA_endpoint: split.behindEndpoint,
      portB_trackId: legB.id, portB_endpoint: 'END',
      portC_trackId: carvedAhead.id, portC_endpoint: split.aheadEndpoint,
      portD_trackId: legD.id, portD_endpoint: 'BEGIN',
      fillCoords: g.fillCoords,
    }

    // One undo step for the whole crossing: the parted host track with its
    // carved legs, the cross legs, the slips and the record.
    commitSwitchConnection(project.id, {
      removeTrackIds: [track.id],
      addTracks: [...split.tracks.map(tr => (
        tr.id === carvedAhead.id ? carvedAhead : tr.id === carvedBehind.id ? carvedBehind : tr)),
        legB, legD, ...slipTracks],
      addSwitches: [switchRecord],
      remap: [{ oldId: track.id, newId: split.tracks.map(tr => tr.id) }],
    })

    resetName()
    switchNo.reset()
    setNameError(false)
    onTrackSaved?.()
    clearPreview()
    onCommitted?.()
  }

  if (phase === 'select') {
    return (
      <>
        <p>{t('crossing_on_track_hint')}</p>
        {errors.length > 0 && <p className="form-error">{errors.join(', ')}</p>}
        <button className="panel-btn panel-btn-full" style={{ marginTop: 8, background: '#888' }} onClick={handleCancel}>
          {t('btn_cancel')}
        </button>
      </>
    )
  }

  return (
    <>
      <div className="element-form">
        <span className="create-element-section">Geometry Data</span>
        <div className="form-field">
          <label>{t('crossing_on_track_station')}</label>
          <input type="number" step="0.001" min="0" max={track ? trackLength(track) : 0} value={station}
            onChange={e => setStation(e.target.value)} />
        </div>
        <div className="form-field">
          <label>{t('crossing_on_track_elements')}</label>
          <input type="text" readOnly value={elementsText} />
        </div>
        <div className="form-field">
          <label>{t('crossing_form')}</label>
          <select value={formIdx} onChange={e => setFormIdx(Number(e.target.value))}>
            <optgroup label={t('switch_form_regel')}>{formOptionen('regel')}</optgroup>
            <optgroup label={t('switch_form_sonder')}>{formOptionen('sonderbauform')}</optgroup>
          </select>
        </div>
        <div className="form-field">
          <label>{t('crossing_side')}</label>
          <select value={crossSide} onChange={e => setCrossSide(e.target.value)}>
            <option value="right">{t('switch_side_right')}</option>
            <option value="left">{t('switch_side_left')}</option>
          </select>
        </div>
        {ahead && (
          <div className="form-field">
            <label>{t('bearing')}</label>
            <input type="text" readOnly value={ahead.bearing.toFixed(3)} />
          </div>
        )}
        <div className="form-field">
          <label>{t('crossing_angle')}</label>
          <input type="text" readOnly value={`1:${form.ratio} (${alpha.toFixed(2)}°)`} />
        </div>
        <div className="form-field">
          <label>{t('crossing_end_distance')}</label>
          <input type="text" readOnly value={`${endDist.toFixed(2)} m`} />
        </div>
        {form.R != null && (
          <div className="form-field">
            <label>{t('field_radius')}</label>
            <input type="text" readOnly value={`${form.R} m`} />
          </div>
        )}
        {crossingLegRadius(form) != null && (
          <div className="form-field">
            <label>{t('crossing_leg_radius')}</label>
            <input type="text" readOnly value={`${crossingLegRadius(form)} m`} />
          </div>
        )}
        {form.Ri != null && (
          <div className="form-field">
            <label>{t('crossing_inner_radius')}</label>
            <input type="text" readOnly value={`${form.Ri} m`} />
          </div>
        )}
        <HeightDatumField t={t} value={fields.heightEpsg} onChange={v => setField('heightEpsg', v)} />
      </div>

      <div className="element-form">
        <span className="create-element-section">{t('switch_meta_data')}</span>
        <SwitchNumberField t={t} number={switchNo.number} onChange={switchNo.setNumber}
          name={switchNo.name} taken={switchNo.taken} />
      </div>

      <div className="element-form">
        <span className="create-element-section">Meta Data (Cross Route)</span>
        <TrackFields t={t} fields={fields} setField={setField} setErrors={setErrors} errors={errors}
          name={name} onNameChange={handleNameChange} nameError={nameError} />
      </div>

      {errors.length > 0 && (
        <p className="form-error">
          <span className="form-error-required">{t('error_required')}</span>: {errors.join(', ')}
        </p>
      )}
      {nameError && <p className="form-error">{t('track_name_exists')}</p>}
      {placeError && <p className="form-error">{placeError}</p>}

      <button className="panel-btn panel-btn-full" onClick={handleCommit} disabled={!!placeError}
        style={{ opacity: placeError ? 0.5 : 1 }}>
        {t('btn_commit')}
      </button>
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={handleCancel}>
        {t('btn_cancel')}
      </button>
    </>
  )
}
