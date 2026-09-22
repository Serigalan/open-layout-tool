import { useCallback, useEffect, useRef, useState } from 'react'
import { saveTrack, loadTracks, generateId } from '../../../storage'
import { wgs84ToUTM, epsgForLngLat, EPSG_OPTIONS } from '../../../utils/coordinateUtils'
import {
  computeCurvedValuesUtm, arcCoordsFromRadiusUtm,
  signedRadiusFrom3PointsUtm, endPointCurvedUtm,
} from '../../../utils/elementUtils'
import { buildTypeFields } from '../../../utils/identifierUtils'
import { setLineData, setMarkerData, clearPreview } from '../../../utils/mapRenderUtils'
import { computeAutoC, computeCantDef, MAX_CANT, cantDefLimit, SAGITTA_ELEMENT, SAGITTA_TRACK } from '../../../utils/mapConstants'
import RuleFindings from '../RuleFindings'
import CantField from '../CantField'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import useDerivedField from '../../../hooks/useDerivedField'
import TrackFields from '../TrackFields'
import useNearbyLines from '../../../hooks/useNearbyLines'
import HeightDatumField from '../HeightDatumField'
import UtmCoordFields from '../../UtmCoordFields'
import { toWgs } from './createHelpers'
import { elementPath } from '../../../utils/lineLookup'

