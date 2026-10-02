import { useCallback, useEffect, useRef, useState } from 'react'
import { saveTrack, loadTracks } from '../../../storage'
import { generateId, buildTypeFields } from '../../../utils/identifierUtils'
import { wgs84ToUTM, epsgForLngLat, EPSG_OPTIONS, toWgs } from '../../../utils/coordinateUtils'
import {
  computeCurvedValuesUtm, arcCoordsFromRadiusUtm,
  signedRadiusFrom3PointsUtm, endPointCurvedUtm,
} from '../../../utils/elementUtils'
import { computeAutoC, computeCantDef, MAX_CANT, SAGITTA_ELEMENT, SAGITTA_TRACK } from '../../../utils/mapConstants'
import RuleFindings from '../RuleFindings'
import { hasRuleError } from '../../../utils/trassierungCheck'
import CantField from '../CantField'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import useDerivedField from '../../../hooks/useDerivedField'
import TrackFields from '../TrackFields'
import useNearbyLines from '../../../hooks/useNearbyLines'
import HeightDatumField from '../HeightDatumField'
import UtmCoordFields from '../../UtmCoordFields'
import { elementPath } from '../../../utils/lineLookup'
import { useI18n } from '../../../locales/i18nContext'
import { useMap } from '../../../map/MapContext'
import { useProject } from '../../../hooks/useStore'
import useDrawPreview from '../../../map/useDrawPreview'
import useMapEvents from '../../../map/useMapEvents'

