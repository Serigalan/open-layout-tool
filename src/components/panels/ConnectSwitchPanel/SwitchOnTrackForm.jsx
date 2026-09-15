import { useEffect, useMemo, useState } from 'react'
import {
  loadTracks, commitSwitchConnection, generateId,
} from '../../../storage'
import {
  computeCurvedValuesUtm, computeStraightValuesUtm, projectOnArcUtm,
  endPointCurvedUtm, endPointStraightUtm, bearingAfterUtm, nodeUtm,
} from '../../../utils/elementUtils'
import { wgs84ToUTM, utmToWgs84 } from '../../../utils/coordinateUtils'
import { splitElementAt, carveSwitchRoute } from '../../../utils/trackSplitUtils'
import {
  SWITCH_TYPES, switchArcLength, switchStraightLength, computeSwitchGeometryUtm, asRadius, bauform,
} from '../../../utils/switchUtils'
import { buildTypeFields } from '../../../utils/identifierUtils'
import {
  HIT_TOLERANCE, computeSwitchCant, computeCantDef, computeCantDefSigned,
  roundCant, CANT_STEP, MAX_CANT, MAX_SWITCH_CANT_DEF,
} from '../../../utils/mapConstants'
import { elementPath } from '../../../utils/lineLookup'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import useTrackHover from '../../../hooks/useTrackHover'
import usePreviewLayers from '../../../hooks/usePreviewLayers'
import TrackFields from '../TrackFields'
import SwitchNumberField from './SwitchNumberField'
import useSwitchNumber from '../../../hooks/useSwitchNumber'
import HeightDatumField from '../HeightDatumField'
import {
  SWITCH_LINES_SOURCE, SWITCH_FILL_SOURCE, SWITCH_PREVIEW_LAYERS,
  EMPTY_FC, buildLinesGeoJSON, buildFillGeoJSON,
} from './switchPreview'

const isStraight = (el) => el && el.radius == null && el.elementType !== 2 && !el.switchBranch
const isArc      = (el) => el && el.radius != null && el.elementType !== 2 && !el.switchBranch

/**
 * Place a switch onto an existing track element. The element is split at the
 * switch toe, so it becomes two half-tracks; the diverging branch is added as a
 * new track. Unlike the plain switch form no through-route element is created —
 * the existing track *is* the through route, and the turnout symbol comes from
 * the switch record's fillCoords (same as the junction switches).
 *
 * With `curved` the host is an arc rather than a straight and the switch is
 * bent into it: the branch takes the arc's curvature on top of the form's (see
 * branchRadius) and can even come out straight. The stem radius is the host's,
 * so there is nothing to enter for it, and so is the cant — one turnout sits on
 * one set of sleepers, so its two routes cannot have two different ones.
 */
