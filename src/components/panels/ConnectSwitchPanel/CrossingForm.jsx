import { useEffect, useState } from 'react'
import { loadTracks, commitSwitchConnection } from '../../../storage'
import { SIDE_NAMES } from '../../../utils/identifierUtils'
import { resolveEndBearing, nodeUtm } from '../../../utils/elementUtils'
import { trackTypeName } from '../../../utils/trackGroups'
import { CROSSING_TYPES } from '../../../utils/switch/catalogue'
import { crossingAngle, crossingEndDistance, crossingLegRadius, computeCrossingGeometryFromPortA } from '../../../utils/switch/crossing'
import { switchEndAnchorRefusal } from '../../../utils/switchPlacement'
import { pickAt } from '../../../map/pick'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import useSwitchNumber from '../../../hooks/useSwitchNumber'
import TrackFields from '../TrackFields'
import SwitchNumberField from '../SwitchNumberField'
import HeightDatumField from '../HeightDatumField'
import { SWITCH_LINES_SOURCE, SWITCH_FILL_SOURCE, SWITCH_PREVIEW_LAYERS, buildCrossingPreview } from '../../../map/switchPreview'
import { useI18n } from '../../../locales/i18nContext'
import { useMap } from '../../../map/MapContext'
import { useProject } from '../../../hooks/useStore'
import { TRACKS_HOVER_LAYER } from '../../../map/layerIds'
import usePreview from '../../../map/usePreview'
import useMapPick from '../../../map/useMapPick'
import useMapEvents from '../../../map/useMapEvents'
import { buildCrossingAtTrackEnd } from '../../../utils/commands/switches'
import CommitBar from '../../form/CommitBar'
import ReadOnlyField from '../../form/ReadOnlyField'
import FormSection from '../../form/FormSection'

/**
 * A crossing or crossing switch (AP 3.2), connected to the end of an existing
 * element: port A is the picked element's end node, the main route (A→C) leaves
 * it on its end bearing, and the crossing point lies the form's end distance
 * along it — straight ahead, or along the arc a Bogenkreuzungsweiche's legs run
 * on (AP 3.4). The cross route (B→D) leaves at the form's crossing angle, on
 * the side the field says.
 *
 * The main route's first leg is not a track of its own: it is appended to the
 * picked track as its last element, marked 'main', so the record's port A names
 * that track and the crossing is connected the way a turnout is — what hangs on
 * the port is the line the user picked, and deleting the crossing trims the leg
 * back off it (switchDelete). The other legs are committed as tracks of their
 * own, one element long, marked with their route ('main' at C, 'cross' at B and
 * D); the connecting routes of a crossing switch are committed as tracks of
 * their own, one element each, marked 'slip1'/'slip2'. Which element each is —
 * straight or arc — is the geometry's to say (crossingElements). The record
 * names the four ports.
 */