export default function CurvedLineForm({ onDone }) {
  const { t } = useI18n()
  const map = useMap()
  const draw = useDrawPreview()
  const project = useProject()
  const lineOptions = useNearbyLines(map)
  const { fields, errors, setErrors, setField, lineNumberError } = useTrackFields()
  const [nameError, setNameError] = useState(false)
  const [selecting, setSelecting] = useState(true)
  const [selPhase, setSelPhase]   = useState(0)
  const [startPoint, setStartPoint] = useState(null)   // UTM
  const [endPoint, setEndPoint]     = useState(null)   // UTM
  const [speed, setSpeed]           = useState(80)
  const [signedRadius, setSignedRadius] = useState('')
  const [arcLength, setArcLength]   = useState('')
  const [bearing, setBearing]       = useState('')
  const [endBearing, setEndBearing] = useState('')
  const p1Ref          = useRef(null)   // UTM
  const p2Ref          = useRef(null)   // UTM
  // The track as it would be saved: the line it lies on names it.
  const geometry = startPoint && endPoint ? elementPath(startPoint, endPoint, Number(signedRadius) || null) : null
  const { name, setName, reset: resetName } = useTrackName(project.id, fields, { geometry, setField })

  // Cant follows speed and radius unless the user overrode it for that pair.
  const absR = Math.abs(Number(signedRadius))
  const [cant, setCant, clearCant] = useDerivedField(`${speed}|${signedRadius}`, absR > 0 ? computeAutoC(speed, absR) : 0)

  // Length and bearings follow from start point, end point and radius. They are
  // rewritten wherever one of those three changes — except when the change came
  // from the length or bearing field itself, where the user's own text stands.
  const applyDerived = useCallback((s, e, r) => {
    if (!s || !e || !r) { setArcLength(''); setBearing(''); setEndBearing(''); return }
    const v = computeCurvedValuesUtm(s, e, r)
    setArcLength(String(v.length))
    setBearing(String(v.bearing))
    setEndBearing(String(v.endBearing))
  }, [])


  // Three clicks in UTM: start, end, and a point the arc passes through.
  useMapEvents(selecting, {
    click: (e) => {
      const wgs = [e.lngLat.lng, e.lngLat.lat]
      if (!p1Ref.current) {
        const utm = wgs84ToUTM(wgs, epsgForLngLat(wgs))   // a new track: its CRS is suggested from the first click
        p1Ref.current = utm
        setSelPhase(1)
        draw.markers([wgs])
      } else if (!p2Ref.current) {
        const utm = wgs84ToUTM(wgs, p1Ref.current.zone)
        p2Ref.current = utm
        setSelPhase(2)
        draw.markers([toWgs(p1Ref.current), wgs])
      } else {
        const fp1 = p1Ref.current, fp2 = p2Ref.current
        const fp3 = wgs84ToUTM(wgs, fp1.zone)
        p1Ref.current = null; p2Ref.current = null
        setSelecting(false); setSelPhase(0)
        draw.markers([toWgs(fp1), toWgs(fp2)])
        const fitted = signedRadiusFrom3PointsUtm(fp1, fp2, fp3)
        const r = fitted !== null ? Math.round(fitted) : null
        setStartPoint(fp1)
        setEndPoint(fp2)
        setSignedRadius(r !== null ? String(r) : '')
        applyDerived(fp1, fp2, r)
      }
    },
  }, { cursor: 'crosshair' })

  // Live preview between the clicks.
  useMapEvents(selecting && selPhase > 0, {
    mousemove: (e) => {
      const mouse = [e.lngLat.lng, e.lngLat.lat]
      if (selPhase === 1) {
        draw.line([toWgs(p1Ref.current), mouse])
        return
      }
      const mouseUtm = wgs84ToUTM(mouse, p1Ref.current?.zone)
      const r = signedRadiusFrom3PointsUtm(p1Ref.current, p2Ref.current, mouseUtm)
      const coords = r !== null && arcCoordsFromRadiusUtm(p1Ref.current, p2Ref.current, r)
      if (!coords) return
      const v = computeCurvedValuesUtm(p1Ref.current, p2Ref.current, r)
      draw.line(coords, `R = ${Math.round(Math.abs(r))}m | L = ${Math.round(v.length * 100) / 100}m`)
    },
  })

  // Preview of the arc as it currently stands.
  useEffect(() => {
    if (!startPoint || !endPoint) return
    const r = Number(signedRadius)
    if (!r) return
    const v      = computeCurvedValuesUtm(startPoint, endPoint, r)
    const coords = arcCoordsFromRadiusUtm(startPoint, endPoint, r)
    if (coords) draw.line(coords, `R = ${Math.abs(r)}m | L = ${Math.round(v.length * 100) / 100}m`)
  }, [startPoint, endPoint, signedRadius, draw])

  const handleRadiusChange = (val) => {
    setSignedRadius(val)
    applyDerived(startPoint, endPoint, Number(val))
  }

  const handleArcLengthChange = (val) => {
    setArcLength(val)
    const l = Number(val), b = Number(bearing), r = Number(signedRadius)
    if (isNaN(l) || isNaN(b) || isNaN(r) || l <= 0 || r === 0 || !startPoint) return
    setEndPoint(endPointCurvedUtm(startPoint, b, l, r))
  }

  const handleBearingChange = (val) => {
    setBearing(val)
    const b = Number(val), l = Number(arcLength), r = Number(signedRadius)
    if (isNaN(b) || isNaN(l) || isNaN(r) || l <= 0 || r === 0 || !startPoint) return
    setEndPoint(endPointCurvedUtm(startPoint, b, l, r))
  }

  const handleNameChange = (val) => {
    setName(val)
    setNameError(false)
  }

  // CRS override: the first map click auto-suggests a zone; the user may pick
  // a different one — the points are exactly reprojected into it, and length
  // and bearings are re-derived in the new plane.
  const handleEpsgChange = (val) => {
    if (!startPoint || !endPoint || !val) return
    const s = wgs84ToUTM(toWgs(startPoint), val)
    const e = wgs84ToUTM(toWgs(endPoint), val)
    setStartPoint(s)
    setEndPoint(e)
    applyDerived(s, e, Number(signedRadius))
  }

  const handleCommit = () => {
    setErrors([])
    if (lineNumberError) return
    const existingNames = new Set(loadTracks().map(t => t.name).filter(Boolean))
    if (name && existingNames.has(name)) { setNameError(true); return }
    setNameError(false)

    const r             = Number(signedRadius)
    const v             = computeCurvedValuesUtm(startPoint, endPoint, r)
    const renderCoords  = arcCoordsFromRadiusUtm(startPoint, endPoint, r, SAGITTA_TRACK)   || [toWgs(startPoint), toWgs(endPoint)]
    const elementCoords = arcCoordsFromRadiusUtm(startPoint, endPoint, r, SAGITTA_ELEMENT) || [toWgs(startPoint), toWgs(endPoint)]

    saveTrack({
      id:          generateId(),
      name,
      owner:       fields.owner,
      ...buildTypeFields(fields),
      coordinates: renderCoords,
      epsg:     v.epsg,
      elements: [{
        elementType:  1,
        startNode:    v.startNode,
        endNode:      v.endNode,
        bearing:      v.bearing,
        length:       v.length,
        absLength:    v.length,
        speed,
        endBearing:   v.endBearing,
        radius:       v.radius,
        cant,
        geometry:     { type: 'LineString', coordinates: elementCoords },
        renderCoords,
      }],
    })

    resetName()
    setNameError(false)
    setStartPoint(null); setEndPoint(null)
    setSignedRadius(''); setArcLength(''); setBearing(''); setEndBearing('')
    clearCant()
    draw.clear()
    onDone?.()
  }

  const selectingHint = selPhase === 0
    ? t('create_selecting_start')
    : selPhase === 1 ? t('create_selecting_end') : t('create_selecting_arc')
  const hasPoints = startPoint && endPoint

  return (
    <>
      <div className="element-form">
        <span className="create-element-section">{t('section_meta')}</span>
        <TrackFields fields={fields} setField={setField} setErrors={setErrors} errors={errors}
          name={name} onNameChange={handleNameChange} nameError={nameError}
          lineOptions={lineOptions} />
      </div>

      {(signedRadius !== '' || hasPoints) && (
        <div className="element-form">
          <span className="create-element-section">{t('section_geometry')}</span>
          <div className="form-field">
            <label>Radius (m)</label>
            <input type="number" value={signedRadius} onChange={e => handleRadiusChange(e.target.value)} />
          </div>
          {hasPoints && (
            <>
              <div className="form-field">
                <label>{t('field_length')}</label>
                <input type="number" step="0.001" value={arcLength} onChange={e => handleArcLengthChange(e.target.value)} />
              </div>
              <div className="form-field">
                <label>{t('bearing')}</label>
                <input type="number" step="0.001" min="0" max="360" value={bearing} onChange={e => handleBearingChange(e.target.value)} />
              </div>
              <div className="form-field">
                <label>{t('end_bearing')}</label>
                <input type="number" step="0.001" readOnly value={endBearing} />
              </div>
              <div className="form-field">
                <label>{t('field_speed')}</label>
                <input type="number" min="0" value={speed} onChange={e => setSpeed(Number(e.target.value))} />
              </div>
              <CantField value={cant} onChange={setCant}
                min={-MAX_CANT} max={MAX_CANT} speed={speed} radius={absR} />
              <div className="form-field">
                <label>{t('cant_def')}</label>
                <input type="number" readOnly value={computeCantDef(speed, Math.abs(Number(signedRadius)), cant)} />
              </div>
              <div className="form-field">
                <label>{t('create_crs')}</label>
                <select className="settings-select" value={startPoint.zone} onChange={e => handleEpsgChange(e.target.value)}>
                  {EPSG_OPTIONS.map(o => (
                    <option key={o.code} value={o.code}>EPSG {o.code} – {o.label}</option>
                  ))}
                </select>
              </div>
              <HeightDatumField value={fields.heightEpsg} onChange={v => setField('heightEpsg', v)} />
              <UtmCoordFields label="Start" zone={startPoint.zone}
                easting={startPoint.easting.toFixed(2)} northing={startPoint.northing.toFixed(2)} readOnly />
              <UtmCoordFields label="End" zone={endPoint.zone}
                easting={endPoint.easting.toFixed(2)} northing={endPoint.northing.toFixed(2)} readOnly />
            </>
          )}
        </div>
      )}

      {selecting && <p className="selecting-hint">{selectingHint}</p>}

      {hasPoints && !selecting && (() => {
        // Judged once, shown and acted on: the findings say what the catalogue
        // found, and anything it calls an error stops the commit. Nothing here
        // restates a limit — the sentence that used to stand in this spot named
        // a fixed 150 mm, which the deficiency limit stopped being when it
        // became LP.KB.02's step over the speed.
        const element = {
          elementType: 1, radius: Number(signedRadius), cant, speed, length: Number(arcLength),
        }
        const blocked = hasRuleError([element])
        return (
          <>
            <RuleFindings element={element} />
            <button className="panel-btn panel-btn-full" onClick={handleCommit}
              disabled={blocked}>
              {t('btn_commit')}
            </button>
            <button className="panel-btn panel-btn-full mt-2 secondary" onClick={onDone}>
              {t('btn_cancel')}
            </button>
          </>
        )
      })()}
    </>
  )
}
