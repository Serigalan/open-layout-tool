import { useEffect, useMemo, useState } from 'react'
import { loadTracks, commitSwitchConnection } from '../../../storage'
import { wgs84ToUTM } from '../../../utils/coordinateUtils'
import { SWITCH_PICK_TYPES, DEFAULT_SWITCH_TYPE_IDX, switchBranchLength, switchStraightLength } from '../../../utils/switch/catalogue'
import { switchRouteVaries } from '../../../utils/switch/route'
import { clickStation } from '../../../utils/switchPlacement'
import { trackLength } from '../../../utils/heightUtils'
import { computeSwitchCant, computeCantDef, computeCantDefSigned, switchCantError, MAX_SWITCH_CANT_DEF } from '../../../utils/rules/cant'
import { elementPath } from '../../../utils/lineLookup'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import TrackFields from '../TrackFields'
import SwitchNumberField from '../SwitchNumberField'
import SwitchCantField from './SwitchCantField'
import SwitchFormField from './SwitchFormField'
import useSwitchNumber from '../../../hooks/useSwitchNumber'
import HeightDatumField from '../HeightDatumField'
import { SWITCH_LINES_SOURCE, SWITCH_FILL_SOURCE, SWITCH_PREVIEW_LAYERS, buildLinesGeoJSON, buildFillGeoJSON } from '../../../map/switchPreview'
import { useI18n } from '../../../locales/i18nContext'
import { useMap } from '../../../map/MapContext'
import { useProject } from '../../../hooks/useStore'
import { TRACKS_HOVER_LAYER } from '../../../map/layerIds'
import usePreview from '../../../map/usePreview'
import useMapPick from '../../../map/useMapPick'
import { buildSwitchOnTrack, switchOnTrackPlacement } from '../../../utils/commands/switches'
import CommitBar from '../../form/CommitBar'
import DirectionToggle from '../../form/DirectionToggle'
import ReadOnlyField from '../../form/ReadOnlyField'
import FormSection from '../../form/FormSection'
import useFormPhase from '../../form/useFormPhase'
import CancelButton from '../../form/CancelButton'
import { firstReason } from '../../form/firstReason'
import MessageList from '../../form/MessageList'
import NumberInput from '../../form/NumberInput'
import { splitUnit } from '../../../locales/i18n'


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
export default function SwitchOnTrackForm({ onCommitted }) {
  const { t, fill } = useI18n()
  const map = useMap()
  const project = useProject()
  const { fields, errors, setErrors, setField, lineNumberError } = useTrackFields()
  const { phase, pick, begin, reset: resetPhase } = useFormPhase()   // pick: { trackId }
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

  const preview = usePreview(SWITCH_PREVIEW_LAYERS, { resetFilters: [TRACKS_HOVER_LAYER], resetCursor: true })

  // ── Pick a track and place the toe where it was clicked ──────────────────
  useMapPick({
    active: phase === 'select', hover: 'element', noSwitchBranch: true,
    onPick: ({ trackId, elementIndex }, e) => {
      const elIdx = elementIndex
      const track = loadTracks().find(tr => tr.id === trackId)
      if (!track?.elements?.[elIdx]) return
      setErrors([])
      // The click is projected onto the element in the track's own plane and
      // stated as a station along the whole track, which the turnout is placed by.
      const clickUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], track.epsg)
      begin({ trackId })
      setStation(String(Math.round(clickStation(track, elIdx, clickUtm) * 1000) / 1000))
    },
  })

  // ── Derived geometry for the current settings ─────────────────────────────
  const track = pick ? loadTracks().find(tr => tr.id === pick.trackId) : null
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
    const p = switchOnTrackPlacement({ track, toeStation, reversed, sw, side, straightLen })
    if (!p.error) return p
    const { key, params } = p.error
    return { error: key === 'switch_on_track_no_room' ? fill(key, { m: straightLen.toFixed(1) }) : fill(key, params ?? {}) }
  }, [track, toeStation, reversed, straightLen, sw, side, fill])

  const placeError = placement.error
  const place      = placement.place ?? null
  const plain      = placement.plain ?? true
  const g          = placement.geom ?? null
  const branchR    = g?.signedR ?? null
  // Bent so that its branch comes out straight, it is the plain form with its
  // routes swapped — the host track its branch, the new track its through route.
  const swapped    = g?.swapped ?? null

  // The new track as it will be saved: the line it lies on names it. A branch
  // of several pieces, or a clothoid, is looked up along its chord.
  const singleArc = !!g && g.branchSegments.length === 1 && !switchRouteVaries(g.branchSegments[0])
  const branchGeometry = swapped ? elementPath(swapped.startUtm, swapped.straightUtm, null)
    : g ? elementPath(g.arcOriginUtm, g.curvedUtm, singleArc ? branchR : null) : null
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
  // Swapped, the host track is the branch and the straight the through route.
  const [stemRoute, branchRoute] = swapped ? [g.branchSegments, g.stemSegments] : [g?.stemSegments, g?.branchSegments]
  const cantDef = plain ? computeCantDef(speed, sw.R, cant) : g ? worstDef(branchRoute) : 0
  const stemDef = plain || !g ? null : worstDef(stemRoute)

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
    const geom = placement.geom?.swapped ?? placement.geom
    preview.set(SWITCH_LINES_SOURCE, geom ? buildLinesGeoJSON(geom) : null)
    preview.set(SWITCH_FILL_SOURCE, geom ? buildFillGeoJSON(geom) : null)
  }, [placement, map, preview])


  const handleCancel = () => { preview.clear(); resetPhase(); onCommitted?.() }

  const handleCommit = () => {
    setErrors([])
    if (lineNumberError || !g || !place || !track || placeError) return
    const tracks = loadTracks()
    const existingNames = new Set(tracks.map(tr => tr.name).filter(Boolean))

    if (name && existingNames.has(name)) { setNameError(true); return }
    setNameError(false)

    const commit = buildSwitchOnTrack({
      track, tracks, place, g, plain, sw, straightLen, cant, cantReason, speed,
      switchName, switchNumber: switchNo.number, name, fields,
    })
    if (commit.noRoom) {
      setErrors([fill('switch_on_track_no_room', { m: commit.noRoom.toFixed(1) })])
      return
    }
    if (!switchNo.claim()) return
    commitSwitchConnection(commit)

    resetName()
    switchNo.reset()
    preview.clear()
    onCommitted?.()
  }

  const cantErr = switchCantError(worstCant, cantReason)
  const defErr  = cantDef > MAX_SWITCH_CANT_DEF || (stemDef ?? 0) > MAX_SWITCH_CANT_DEF

  if (phase === 'select') {
    return (
      <>
        <p>{t('switch_on_track_hint')}</p>
        <MessageList items={errors} className="form-error-list" small={false} />
        <CancelButton className="panel-btn panel-btn-full mt-8 secondary" onClick={handleCancel} />
      </>
    )
  }

  return (
    <>
      <DirectionToggle value={reversed} onChange={setReversed} left={t('switch_on_track_along')} right={t('switch_on_track_against')} />

      <FormSection title={t('section_geometry')}>
        <div className="form-field">
          <label>{splitUnit(t('switch_on_track_station')).text}</label>
          <NumberInput step="0.001" min="0" max={track ? trackLength(track) : 0} value={station}
            onChange={e => setStation(e.target.value)} unit="m" />
        </div>
        <ReadOnlyField label={t('switch_on_track_elements')} value={elementsText} />
        <SwitchFormField value={switchTypeIdx} onChange={i => {
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
          <label>{splitUnit(t('field_speed')).text}</label>
          <NumberInput min="0" value={speed} onChange={e => setSpeed(Number(e.target.value))} unit="km/h" />
        </div>
        <SwitchCantField
          label={cantVaries ? t('switch_cant_ramp') : t('cant')}
          cant={cant} onCant={value => setCantEdit({ key: cantKey, value })}
          readOnlyText={plain ? undefined
            : cantVaries ? `${fmtCant(cant)} → ${fmtCant(cantEnd)}` : fmtCant(cant)}
          magnitude={worstCant}
          reason={cantReason} onReason={setCantReason} />
        {!plain && g && (
          <>
            <ReadOnlyField label={t('switch_stem_radius')} value={radiusText(stemRoute, '–')} />
            <ReadOnlyField label={t('switch_bauform')} value={t(swapped ? 'switch_bauform_swapped' : `switch_bauform_${g.bauform}`)} />
            <ReadOnlyField type="number" label={t('switch_stem_cant_def')} value={stemDef ?? 0} />
          </>
        )}
        <ReadOnlyField type="number" label={plain ? t('cant_def') : t('switch_branch_cant_def')} value={cantDef} />
        <ReadOnlyField label={t('arc_length')} value={`~${arcLen.toFixed(1)} m`} />
        {!plain && g && (
          <ReadOnlyField label={t('switch_branch_radius')} value={radiusText(branchRoute, t('switch_branch_straight'))} />
        )}
        <HeightDatumField value={fields.heightEpsg} onChange={v => setField('heightEpsg', v)} />
      </FormSection>

      <FormSection title={t('switch_meta_data')}>
        <SwitchNumberField number={switchNo.number} onChange={switchNo.setNumber}
          name={switchNo.name} taken={switchNo.taken} />
      </FormSection>

      <FormSection title={t('section_meta_divergent')}>
        <TrackFields fields={fields} setField={setField} setErrors={setErrors} errors={errors}
          name={name} onNameChange={(v) => { setName(v); setNameError(false) }}
          nameError={nameError} />
      </FormSection>

      {cantVaries && <p className="selecting-hint">{t('switch_in_cant_ramp')}</p>}
      <MessageList items={errors} className="form-error-list" small={false} />
      {placeError && <p className="form-error">{placeError}</p>}
      {cantErr && <p className="form-error">{t(`switch_cant_error_${cantErr}`)}</p>}
      {defErr  && <p className="form-error">{t('switch_cant_def_error')}</p>}

      <CommitBar onCommit={handleCommit} onCancel={handleCancel} reason={firstReason(lineNumberError && t(`line_number_error_${lineNumberError}`), placeError, cantErr && t(`switch_cant_error_${cantErr}`), defErr && t('switch_cant_def_error'))} className="" />
    </>
  )
}