export default function CrossingForm({ onCommitted, initialKind = 'crossing' }) {
  const { t } = useI18n()
  const map = useMap()
  const project = useProject()
  const { fields, errors, setErrors, setField, lineNumberError } = useTrackFields()
  const [nameError, setNameError] = useState(false)
  // Why the last click was no place for a crossing (switchEndAnchorRefusal).
  const [pickError, setPickError] = useState(null)
  const [phase, setPhase]         = useState('select')
  const [anchor, setAnchor]      = useState(null)   // { trackId, epsg, startUtm, bearing, startWgs } — port A
  const [crossSide, setCrossSide] = useState('right')  // which side the cross route leaves on
  const [formIdx, setFormIdx]     = useState(() =>
    Math.max(0, CROSSING_TYPES.findIndex(f => f.kind === initialKind)))

  const forms      = CROSSING_TYPES
  const form      = forms[formIdx]
  // The two classes the Ril keeps its forms in, as the two groups of the
  // picker: Regelformen (800.0120A01) first, Sonderbauformen (A02) after.
  const formOptionen = (klasse) => forms
    .map((f, i) => ({ f, i }))
    .filter(entry => entry.f.klasse === klasse)
    .map(({ f, i }) => <option key={i} value={i}>{f.label}</option>)

  const alpha     = crossingAngle(form) * 180 / Math.PI
  const crossAngle = (crossSide === 'right' ? alpha : -alpha)

  // The designation names a crossing, not a switch — it follows the form's kind.
  const switchNo = useSwitchNumber(project.id, form.kind)

  const preview = usePreview(SWITCH_PREVIEW_LAYERS, { resetFilters: [TRACKS_HOVER_LAYER], resetCursor: true })

  // The geometry as it would be committed — derived, so preview and commit
  // cannot disagree. The crossing point lies the form's end distance along the
  // main leg from the anchored end, so port A is the picked element's end node
  // exactly.
  const g = anchor
    ? computeCrossingGeometryFromPortA(anchor.startUtm, anchor.startWgs, anchor.bearing, form, crossAngle)
    : null

  // ── Hover preview (select phase) ─────────────────────────────────────────
  useMapEvents(phase === 'select', {
    mousemove: (e, m) => {
      const hit = pickAt(m, e.point)
      const track = hit ? loadTracks().find(tr => tr.id === hit.trackId) : null
      const el    = track?.elements?.[hit.elementIndex]
      // Only where one may actually go — the preview is the answer to "here?",
      // so it must not stand somewhere the commit would then refuse.
      if (!el || switchEndAnchorRefusal(track, hit.elementIndex)) {
        preview.set(SWITCH_LINES_SOURCE, null)
        preview.set(SWITCH_FILL_SOURCE, null)
        return
      }
      const endWgs = el.geometry.coordinates[el.geometry.coordinates.length - 1]
      const endUtm = nodeUtm(el.endNode, endWgs, track.epsg)
      const brg    = resolveEndBearing(el, track.epsg)
      const gg     = computeCrossingGeometryFromPortA(endUtm, endWgs, brg, form, crossAngle)
      const pv     = buildCrossingPreview(gg)
      preview.set(SWITCH_LINES_SOURCE, pv.lines)
      preview.set(SWITCH_FILL_SOURCE, pv.fill)
    },
  })

  // ── Click to pick the element the crossing connects to ────────────────────
  useMapPick({
    active: phase === 'select', hover: 'element',
    onPick: ({ trackId, elementIndex }) => {
      const elIdx = elementIndex
      const track  = loadTracks().find(tr => tr.id === trackId)
      const el      = track?.elements?.[elIdx]
      if (!el) return
      const refusal = switchEndAnchorRefusal(track, elIdx)
      if (refusal) { setPickError(refusal); return }
      setPickError(null)

      const endWgs = el.geometry.coordinates[el.geometry.coordinates.length - 1]

      // The new legs inherit the picked track's metadata: the main route
      // continues its line over the crossing.
      setField('owner',       track.owner       ?? 'DB')
      setField('type',        trackTypeName(track, 'line_track'))
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
    },
  })

  // ── Preview while editing ──────────────────────────────────────────────────
  useEffect(() => {
    const m = map?.current
    if (!m || phase !== 'editing') return
    if (!g) {
      preview.set(SWITCH_LINES_SOURCE, null)
      preview.set(SWITCH_FILL_SOURCE, null)
      return
    }
    const pv = buildCrossingPreview(g)
    preview.set(SWITCH_LINES_SOURCE, pv.lines)
    preview.set(SWITCH_FILL_SOURCE, pv.fill)
  }, [phase, g, map, preview])

  // The main route's continuation beyond the crossing point is the only new
  // track on the picked line — it carries the name.
  const mainGeometry = g ? { epsg: anchor.epsg, path: [g.portA_utm, g.portC_utm] } : null
  const { name, setName, reset: resetName } = useTrackName(project.id, fields, { geometry: mainGeometry, setField })

  const handleNameChange = (val) => { setName(val); setNameError(false) }


  const handleCancel = () => {
    preview.clear()
    setPickError(null)
    setPhase('select')
    setAnchor(null)
    onCommitted?.()
  }

  const handleCommit = () => {
    setErrors([])
    if (lineNumberError || !g || !anchor) return
    const existingNames = new Set(loadTracks().map(tr => tr.name).filter(Boolean))
    if (name && existingNames.has(name)) { setNameError(true); return }
    setNameError(false)
    if (!switchNo.claim()) return

    commitSwitchConnection(buildCrossingAtTrackEnd({
      g, anchor, form, switchName: switchNo.name, switchNumber: switchNo.number, name, fields,
    }))

    resetName()
    switchNo.reset()
    setNameError(false)
    preview.clear()
    onCommitted?.()
  }

  const endDistance = crossingEndDistance(form)

  if (phase === 'select') {
    return (
      <>
        <p>{t('crossing_hint_select')}</p>
        {pickError && <p className="form-error">{t(pickError)}</p>}
        {errors.length > 0 && <p className="form-error">{errors.join(', ')}</p>}
        <button className="panel-btn panel-btn-full mt-8 secondary" onClick={handleCancel}>
          {t('btn_cancel')}
        </button>
      </>
    )
  }

  return (
    <>
      <FormSection title={t('section_geometry')}>
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
        <ReadOnlyField label={t('bearing')} value={anchor.bearing.toFixed(3)} />
        <ReadOnlyField label={t('crossing_angle')} value={`1:${form.ratio} (${alpha.toFixed(2)}°)`} />
        <ReadOnlyField label={t('crossing_end_distance')} value={`${endDistance.toFixed(2)} m`} />
        {form.R != null && (
          <ReadOnlyField label={t('field_radius')} value={`${form.R} m`} />
        )}
        {crossingLegRadius(form) != null && (
          <ReadOnlyField label={t('crossing_leg_radius')} value={`${crossingLegRadius(form)} m`} />
        )}
        {form.Ri != null && (
          <ReadOnlyField label={t('crossing_inner_radius')} value={`${form.Ri} m`} />
        )}
        <HeightDatumField value={fields.heightEpsg} onChange={v => setField('heightEpsg', v)} />
      </FormSection>

      <FormSection title={t('switch_meta_data')}>
        <SwitchNumberField number={switchNo.number} onChange={switchNo.setNumber}
          name={switchNo.name} taken={switchNo.taken} />
      </FormSection>

      <FormSection title={t('section_meta')}>
        <TrackFields fields={fields} setField={setField} setErrors={setErrors} errors={errors}
          name={name} onNameChange={handleNameChange} nameError={nameError} />
      </FormSection>

      {errors.length > 0 && (
        <p className="form-error">
          <span className="form-error-required">{t('error_required')}</span>: {errors.join(', ')}
        </p>
      )}
      {nameError && <p className="form-error">{t('track_name_exists')}</p>}

      <CommitBar onCommit={handleCommit} onCancel={handleCancel} className="" />
    </>
  )
}
