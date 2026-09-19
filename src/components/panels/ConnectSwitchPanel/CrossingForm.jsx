import { useEffect, useState } from 'react'
import {
  loadTracks, saveTrack, saveSwitch, addElementToTrack, generateId, recalcAbsLengths,
} from '../../../storage'
import {
  computeStraightValuesUtm, computeCurvedValuesUtm, resolveEndBearing, nodeUtm,
} from '../../../utils/elementUtils'
import { utmToWgs84 } from '../../../utils/coordinateUtils'
import { TYPE_NAMES, SIDE_NAMES, buildTypeFields } from '../../../utils/identifierUtils'
import {
  CROSSING_TYPES, crossingAngle, crossingEndDistance, computeCrossingGeometryUtm,
  utmEndStraight,
} from '../../../utils/switchUtils'
import { newSwitchFields, switchElementMark } from '../../../utils/switchModel'
import { switchEndAnchorRefusal } from '../../../utils/switchPlacement'
import { HIT_TOLERANCE } from '../../../utils/mapConstants'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import useTrackHover from '../../../hooks/useTrackHover'
import useSwitchNumber from '../../../hooks/useSwitchNumber'
import usePreviewLayers from '../../../hooks/usePreviewLayers'
import TrackFields from '../TrackFields'
import SwitchNumberField from './SwitchNumberField'
import HeightDatumField from '../HeightDatumField'
import {
  SWITCH_LINES_SOURCE, SWITCH_FILL_SOURCE, SWITCH_PREVIEW_LAYERS,
  EMPTY_FC,
} from './switchPreview'

/**
 * A crossing or crossing switch (AP 3.2), connected to the end of an existing
 * element: port A is the picked element's end node, the main route (A→C) runs
 * on its end bearing, and the crossing point lies the form's end distance ahead
 * of it. The cross route (B→D) leaves at the form's crossing angle, on the side
 * the field says.
 *
 * The main route's first leg is not a track of its own: it is appended to the
 * picked track as its last element, marked 'main', so the record's port A names
 * that track and the crossing is connected the way a turnout is — what hangs on
 * the port is the line the user picked, and deleting the crossing trims the leg
 * back off it (switchDelete). The other legs are committed as tracks of their
 * own, one straight element long, marked with their route ('main' at C, 'cross'
 * at B and D); the slip curves of an EKW/DKW are committed as tracks of their
 * own, one arc element each, marked 'slip1'/'slip2'. The record names the four
 * ports.
 */

/** The preview draws the same body the commit stores — legs, slips and ring. */
function previewFeatures(g) {
  const lines = [g.mainCoords, g.crossCoords]
  if (g.slip1Coords) lines.push(g.slip1Coords)
  if (g.slip2Coords) lines.push(g.slip2Coords)
  return {
    lines: { type: 'FeatureCollection', features: lines.map(coordinates => ({
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates },
    })) },
    fill: { type: 'FeatureCollection', features: [{
      type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [g.fillCoords] },
    }] },
  }
}

