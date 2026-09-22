import { useEffect, useMemo, useState } from 'react'
import {
  loadTracks, commitSwitchConnection, generateId, recalcAbsLengths,
} from '../../../storage'
import {
  computeCurvedValuesUtm, computeStraightValuesUtm,
} from '../../../utils/elementUtils'
import { wgs84ToUTM, utmToWgs84 } from '../../../utils/coordinateUtils'
import { splitElementAt, splitTrackAtJoint, carveSwitchRoute } from '../../../utils/trackSplitUtils'
import {
  SWITCH_PICK_TYPES, DEFAULT_SWITCH_TYPE_IDX, switchBranchLength, switchStraightLength, computeSwitchGeometryUtm, switchRouteVaries,
  piecesOnRadius,
} from '../../../utils/switchUtils'
import { elementBelongsToSwitch, newSwitchFields, switchElementMark } from '../../../utils/switchModel'
import { placeSwitchOnTrack, clickStation } from '../../../utils/switchPlacement'
import { trackLength } from '../../../utils/heightUtils'
import { buildTypeFields } from '../../../utils/identifierUtils'
import {
  HIT_TOLERANCE, cantExceptionFields, computeSwitchCant, computeCantDef, computeCantDefSigned,
  switchCantError, worstCantOf, MAX_SWITCH_CANT_DEF,
} from '../../../utils/mapConstants'
import { elementPath } from '../../../utils/lineLookup'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import useTrackHover from '../../../hooks/useTrackHover'
import usePreviewLayers from '../../../hooks/usePreviewLayers'
import TrackFields from '../TrackFields'
import SwitchNumberField from '../SwitchNumberField'
import SwitchCantField from './SwitchCantField'
import SwitchFormField from './SwitchFormField'
import useSwitchNumber from '../../../hooks/useSwitchNumber'
import HeightDatumField from '../HeightDatumField'
import {
  SWITCH_LINES_SOURCE, SWITCH_FILL_SOURCE, SWITCH_PREVIEW_LAYERS,
  EMPTY_FC, buildLinesGeoJSON, buildFillGeoJSON,
} from '../switchPreview'

/** Track the toe must leave behind it, or the split would part off next to nothing [m]. */
const MIN_BEHIND = 0.5

// Display only — the stored values keep their full precision.
const fmtR    = (r) => (r == null ? '∞' : `${Math.round(r)} m`)
const fmtCant = (u) => String(Math.round(u))

/**
 * Radius of a route as a turnout states it: the one it keeps throughout, or
 * where it changes — along a clothoid, or from one element to the next — its
 * value at the toe and at the far end.
 */
function radiusText(segments, straightText) {
  const r0 = segments[0].r1
  if (segments.every(seg => seg.r1 === r0 && seg.r2 === r0)) {
    return r0 == null ? straightText : `${Math.round(r0)} m`
  }
  return `${fmtR(r0)} → ${fmtR(segments[segments.length - 1].r2)}`
}

/** Branch element from a piece of the branch with one radius (or none). */
function constantBranchElement(seg, cant) {
  const r  = seg.r1
  const bv = r
    ? computeCurvedValuesUtm(seg.startUtm, seg.endUtm, r)
    : computeStraightValuesUtm(seg.startUtm, seg.endUtm)
  return {
    elementType: r ? 1 : 0,
    startNode: bv.startNode, endNode: bv.endNode,
    bearing: bv.bearing,
    length: bv.length, absLength: bv.length,
    ...(r ? { endBearing: bv.endBearing, radius: r } : {}),
    cant,
  }
}

/**
 * Place a switch onto an existing track. The track is split at the switch toe,
 * so it becomes two half-tracks; the diverging branch is added as a new track.
 * No through-route track is created — the existing track *is* the through
 * route, and the elements it covers are marked as the turnout's through route.
 *
 * The turnout may reach over as many elements as its length needs, whatever
 * the track is made of under it — straights, arcs and clothoids (see
 * placeSwitchOnTrack). Wherever the stem is curved the switch is bent into it:
 * both routes take the stem's curvature on top of their own, at every station,
 * so the branch is built piece by piece where the stem's elements part — an arc
 * over an arc, a clothoid over a clothoid (switchBranchChain). One turnout sits
 * on one set of sleepers, so its cant is the track's own there too, and a
 * turnout on nothing but straights is the ordinary one, whose cant follows
 * speed and switch form.
 */