export default function CurvedLineForm({ t, map, project, onTrackSaved }) {
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

  useEffect(() => {
    const m = map?.current
    return () => {
      if (!m) return
      clearPreview(m)
      m.getCanvas().style.cursor = ''
    }
  }, [map])

  // Click handler: collect 3 points in UTM
  useEffect(() => {
    if (!selecting || !map?.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'crosshair'

    const onClick = (e) => {
      const wgs = [e.lngLat.lng, e.lngLat.lat]
      if (!p1Ref.current) {
        const utm = wgs84ToUTM(wgs, epsgForLngLat(wgs))   // a new track: its CRS is suggested from the first click
        p1Ref.current = utm
        setSelPhase(1)
        setMarkerData(m, [wgs])
      } else if (!p2Ref.current) {
        const utm = wgs84ToUTM(wgs, p1Ref.current.zone)
        p2Ref.current = utm
        setSelPhase(2)
        setMarkerData(m, [toWgs(p1Ref.current), wgs])
      } else {
        const fp1 = p1Ref.current, fp2 = p2Ref.current
        const fp3 = wgs84ToUTM(wgs, fp1.zone)
        p1Ref.current = null; p2Ref.current = null
        m.off('click', onClick)
        m.getCanvas().style.cursor = ''
        setSelecting(false); setSelPhase(0)
        setMarkerData(m, [toWgs(fp1), toWgs(fp2)])
        const fitted = signedRadiusFrom3PointsUtm(fp1, fp2, fp3)
        const r = fitted !== null ? Math.round(fitted) : null
        setStartPoint(fp1)
        setEndPoint(fp2)
        setSignedRadius(r !== null ? String(r) : '')
        applyDerived(fp1, fp2, r)
      }
    }

    m.on('click', onClick)
    return () => { m.off('click', onClick); m.getCanvas().style.cursor = '' }
  }, [selecting, map, applyDerived])

  // Live preview during selection
  useEffect(() => {
    if (!selecting || selPhase === 0 || !map?.current) return
    const m = map.current

    const onMove = (e) => {
      const mouse = [e.lngLat.lng, e.lngLat.lat]
      const zone  = p1Ref.current?.zone
      if (selPhase === 1) {
        setLineData(m, [toWgs(p1Ref.current), mouse])
      } else {
        const mouseUtm = wgs84ToUTM(mouse, zone)
        const r = signedRadiusFrom3PointsUtm(p1Ref.current, p2Ref.current, mouseUtm)
        if (r !== null) {
          const coords = arcCoordsFromRadiusUtm(p1Ref.current, p2Ref.current, r)
          if (coords) {
            const v = computeCurvedValuesUtm(p1Ref.current, p2Ref.current, r)
            setLineData(m, coords, `R = ${Math.round(Math.abs(r))}m | L = ${Math.round(v.length * 100) / 100}m`)
          }
        }
      }
    }

    m.on('mousemove', onMove)
    return () => m.off('mousemove', onMove)
  }, [selecting, selPhase, map])

  // Preview of the arc as it currently stands.
  useEffect(() => {
    const m = map?.current
    if (!m || !startPoint || !endPoint) return
    const r = Number(signedRadius)
    if (!r) return
    const v      = computeCurvedValuesUtm(startPoint, endPoint, r)
    const coords = arcCoordsFromRadiusUtm(startPoint, endPoint, r)
    if (coords) setLineData(m, coords, `R = ${Math.abs(r)}m | L = ${Math.round(v.length * 100) / 100}m`)
  }, [startPoint, endPoint, signedRadius, map])

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
    const existingNames = new Set(loadTracks(project.id).map(t => t.name).filter(Boolean))
    if (name && existingNames.has(name)) { setNameError(true); return }
    setNameError(false)

    const r             = Number(signedRadius)
    const v             = computeCurvedValuesUtm(startPoint, endPoint, r)
    const renderCoords  = arcCoordsFromRadiusUtm(startPoint, endPoint, r, SAGITTA_TRACK)   || [toWgs(startPoint), toWgs(endPoint)]
    const elementCoords = arcCoordsFromRadiusUtm(startPoint, endPoint, r, SAGITTA_ELEMENT) || [toWgs(startPoint), toWgs(endPoint)]

    saveTrack(project.id, {
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
    if (map?.current) clearPreview(map.current)
    onTrackSaved?.()
  }

  const selectingHint = selPhase === 0
    ? t('create_selecting_start')
    : selPhase === 1 ? t('create_selecting_end') : t('create_selecting_arc')
  const hasPoints = startPoint && endPoint

  return (
    <>
      <div className="element-form">
        <span className="create-element-section">Meta Data</span>
        <TrackFields t={t} fields={fields} setField={setField} setErrors={setErrors} errors={errors}
          name={name} onNameChange={handleNameChange} nameError={nameError}
          lineOptions={lineOptions} />
      </div>

      {(signedRadius !== '' || hasPoints) && (
        <div className="element-form">
          <span className="create-element-section">Geometry Data</span>
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
              <CantField t={t} value={cant} onChange={setCant}
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
              <HeightDatumField t={t} value={fields.heightEpsg} onChange={v => setField('heightEpsg', v)} />
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
        const cantDef = computeCantDef(speed, Math.abs(Number(signedRadius)), cant)
        const cantErr = Math.abs(cant) > MAX_CANT
        // The deficiency a speed may reach is a step, not one number
        // (LP.KB.02) — so it is asked for this speed, not read off a constant.
        const defErr  = cantDef > cantDefLimit(speed)
        return (
          <>
            {/* What stands in the way is said by the findings above, from
                the rule itself — the sentence that used to stand here named a
                fixed 150 mm, which the deficiency limit stopped being when it
                became LP.KB.02's step. The gate below stays narrower than the
                catalogue's verdict on purpose: it refuses cant and deficiency,
                as it always did, and does not newly refuse a length or a speed
                off the grid that the findings only report. */}
            <RuleFindings t={t} element={{
              elementType: 1, radius: Number(signedRadius), cant, speed, length: Number(arcLength),
            }} />
            <button className="panel-btn panel-btn-full" onClick={handleCommit}
              disabled={cantErr || defErr} style={{ opacity: (cantErr || defErr) ? 0.5 : 1 }}>
              {t('btn_commit')}
            </button>
            <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onTrackSaved}>
              {t('btn_cancel')}
            </button>
          </>
        )
      })()}
    </>
  )
}