export default function SwitchOnTrackForm({ t, map, project, onTrackSaved, onCommitted, curved = false }) {
  const { fields, errors, setErrors, setField, lineNumberError } = useTrackFields()
  const [phase, setPhase]           = useState('select')
  const [pick, setPick]             = useState(null)   // { trackId, elIdx, startUtm, bearing, length, radius, cant }
  const [station, setStation]       = useState('')     // toe position along the element [m]
  const [switchTypeIdx, setTypeIdx] = useState(2)
  const [side, setSide]             = useState('left')
  const [reversed, setReversed]     = useState(false)  // switch opens against the track direction
  const [speed, setSpeed]           = useState(SWITCH_TYPES[2].speed)
  // Cant follows speed/switch type unless the user overrode it for exactly that
  // combination — derived instead of set from an effect.
  const [cantEdit, setCantEdit]     = useState(null)   // { key, value }
  const [nameError, setNameError]   = useState(false)
  const switchNo = useSwitchNumber(project.id)
  const switchName = switchNo.name

  useTrackHover(map, phase, 'select', project)
  usePreviewLayers(map, SWITCH_PREVIEW_LAYERS, { resetFilters: ['tracks-hover-layer'], resetCursor: true })

  // ── Pick an element and place the toe where it was clicked ────────────────
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
      const el    = track?.elements?.[elIdx]
      if (!(curved ? isArc(el) : isStraight(el))) {
        setErrors([t(curved ? 'switch_on_curve_arc_only' : 'switch_on_track_straight_only')])
        return
      }
      setErrors([])

      // The element's stored start node anchors everything in the track's own
      // plane; the click is projected onto the element from there.
      const startUtm = nodeUtm(el.startNode, el.geometry.coordinates[0], track.epsg)
      const hostR    = curved ? asRadius(el.radius) : null
      const { along } = projectOnArcUtm(
        startUtm, wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], track.epsg), el.bearing, hostR)
      setPick({
        trackId, elIdx, startUtm, bearing: el.bearing, length: el.length,
        radius: hostR, cant: el.cant ?? 0,
      })
      setStation(String(Math.round(Math.min(el.length, Math.max(0, along)) * 1000) / 1000))
      setPhase('editing')
    }
    m.on('click', onClick)
    return () => m.off('click', onClick)
  }, [phase, map, project.id, t, setErrors, curved])

  // ── Derived geometry for the current settings ─────────────────────────────
  const track = pick ? loadTracks(project.id).find(tr => tr.id === pick.trackId) : null
  const sw    = SWITCH_TYPES[switchTypeIdx]
  const along = Number(station)
  const hostR = pick?.radius ?? null
  const straightLen = switchStraightLength(sw.R, sw.ratio)

  // Toe position and the turnout geometry it produces — derived, so the preview
  // and the commit always agree. The toe is stepped along the element in the
  // track's own plane from the stored start node; its WGS84 twin is derived for
  // the display and never converted back (the GK/DB_REF datum round trip is not
  // exact). The switch needs the length `straightLen` ahead of the toe and must
  // leave something behind, otherwise the split is degenerate.
  const placement = useMemo(() => {
    if (!track || !pick || !Number.isFinite(along)) return { error: null }
    if (along < 0 || along > pick.length) return { error: t('switch_on_track_outside') }
    const ahead  = reversed ? along : pick.length - along
    const behind = reversed ? pick.length - along : along
    if (ahead < straightLen || behind <= 0.5) {
      return { error: t('switch_on_track_no_room').replace('{{m}}', straightLen.toFixed(1)) }
    }
    const toeUtm = hostR
      ? endPointCurvedUtm(pick.startUtm, pick.bearing, along, hostR)
      : endPointStraightUtm(pick.startUtm, pick.bearing, along)
    const tangent       = bearingAfterUtm(pick.bearing, along, hostR)
    const facingBearing = reversed ? (tangent + 180) % 360 : tangent
    // Stem radius in the direction the switch opens — reversing flips its sign.
    const stemR  = hostR == null ? null : (reversed ? -hostR : hostR)
    const toeWgs = utmToWgs84(toeUtm.easting, toeUtm.northing, track.epsg)
    return {
      error: null, toeUtm, facingBearing, stemR,
      geom: computeSwitchGeometryUtm(toeUtm, facingBearing, sw, side, false, toeWgs, stemR),
    }
  }, [track, pick, hostR, along, reversed, straightLen, sw, side, t])

  const placeError = placement.error
  const branchR    = placement.geom?.signedR ?? null
  const stemR      = placement.stemR ?? null

  // The branch as it will be saved: the line it lies on names it.
  const branchGeometry = placement.geom
    ? elementPath(placement.geom.arcOriginUtm, placement.geom.curvedUtm, branchR)
    : null
  const { name, setName, reset: resetName } = useTrackName(project.id, fields, { geometry: branchGeometry, setField })

  // On a bent switch there is one cant for the whole turnout, and it is the
  // host arc's: both routes lie on its sleepers. Off a curve it follows speed
  // and switch form unless the user overrode it for that combination.
  const hostCant = pick ? (reversed ? -(pick.cant ?? 0) : (pick.cant ?? 0)) : 0
  const cantKey  = `${speed}|${switchTypeIdx}`
  const cant = curved
    ? hostCant
    : cantEdit?.key === cantKey ? cantEdit.value : computeSwitchCant(speed, sw.R)

  // Deficiency per route. Bent, the two routes share one cant that only one of
  // them is banked for, so the sign of the cant has to be read against each.
  const cantDef = curved ? computeCantDefSigned(speed, branchR, cant) : computeCantDef(speed, sw.R, cant)
  const stemDef = curved ? computeCantDefSigned(speed, stemR, cant) : null

  // ── Preview ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const m = map?.current
    if (!m) return
    const g = placement.geom
    m.getSource(SWITCH_LINES_SOURCE)?.setData(g ? buildLinesGeoJSON(g) : EMPTY_FC)
    m.getSource(SWITCH_FILL_SOURCE)?.setData(g ? buildFillGeoJSON(g) : EMPTY_FC)
  }, [placement, map])

  const clearPreview = () => {
    if (!map?.current) return
    map.current.getSource(SWITCH_LINES_SOURCE)?.setData(EMPTY_FC)
    map.current.getSource(SWITCH_FILL_SOURCE)?.setData(EMPTY_FC)
  }

  const handleCancel = () => { clearPreview(); setPhase('select'); setPick(null); onCommitted?.() }

  const handleCommit = () => {
    setErrors([])
    if (lineNumberError || !placement.geom || !track || placeError) return
    const tracks = loadTracks(project.id)
    const existingNames = new Set(tracks.map(tr => tr.name).filter(Boolean))

    if (name && existingNames.has(name)) { setNameError(true); return }
    if (!switchNo.claim()) return
    setNameError(false)

    const { toeUtm, facingBearing, geom: g } = placement

    // Split the host element at the toe (in the plane); the halves keep the
    // source metadata, and an arc keeps its radius.
    const split = splitElementAt(track, pick.elIdx, toeUtm, facingBearing, existingNames)

    // The turnout's through route is the host track's own geometry, so it stays
    // in that track — but as an element of its own, of the form's length, marked
    // like the branch. A switch is two elements everywhere it is built.
    const mainMark = { switchBranch: true, switchRoute: 'main', switchName, switchLabel: sw.label }
    const carved = carveSwitchRoute(split.ahead, split.aheadEndpoint, g.straightUtm, mainMark)
    const splitTracks = carved
      ? split.tracks.map(tr => (tr.id === carved.id ? carved : tr))
      : split.tracks

    // Diverging branch: the turnout's own branch as a new track, built from its
    // ends in the plane so its start node is the junction node exactly. Bent to
    // the far side of a curve the branch can come out straight — then it is one.
    const bv = branchR
      ? computeCurvedValuesUtm(g.arcOriginUtm, g.curvedUtm, branchR)
      : computeStraightValuesUtm(g.arcOriginUtm, g.curvedUtm)
    const branchId = generateId()
    const branchTrack = {
      id: branchId,
      name,
      owner: fields.owner,
      ...buildTypeFields(fields),
      epsg: track.epsg,
      coordinates: g.arcCoords,
      elements: [{
        elementType: branchR ? 1 : 0,
        startNode: bv.startNode, endNode: bv.endNode,
        bearing: bv.bearing,
        length: bv.length, absLength: bv.length,
        switchBranch: true, switchRoute: 'branch', switchName, switchLabel: sw.label,
        ...(branchR ? { endBearing: bv.endBearing, radius: branchR } : {}),
        cant,
        geometry: { type: 'LineString', coordinates: g.arcCoords },
      }],
    }

    const switchRecord = {
      number: switchNo.number, name: switchName, label: sw.label, trailing: false, speed,
      ...(g.stemAtToe ? { mainRadius: g.stemAtToe } : {}),
      portA_trackId:  split.behind.id, portA_endpoint:  split.behindEndpoint,
      portB1_trackId: branchId,        portB1_endpoint: 'BEGIN',
      portB2_trackId: split.ahead.id,  portB2_endpoint: split.aheadEndpoint,
      fillCoords: g.fillCoords, lcsCoords: g.lcsCoords,
      labelCoords: g.labelCoords, bauform: g.bauform,
    }

    commitSwitchConnection(project.id, {
      removeTrackIds: [track.id],
      addTracks:      [...splitTracks, branchTrack],
      addSwitches:    [switchRecord],
      remap: [{ oldId: track.id, newId: splitTracks.map(tr => tr.id) }],
    })

    resetName()
    switchNo.reset()
    onTrackSaved?.()
    clearPreview()
    onCommitted?.()
  }

  const arcLen  = switchArcLength(sw.R, sw.ratio)
  const cantErr = Math.abs(cant) > MAX_CANT
  const defErr  = cantDef > MAX_SWITCH_CANT_DEF || (stemDef ?? 0) > MAX_SWITCH_CANT_DEF

  if (phase === 'select') {
    return (
      <>
        <p>{t(curved ? 'switch_on_curve_hint' : 'switch_on_track_hint')}</p>
        {errors.length > 0 && <p className="form-error">{errors.join(', ')}</p>}
        <button className="panel-btn panel-btn-full" style={{ marginTop: 8, background: '#888' }} onClick={handleCancel}>
          {t('btn_cancel')}
        </button>
      </>
    )
  }

  return (
    <>
      <div className="toggle-switch-wrap">
        <span style={{ color: !reversed ? 'var(--color-primary)' : '#aaa', fontWeight: !reversed ? 600 : 400 }}>
          {t('switch_on_track_along')}
        </span>
        <label className="toggle-switch">
          <input type="checkbox" checked={reversed} onChange={e => setReversed(e.target.checked)} />
          <span className="toggle-slider" />
        </label>
        <span style={{ color: reversed ? 'var(--color-primary)' : '#aaa', fontWeight: reversed ? 600 : 400 }}>
          {t('switch_on_track_against')}
        </span>
      </div>

      <div className="element-form">
        <span className="create-element-section">Geometry Data</span>
        <div className="form-field">
          <label>{t('switch_on_track_station')}</label>
          <input type="number" step="0.001" min="0" max={pick?.length ?? 0} value={station}
            onChange={e => setStation(e.target.value)} />
        </div>
        <div className="form-field">
          <label>{t('switch_form')}</label>
          <select value={switchTypeIdx} onChange={e => {
            const i = Number(e.target.value)
            setTypeIdx(i); setSpeed(SWITCH_TYPES[i].speed)
          }}>
            {SWITCH_TYPES.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>{t('switch_side')}</label>
          <select value={side} onChange={e => setSide(e.target.value)}>
            <option value="left">{t('switch_side_left')}</option>
            <option value="right">{t('switch_side_right')}</option>
          </select>
        </div>
        <div className="form-field">
          <label>{t('field_speed')}</label>
          <input type="number" min="0" value={speed} onChange={e => setSpeed(Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label>{t('cant')}</label>
          <input type="number" min={-MAX_CANT} max={MAX_CANT} step={CANT_STEP} value={cant}
            readOnly={curved}
            onChange={e => setCantEdit({ key: cantKey,
              value: roundCant(Math.max(-MAX_CANT, Math.min(MAX_CANT, Number(e.target.value) || 0))) })} />
        </div>
        {curved && (
          <>
            <div className="form-field">
              <label>{t('switch_stem_radius')}</label>
              <input type="text" readOnly value={stemR != null ? `${Math.round(stemR)} m` : '–'} />
            </div>
            <div className="form-field">
              <label>{t('switch_bauform')}</label>
              <input type="text" readOnly value={t(`switch_bauform_${bauform(stemR, branchR)}`)} />
            </div>
            <div className="form-field">
              <label>{t('switch_stem_cant_def')}</label>
              <input type="number" readOnly value={stemDef ?? 0} />
            </div>
          </>
        )}
        <div className="form-field">
          <label>{curved ? t('switch_branch_cant_def') : t('cant_def')}</label>
          <input type="number" readOnly value={cantDef} />
        </div>
        <div className="form-field">
          <label>{t('arc_length')}</label>
          <input type="text" readOnly value={`~${arcLen.toFixed(1)} m`} />
        </div>
        {curved && (
          <div className="form-field">
            <label>{t('switch_branch_radius')}</label>
            <input type="text" readOnly
              value={branchR != null ? `${Math.round(branchR)} m` : t('switch_branch_straight')} />
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
        <span className="create-element-section">Meta Data (Divergent Track)</span>
        <TrackFields t={t} fields={fields} setField={setField} setErrors={setErrors} errors={errors}
          name={name} onNameChange={(v) => { setName(v); setNameError(false) }}
          nameError={nameError} />
      </div>

      {placeError && <p className="form-error">{placeError}</p>}
      {cantErr && <p className="form-error">{t('cant_error')}</p>}
      {defErr  && <p className="form-error">{t('cant_def_error')}</p>}

      <button className="panel-btn panel-btn-full" onClick={handleCommit}
        disabled={!!placeError || cantErr || defErr}
        style={{ opacity: (placeError || cantErr || defErr) ? 0.5 : 1 }}>
        {t('btn_commit')}
      </button>
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={handleCancel}>
        {t('btn_cancel')}
      </button>
    </>
  )
}