export default function CrossingForm({ t, map, project, onTrackSaved, onCommitted, initialKind = 'crossing' }) {
  const { fields, errors, setErrors, setField, lineNumberError } = useTrackFields()
  const [nameError, setNameError] = useState(false)
  // Why the last click was no place for a crossing (switchEndAnchorRefusal).
  const [pickError, setPickError] = useState(null)
  const [phase, setPhase]         = useState('select')
  const [anchor, setAnchor]      = useState(null)   // { trackId, epsg, startUtm, bearing, startWgs } — port A
  const [crossSide, setCrossSide] = useState('right')  // which side the cross route leaves on
  const [formIdx, setFormIdx]     = useState(() =>
    Math.max(0, CROSSING_TYPES.findIndex(f => f.kind === initialKind)))
  const switchNo = useSwitchNumber(project.id)

  const forms      = CROSSING_TYPES
  const form      = forms[formIdx]
  const alpha     = crossingAngle(form) * 180 / Math.PI
  const crossAngle = (crossSide === 'right' ? alpha : -alpha)

  useTrackHover(map, phase, 'select', project)
  usePreviewLayers(map, SWITCH_PREVIEW_LAYERS, { resetFilters: ['tracks-hover-layer'], resetCursor: true })

  // The geometry as it would be committed — derived, so preview and commit
  // cannot disagree. The crossing point lies the form's end distance ahead of
  // the anchored end, so port A is the picked element's end node exactly.
  const g = anchor
    ? computeCrossingGeometryUtm(
        utmEndStraight(anchor.startUtm, anchor.bearing, crossingEndDistance(form)),
        anchor.bearing, form, crossAngle, anchor.startWgs)
    : null

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
      const { trackId, elementIndex } = features[0]?.properties ?? {}
      const track = features.length ? loadTracks(project.id).find(tr => tr.id === trackId) : null
      const el    = track?.elements?.[Number(elementIndex)]
      // Only where one may actually go — the preview is the answer to "here?",
      // so it must not stand somewhere the commit would then refuse.
      if (!el || switchEndAnchorRefusal(track, Number(elementIndex))) {
        m.getSource(SWITCH_LINES_SOURCE)?.setData(EMPTY_FC)
        m.getSource(SWITCH_FILL_SOURCE)?.setData(EMPTY_FC)
        return
      }
      const endWgs = el.geometry.coordinates[el.geometry.coordinates.length - 1]
      const endUtm = nodeUtm(el.endNode, endWgs, track.epsg)
      const brg    = resolveEndBearing(el, track.epsg)
      const centre = utmEndStraight(endUtm, brg, crossingEndDistance(form))
      const gg     = computeCrossingGeometryUtm(centre, brg, form, crossAngle, endWgs)
      const pv     = previewFeatures(gg)
      m.getSource(SWITCH_LINES_SOURCE)?.setData(pv.lines)
      m.getSource(SWITCH_FILL_SOURCE)?.setData(pv.fill)
    }
    m.on('mousemove', onMouseMove)
    return () => m.off('mousemove', onMouseMove)
  }, [phase, map, project.id, form, crossAngle])

  // ── Click to pick the element the crossing connects to ────────────────────
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
      const track  = loadTracks(project.id).find(tr => tr.id === trackId)
      const el      = track?.elements?.[elIdx]
      if (!el) return
      const refusal = switchEndAnchorRefusal(track, elIdx)
      if (refusal) { setPickError(refusal); return }
      setPickError(null)

      const endWgs = el.geometry.coordinates[el.geometry.coordinates.length - 1]

      // The new legs inherit the picked track's metadata: the main route
      // continues its line over the crossing.
      setField('owner',       track.owner       ?? 'DB')
      setField('type',        TYPE_NAMES[track.trackType]   ?? 'line_track')
      setField('lineNumber',  track.lineNumber  ?? '')
      setField('lineName',    track.lineName    ?? '')
      setField('side',        SIDE_NAMES[track.side]        ?? 'sorting')
      setField('stationName', track.stationName ?? '')
      setField('uicStation',  track.uicStation  ?? '')
      setField('trackNumber', track.trackNumber ?? '')

      setAnchor({
        trackId,
        epsg:    track.epsg,
        startUtm: nodeUtm(el.endNode, endWgs, track.epsg),
        bearing:  resolveEndBearing(el, track.epsg),
        startWgs: endWgs,
      })
      setPhase('editing')
    }
    m.on('click', onClick)
    return () => m.off('click', onClick)
  }, [phase, map, project.id, setField])

  // ── Preview while editing ──────────────────────────────────────────────────
  useEffect(() => {
    const m = map?.current
    if (!m || phase !== 'editing') return
    if (!g) {
      m.getSource(SWITCH_LINES_SOURCE)?.setData(EMPTY_FC)
      m.getSource(SWITCH_FILL_SOURCE)?.setData(EMPTY_FC)
      return
    }
    const pv = previewFeatures(g)
    m.getSource(SWITCH_LINES_SOURCE)?.setData(pv.lines)
    m.getSource(SWITCH_FILL_SOURCE)?.setData(pv.fill)
  }, [phase, g, map])

  // The main route's continuation beyond the crossing point is the only new
  // track on the picked line — it carries the name.
  const mainGeometry = g ? { epsg: anchor.epsg, path: [g.portA_utm, g.portC_utm] } : null
  const { name, setName, reset: resetName } = useTrackName(project.id, fields, { geometry: mainGeometry, setField })

  const handleNameChange = (val) => { setName(val); setNameError(false) }

  const clearPreview = () => {
    if (!map?.current) return
    map.current.getSource(SWITCH_LINES_SOURCE)?.setData(EMPTY_FC)
    map.current.getSource(SWITCH_FILL_SOURCE)?.setData(EMPTY_FC)
  }

  const handleCancel = () => {
    clearPreview()
    setPickError(null)
    setPhase('select')
    setAnchor(null)
    onCommitted?.()
  }

  const handleCommit = () => {
    setErrors([])
    if (lineNumberError || !g || !anchor) return
    const existingNames = new Set(loadTracks(project.id).map(tr => tr.name).filter(Boolean))
    if (name && existingNames.has(name)) { setNameError(true); return }
    setNameError(false)
    if (!switchNo.claim()) return

    const identity = { ...newSwitchFields(form.kind), name: switchNo.name, label: form.label }

    // One straight element per leg, marked with its route. The legs are the
    // crossing's own body: A–C on the main bearing, B–D on the cross one.
    const leg = (fromUtm, toUtm, route, coords) => {
      const v = computeStraightValuesUtm(fromUtm, toUtm)
      return {
        elementType: 0,
        startNode: v.startNode, endNode: v.endNode,
        bearing: v.bearing, length: v.length, absLength: v.length,
        ...switchElementMark(identity, route),
        geometry: { type: 'LineString', coordinates: coords },
      }
    }
    // One arc element per slip curve, marked with its route.
    const slip = (fromUtm, toUtm, route, coords, signedR) => {
      const v = computeCurvedValuesUtm(fromUtm, toUtm, signedR)
      return {
        elementType: 1,
        startNode: v.startNode, endNode: v.endNode,
        bearing: v.bearing, endBearing: v.endBearing,
        length: v.length, absLength: v.length, radius: signedR,
        ...switchElementMark(identity, route),
        geometry: { type: 'LineString', coordinates: coords },
      }
    }

    // The legs run from the crossing point out to their ports, so the three new
    // ones join the appended first leg end to end there.
    const tracksOf = (els, coords, trackName = null) => ({
      id: generateId(), name: trackName, owner: fields.owner, ...buildTypeFields(fields),
      epsg: anchor.epsg, coordinates: coords, elements: recalcAbsLengths(els),
    })

    const centreWgs = utmToWgs84(g.centreUtm.easting, g.centreUtm.northing, anchor.epsg)

    // The main route's first leg is the picked track's own now: appended as its
    // last element, from port A to the crossing point, so the join at the port
    // is the joint the track already had.
    addElementToTrack(project.id, anchor.trackId,
      leg(anchor.startUtm, g.centreUtm, 'main', [anchor.startWgs, centreWgs]))

    const legC = tracksOf([leg(g.centreUtm, g.portC_utm, 'main', [centreWgs, g.portC_wgs])],
      [centreWgs, g.portC_wgs], name)
    const legB = tracksOf([leg(g.portB_utm, g.centreUtm, 'cross', [g.portB_wgs, centreWgs])],
      [g.portB_wgs, centreWgs])
    const legD = tracksOf([leg(g.centreUtm, g.portD_utm, 'cross', [centreWgs, g.portD_wgs])],
      [centreWgs, g.portD_wgs])
    const slipTracks = []
    if (g.slip1Coords) {
      slipTracks.push(tracksOf(
        [slip(g.portA_utm, g.portD_utm, 'slip1', g.slip1Coords, g.slip1Route.r1)],
        g.slip1Coords))
    }
    if (g.slip2Coords) {
      slipTracks.push(tracksOf(
        [slip(g.portB_utm, g.portC_utm, 'slip2', g.slip2Coords, g.slip2Route.r1)],
        g.slip2Coords))
    }

    for (const tr of [legC, legB, legD, ...slipTracks]) saveTrack(project.id, tr)

    saveSwitch(project.id, {
      ...identity,
      number: switchNo.number,
      // Port A names the track the crossing is connected to: its end node is
      // the port, and the appended leg is the switch's own element there.
      portA_trackId: anchor.trackId, portA_endpoint: 'END',
      portB_trackId: legB.id, portB_endpoint: 'END',
      portC_trackId: legC.id, portC_endpoint: 'BEGIN',
      portD_trackId: legD.id, portD_endpoint: 'BEGIN',
      fillCoords: g.fillCoords,
    })

    resetName()
    switchNo.reset()
    setNameError(false)
    onTrackSaved?.()
    clearPreview()
    onCommitted?.()
  }

  const endDistance = crossingEndDistance(form)

  if (phase === 'select') {
    return (
      <>
        <p>{t('crossing_hint_select')}</p>
        {pickError && <p className="form-error">{t(pickError)}</p>}
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
          <label>{t('crossing_form')}</label>
          <select value={formIdx} onChange={e => setFormIdx(Number(e.target.value))}>
            {forms.map((f, i) => <option key={i} value={i}>{f.label}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>{t('crossing_side')}</label>
          <select value={crossSide} onChange={e => setCrossSide(e.target.value)}>
            <option value="right">{t('switch_side_right')}</option>
            <option value="left">{t('switch_side_left')}</option>
          </select>
        </div>
        <div className="form-field">
          <label>{t('bearing')}</label>
          <input type="text" readOnly value={anchor.bearing.toFixed(3)} />
        </div>
        <div className="form-field">
          <label>{t('crossing_angle')}</label>
          <input type="text" readOnly value={`1:${form.ratio} (${alpha.toFixed(2)}°)`} />
        </div>
        <div className="form-field">
          <label>{t('crossing_end_distance')}</label>
          <input type="text" readOnly value={`${endDistance.toFixed(2)} m`} />
        </div>
        {form.R != null && (
          <div className="form-field">
            <label>{t('field_radius')}</label>
            <input type="text" readOnly value={`${form.R} m`} />
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
        <span className="create-element-section">Meta Data</span>
        <TrackFields t={t} fields={fields} setField={setField} setErrors={setErrors} errors={errors}
          name={name} onNameChange={handleNameChange} nameError={nameError} />
      </div>

      {errors.length > 0 && (
        <p className="form-error">
          <span className="form-error-required">{t('error_required')}</span>: {errors.join(', ')}
        </p>
      )}
      {nameError && <p className="form-error">{t('track_name_exists')}</p>}

      <button className="panel-btn panel-btn-full" onClick={handleCommit}>
        {t('btn_commit')}
      </button>
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={handleCancel}>
        {t('btn_cancel')}
      </button>
    </>
  )
}