export default function SwitchOnTrackForm({ t, map, project, onTrackSaved, onCommitted }) {
  const { fields, errors, setErrors, setField, lineNumberError } = useTrackFields()
  const [phase, setPhase]           = useState('select')
  const [pick, setPick]             = useState(null)   // { trackId }
  const [station, setStation]       = useState('')     // toe position along the track [m]
  const [switchTypeIdx, setTypeIdx] = useState(DEFAULT_SWITCH_TYPE_IDX)
  const [side, setSide]             = useState('left')
  const [reversed, setReversed]     = useState(false)  // switch opens against the track direction
  const [speed, setSpeed]           = useState(SWITCH_PICK_TYPES[DEFAULT_SWITCH_TYPE_IDX].speed)
  // Cant follows speed/switch type unless the user overrode it for exactly that
  // combination — derived instead of set from an effect.
  const [cantEdit, setCantEdit]     = useState(null)   // { key, value }
  // Why this turnout may carry more than MAX_SWITCH_CANT. Laid into a canted
  // track the cant is not the dialog's to set, but the limit still is its to
  // keep — so the reason is asked for either way.
  const [cantReason, setCantReason] = useState('')
  const [nameError, setNameError]   = useState(false)
  const switchNo = useSwitchNumber(project.id)
  const switchName = switchNo.name

  useTrackHover(map, phase, 'select', project)
  usePreviewLayers(map, SWITCH_PREVIEW_LAYERS, { resetFilters: ['tracks-hover-layer'], resetCursor: true })

  // ── Pick a track and place the toe where it was clicked ──────────────────
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
      // stated as a station along the whole track, which the turnout is placed by.
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
  const sw    = SWITCH_PICK_TYPES[switchTypeIdx]
  const toeStation  = Number(station)
  const straightLen = switchStraightLength(sw)
  const arcLen      = switchBranchLength(sw)

  // Where the turnout lies and the geometry it produces — derived, so the
  // preview and the commit always agree. Everything is read in the track's own
  // plane from the elements' stored nodes; the WGS84 twin of the toe is derived
  // for the display and never converted back (the GK/DB_REF datum round trip is
  // not exact).
  const placement = useMemo(() => {
    if (!track || !Number.isFinite(toeStation)) return { error: null }
    const noRoom = t('switch_on_track_no_room').replace('{{m}}', straightLen.toFixed(1))
    const total  = trackLength(track)
    if (toeStation < 0 || toeStation > total) return { error: t('switch_on_track_outside') }
    if ((reversed ? total - toeStation : toeStation) <= MIN_BEHIND) return { error: noRoom }
    const place = placeSwitchOnTrack(track, toeStation, reversed, straightLen)
    if (place.error) return { error: place.error === 'switch_on_track_no_room' ? noRoom : t(place.error) }
    // A symmetrical turnout has no straight side: unbent, its through route is
    // the branch's mirror arc, so that is what the track it is carved from has
    // to be — on anything else the turnout would stand beside its own through
    // route. On it, it is the ordinary unbent form.
    if (sw.symmetric && !piecesOnRadius(place.pieces, side === 'left' ? sw.R : -sw.R)) {
      return { error: t('switch_on_track_symmetric').replace('{{r}}', String(sw.R)) }
    }
    // On nothing but straights the turnout is the ordinary, unbent one.
    const plain  = sw.symmetric || place.pieces.every(p => p.r1 == null && p.r2 == null)
    const toeWgs = utmToWgs84(place.toeUtm.easting, place.toeUtm.northing, track.epsg)
    return {
      error: null, place, plain,
      geom: computeSwitchGeometryUtm(place.toeUtm, place.bearing, sw, side, false, toeWgs,
        plain ? null : place.pieces),
    }
  }, [track, toeStation, reversed, straightLen, sw, side, t])

  const placeError = placement.error
  const place      = placement.place ?? null
  const plain      = placement.plain ?? true
  const g          = placement.geom ?? null
  const branchR    = g?.signedR ?? null

  // The branch as it will be saved: the line it lies on names it. A branch of
  // several pieces, or a clothoid, is looked up along its chord.
  const singleArc = !!g && g.branchSegments.length === 1 && !switchRouteVaries(g.branchSegments[0])
  const branchGeometry = g ? elementPath(g.arcOriginUtm, g.curvedUtm, singleArc ? branchR : null) : null
  const { name, setName, reset: resetName } = useTrackName(project.id, fields, { geometry: branchGeometry, setField })

  // Cant. Unbent it follows speed and switch form unless the user overrode it
  // for that combination; bent it is the track's own under the turnout — this
  // is its value at the toe, and it may change along the turnout.
  const cantKey = `${speed}|${switchTypeIdx}`
  const cant = plain
    ? (cantEdit?.key === cantKey ? cantEdit.value : computeSwitchCant(speed, sw.R))
    : place.cantAt(0)
  const cantEnd    = plain ? cant : place.cantAt(straightLen)
  const cantVaries = !plain && place.spans.some(sp => sp.cantStart !== cant || sp.cantEnd !== cant)
  // What the switch limit has to answer for: the one value unbent, and bent the
  // worst of the ramp the turnout sits on — not just its value at the toe.
  const worstCant = plain ? Math.abs(cant)
    : place.spans.reduce((m, sp) => Math.max(m, Math.abs(sp.cantStart), Math.abs(sp.cantEnd)), 0)

  // Deficiency per route. Bent, the two routes share one cant that only one of
  // them is banked for, so the sign of the cant has to be read against each.
  // Radius and cant run linearly along each piece, and so does the deficiency
  // wherever the route keeps its side: the worst end of any piece is the route's.
  const worstDef = (segments) => Math.max(...segments.flatMap((seg, i) => [
    computeCantDefSigned(speed, seg.r1, place.cantAt(seg.s0, i)),
    computeCantDefSigned(speed, seg.r2, place.cantAt(seg.s0 + seg.length, i)),
  ]))
  const cantDef = plain ? computeCantDef(speed, sw.R, cant) : g ? worstDef(g.branchSegments) : 0
  const stemDef = plain || !g ? null : worstDef(g.stemSegments)

  // What the turnout covers, element by element.
  const elementsText = place && track
    ? place.spans.map(sp => {
      const el = track.elements[sp.elIdx]
      const kind = el.elementType === 2 ? 'table_type_transition' : el.radius ? 'table_type_arc' : 'table_type_straight'
      return `${t(kind)} ${sp.length.toFixed(2)} m`
    }).join(' · ')
    : '–'

  // ── Preview ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const m = map?.current
    if (!m) return
    const geom = placement.geom
    m.getSource(SWITCH_LINES_SOURCE)?.setData(geom ? buildLinesGeoJSON(geom) : EMPTY_FC)
    m.getSource(SWITCH_FILL_SOURCE)?.setData(geom ? buildFillGeoJSON(geom) : EMPTY_FC)
  }, [placement, map])

  const clearPreview = () => {
    if (!map?.current) return
    map.current.getSource(SWITCH_LINES_SOURCE)?.setData(EMPTY_FC)
    map.current.getSource(SWITCH_FILL_SOURCE)?.setData(EMPTY_FC)
  }

  const handleCancel = () => { clearPreview(); setPhase('select'); setPick(null); onCommitted?.() }

  const handleCommit = () => {
    setErrors([])
    if (lineNumberError || !g || !place || !track || placeError) return
    const tracks = loadTracks(project.id)
    const existingNames = new Set(tracks.map(tr => tr.name).filter(Boolean))

    if (name && existingNames.has(name)) { setNameError(true); return }
    setNameError(false)

    // Part the track at the toe (in the plane): on the joint it falls on, or
    // inside its element — an arc keeps its radius, a clothoid is cut at the
    // toe's station into two clothoids of its own parameter.
    const split = place.joint != null
      ? splitTrackAtJoint(track, place.joint, place.bearing, existingNames)
      : splitElementAt(track, place.elIdx,
        place.cutsClothoid ? { ...place.toeUtm, station: place.s } : place.toeUtm, place.bearing, existingNames)

    // The turnout's through route is the host track's own geometry, so it stays
    // in that track — as the elements it covers, the last one cut at the switch
    // end, all marked like the branch. A switch is its two routes everywhere it
    // is built.
    // The identity the record and the elements of both routes share: the id ties
    // them together, and it has to exist before the first element is marked.
    const identity = { ...newSwitchFields(), name: switchName, label: sw.label }
    const mainMark = switchElementMark(identity, 'main')
    const carved = carveSwitchRoute(split.ahead, split.aheadEndpoint, place.endUtm, mainMark, straightLen)
    if (!carved) {
      setErrors([t('switch_on_track_no_room').replace('{{m}}', straightLen.toFixed(1))])
      return
    }
    if (!switchNo.claim()) return
    // A cant over the plain switch limit stands on the reason typed for it, and
    // the reason belongs on the element that carries the cant — otherwise the
    // element table flags as an error what this dialog just accepted. Only the
    // elements over the limit get one: a stale reason on the rest would say a
    // turnout runs on an exception it does not need.
    const justify = (el) => ({ ...el, ...cantExceptionFields(worstCantOf(el), cantReason) })
    // The through route is the host track's own elements, carved and marked here.
    const carvedRoute = {
      ...carved,
      elements: carved.elements.map(el => (elementBelongsToSwitch(el, identity) ? justify(el) : el)),
    }
    const splitTracks = split.tracks.map(tr => (tr.id === carved.id ? carvedRoute : tr))

    // Diverging branch: the turnout's own branch as a new track, one element per
    // piece — where the elements under the turnout part, the branch parts too.
    // Each is built from its ends in the plane, so the first starts on the
    // junction node exactly and every joint is shared. Bent to the far side of
    // a curve a piece can come out straight — then it is one; over a clothoid
    // it is a clothoid, whose cant ramps with the track's.
    const branchId = generateId()
    const branchEls = recalcAbsLengths(g.branchSegments.map((seg, i) => {
      const base = switchRouteVaries(seg)
        ? {
            elementType: 2, transitionType: 'clothoid', r1: seg.r1, r2: seg.r2,
            startNode: [seg.startUtm.easting, seg.startUtm.northing],
            endNode:   [seg.endUtm.easting, seg.endUtm.northing],
            bearing: seg.bearing, endBearing: seg.endBearing,
            length: seg.length,
            cantStart: place.cantAt(seg.s0, i), cantEnd: place.cantAt(seg.s0 + seg.length, i),
          }
        : constantBranchElement(seg, plain ? cant : place.cantAt(seg.s0, i))
      return justify({
        ...base,
        ...switchElementMark(identity, 'branch'),
        geometry: { type: 'LineString', coordinates: seg.coords },
      })
    }))
    const branchTrack = {
      id: branchId,
      name,
      owner: fields.owner,
      ...buildTypeFields(fields),
      epsg: track.epsg,
      coordinates: g.arcCoords,
      elements: branchEls,
    }

    // The record keeps only the ports: both routes are read back from the
    // tracks' marked elements (switchRoutesFromTracks).
    const switchRecord = {
      ...identity,
      number: switchNo.number, trailing: false, speed,
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

  const cantErr = switchCantError(worstCant, cantReason)
  const defErr  = cantDef > MAX_SWITCH_CANT_DEF || (stemDef ?? 0) > MAX_SWITCH_CANT_DEF

  if (phase === 'select') {
    return (
      <>
        <p>{t('switch_on_track_hint')}</p>
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
          <input type="number" step="0.001" min="0" max={track ? trackLength(track) : 0} value={station}
            onChange={e => setStation(e.target.value)} />
        </div>
        <div className="form-field">
          <label>{t('switch_on_track_elements')}</label>
          <input type="text" readOnly value={elementsText} />
        </div>
        <SwitchFormField t={t} value={switchTypeIdx} onChange={i => {
          setTypeIdx(i); setSpeed(SWITCH_PICK_TYPES[i].speed)
        }} />
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
        <SwitchCantField t={t}
          label={cantVaries ? t('switch_cant_ramp') : t('cant')}
          cant={cant} onCant={value => setCantEdit({ key: cantKey, value })}
          readOnlyText={plain ? undefined
            : cantVaries ? `${fmtCant(cant)} → ${fmtCant(cantEnd)}` : fmtCant(cant)}
          magnitude={worstCant}
          reason={cantReason} onReason={setCantReason} />
        {!plain && g && (
          <>
            <div className="form-field">
              <label>{t('switch_stem_radius')}</label>
              <input type="text" readOnly value={radiusText(g.stemSegments, '–')} />
            </div>
            <div className="form-field">
              <label>{t('switch_bauform')}</label>
              <input type="text" readOnly value={t(`switch_bauform_${g.bauform}`)} />
            </div>
            <div className="form-field">
              <label>{t('switch_stem_cant_def')}</label>
              <input type="number" readOnly value={stemDef ?? 0} />
            </div>
          </>
        )}
        <div className="form-field">
          <label>{plain ? t('cant_def') : t('switch_branch_cant_def')}</label>
          <input type="number" readOnly value={cantDef} />
        </div>
        <div className="form-field">
          <label>{t('arc_length')}</label>
          <input type="text" readOnly value={`~${arcLen.toFixed(1)} m`} />
        </div>
        {!plain && g && (
          <div className="form-field">
            <label>{t('switch_branch_radius')}</label>
            <input type="text" readOnly value={radiusText(g.branchSegments, t('switch_branch_straight'))} />
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

      {cantVaries && <p className="selecting-hint">{t('switch_in_cant_ramp')}</p>}
      {errors.length > 0 && <p className="form-error">{errors.join(', ')}</p>}
      {placeError && <p className="form-error">{placeError}</p>}
      {cantErr && <p className="form-error">{t(`switch_cant_error_${cantErr}`)}</p>}
      {defErr  && <p className="form-error">{t('switch_cant_def_error')}</p>}

      <button className="panel-btn panel-btn-full" onClick={handleCommit}
        disabled={!!placeError || !!cantErr || defErr}
        style={{ opacity: (placeError || cantErr || defErr) ? 0.5 : 1 }}>
        {t('btn_commit')}
      </button>
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={handleCancel}>
        {t('btn_cancel')}
      </button>
    </>
  )
}
