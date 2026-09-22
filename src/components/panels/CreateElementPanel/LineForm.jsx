import { useEffect, useRef, useState } from 'react'
import { saveTrack, loadTracks, generateId } from '../../../storage'
import { wgs84ToUTM, epsgForLngLat, EPSG_OPTIONS } from '../../../utils/coordinateUtils'
import { computeStraightValuesUtm, endPointStraightUtm } from '../../../utils/elementUtils'
import { buildTypeFields } from '../../../utils/identifierUtils'
import { setLineData, setMarkerData, clearPreview } from '../../../utils/mapRenderUtils'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import TrackFields from '../TrackFields'
import useNearbyLines from '../../../hooks/useNearbyLines'
import HeightDatumField from '../HeightDatumField'
import UtmCoordFields from '../../UtmCoordFields'
import RuleFindings from '../RuleFindings'
import { toWgs } from './createHelpers'
import { elementPath } from '../../../utils/lineLookup'

export default function LineForm({ t, map, project, onTrackSaved }) {
  const lineOptions = useNearbyLines(map)
  const { fields, errors, setErrors, setField, lineNumberError } = useTrackFields()
  const [nameError, setNameError] = useState(false)
  const [selecting, setSelecting] = useState(true)
  const [selPhase, setSelPhase]   = useState(0)
  const [firstPoint, setFirstPoint] = useState(null)   // UTM
  const [points, setPoints]       = useState([])        // [startUtm, endUtm]
  const [speed, setSpeed]         = useState(80)
  const [length, setLength]       = useState('')
  const [bearing, setBearing]     = useState('')
  const [startE, setStartE]       = useState('')
  const [startN, setStartN]       = useState('')
  const [endE, setEndE]           = useState('')
  const [endN, setEndN]           = useState('')
  const [epsg, setUtmZone]     = useState('')
  const firstPointRef             = useRef(null)   // UTM
  // The track as it would be saved: the line it lies on names it.
  const geometry = points.length === 2 ? elementPath(points[0], points[1]) : null
  const { name, setName, reset: resetName } = useTrackName(project.id, fields, { geometry, setField })

  useEffect(() => {
    const m = map?.current
    return () => {
      if (!m) return
      clearPreview(m)
      m.getCanvas().style.cursor = ''
    }
  }, [map])

  const applyPoints = (startUtm, endUtm, m) => {
    const v = computeStraightValuesUtm(startUtm, endUtm)
    setPoints([startUtm, endUtm])
    setUtmZone(v.epsg)
    setStartE(startUtm.easting.toFixed(2)); setStartN(startUtm.northing.toFixed(2))
    setEndE(endUtm.easting.toFixed(2));     setEndN(endUtm.northing.toFixed(2))
    setLength(String(v.length))
    setBearing(String(v.bearing))
    if (m) {
      setLineData(m, [toWgs(startUtm), toWgs(endUtm)], `L = ${Math.round(v.length * 100) / 100}m`)
      setMarkerData(m, [toWgs(startUtm), toWgs(endUtm)])
    }
  }

  useEffect(() => {
    if (!selecting || !map?.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'crosshair'

    const onClick = (e) => {
      const wgs = [e.lngLat.lng, e.lngLat.lat]
      if (!firstPointRef.current) {
        const utm = wgs84ToUTM(wgs, epsgForLngLat(wgs))   // a new track: its CRS is suggested from the click
        firstPointRef.current = utm
        setSelPhase(1)
        setFirstPoint(utm)
        setMarkerData(m, [wgs])
      } else {
        const fp  = firstPointRef.current
        const utm = wgs84ToUTM(wgs, fp.zone)   // same zone as start
        firstPointRef.current = null
        m.off('click', onClick)
        m.getCanvas().style.cursor = ''
        setSelecting(false)
        setSelPhase(0)
        setFirstPoint(null)
        applyPoints(fp, utm, m)
      }
    }

    m.on('click', onClick)
    return () => { m.off('click', onClick); m.getCanvas().style.cursor = '' }
  }, [selecting, map])

  useEffect(() => {
    if (!firstPoint || !map?.current) return
    const m = map.current

    const onMove = (e) => {
      const mouseUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], firstPoint.zone)
      const v = computeStraightValuesUtm(firstPoint, mouseUtm)
      setLineData(m, [toWgs(firstPoint), [e.lngLat.lng, e.lngLat.lat]], `L = ${Math.round(v.length * 100) / 100}m`)
    }

    m.on('mousemove', onMove)
    return () => m.off('mousemove', onMove)
  }, [firstPoint, map])

  const handleLengthChange = (val) => {
    setLength(val)
    const l = Number(val), b = Number(bearing)
    if (isNaN(l) || isNaN(b) || l <= 0 || points.length < 2) return
    const newEndUtm = endPointStraightUtm(points[0], b, l)
    setPoints([points[0], newEndUtm])
    setEndE(newEndUtm.easting.toFixed(2)); setEndN(newEndUtm.northing.toFixed(2))
    if (map?.current) {
      setLineData(map.current, [toWgs(points[0]), toWgs(newEndUtm)], `L = ${Math.round(l * 100) / 100}m`)
      setMarkerData(map.current, [toWgs(points[0]), toWgs(newEndUtm)])
    }
  }

  const handleBearingChange = (val) => {
    setBearing(val)
    const b = Number(val), l = Number(length)
    if (isNaN(b) || isNaN(l) || l <= 0 || points.length < 2) return
    const newEndUtm = endPointStraightUtm(points[0], b, l)
    setPoints([points[0], newEndUtm])
    setEndE(newEndUtm.easting.toFixed(2)); setEndN(newEndUtm.northing.toFixed(2))
    if (map?.current) {
      setLineData(map.current, [toWgs(points[0]), toWgs(newEndUtm)], `L = ${Math.round(l * 100) / 100}m`)
      setMarkerData(map.current, [toWgs(points[0]), toWgs(newEndUtm)])
    }
  }

  const handleCoordChange = (which, axis, val) => {
    if (which === 'start') {
      const e = axis === 'e' ? val : startE
      const n = axis === 'n' ? val : startN
      if (axis === 'e') setStartE(val); else setStartN(val)
      const eNum = Number(e), nNum = Number(n)
      if (isNaN(eNum) || isNaN(nNum) || !epsg) return
      const newStartUtm = { easting: eNum, northing: nNum, zone: epsg }
      if (points.length === 2) applyPoints(newStartUtm, points[1], map?.current)
    } else {
      const e = axis === 'e' ? val : endE
      const n = axis === 'n' ? val : endN
      if (axis === 'e') setEndE(val); else setEndN(val)
      const eNum = Number(e), nNum = Number(n)
      if (isNaN(eNum) || isNaN(nNum) || !epsg) return
      const newEndUtm = { easting: eNum, northing: nNum, zone: epsg }
      if (points.length === 2) applyPoints(points[0], newEndUtm, map?.current)
    }
  }

  const handleNameChange = (val) => {
    setName(val)
    setNameError(false)
  }

  // CRS override: the map click auto-suggests a zone; the user may pick a
  // different one — the cached WGS84 points are exactly reprojected into it.
  const handleEpsgChange = (val) => {
    if (points.length === 2 && val) {
      applyPoints(wgs84ToUTM(toWgs(points[0]), val), wgs84ToUTM(toWgs(points[1]), val), map?.current)
    } else {
      setUtmZone(val)
    }
  }

  const handleCommit = () => {
    setErrors([])
    if (lineNumberError) return
    const existingNames = new Set(loadTracks(project.id).map(t => t.name).filter(Boolean))
    if (name && existingNames.has(name)) { setNameError(true); return }
    setNameError(false)

    const startUtm = points[0], endUtm = points[1]
    const v        = computeStraightValuesUtm(startUtm, endUtm)
    const startWgs = toWgs(startUtm), endWgs = toWgs(endUtm)

    saveTrack(project.id, {
      id:          generateId(),
      name,
      owner:       fields.owner,
      ...buildTypeFields(fields),
      coordinates: [startWgs, endWgs],
      epsg:     v.epsg,
      elements: [{
        elementType: 0,
        startNode:   v.startNode,
        endNode:     v.endNode,
        bearing:     v.bearing,
        length:      v.length,
        absLength:   v.length,
        speed,
        geometry:    { type: 'LineString', coordinates: [startWgs, endWgs] },
      }],
    })

    setPoints([])
    resetName()
    setNameError(false)
    setLength('')
    setBearing('')
    if (map?.current) clearPreview(map.current)
    onTrackSaved?.()
  }

  const selectingHint = selPhase === 0 ? t('create_selecting_start') : t('create_selecting_end')

  return (
    <>
      <div className="element-form">
        <span className="create-element-section">Meta Data</span>
        <TrackFields t={t} fields={fields} setField={setField} setErrors={setErrors} errors={errors}
          name={name} onNameChange={handleNameChange} nameError={nameError}
          lineOptions={lineOptions} />
      </div>

      {points.length === 2 && (
        <div className="element-form">
          <span className="create-element-section">Geometry Data</span>
          <div className="form-field">
            <label>{t('field_length')}</label>
            <input type="number" step="0.001" value={length} onChange={e => handleLengthChange(e.target.value)} />
          </div>
          <div className="form-field">
            <label>{t('bearing')}</label>
            <input type="number" step="0.001" min="0" max="360" value={bearing} onChange={e => handleBearingChange(e.target.value)} />
          </div>
          <div className="form-field">
            <label>{t('field_speed')}</label>
            <input type="number" min="0" value={speed} onChange={e => setSpeed(Number(e.target.value))} />
          </div>
          <div className="form-field">
            <label>{t('create_crs')}</label>
            <select className="settings-select" value={epsg} onChange={e => handleEpsgChange(e.target.value)}>
              {EPSG_OPTIONS.map(o => (
                <option key={o.code} value={o.code}>EPSG {o.code} – {o.label}</option>
              ))}
            </select>
          </div>
          <HeightDatumField t={t} value={fields.heightEpsg} onChange={v => setField('heightEpsg', v)} />
          <UtmCoordFields label="Start" zone={epsg} easting={startE} northing={startN}
            onChange={(axis, val) => handleCoordChange('start', axis, val)} />
          <UtmCoordFields label="End" zone={epsg} easting={endE} northing={endN}
            onChange={(axis, val) => handleCoordChange('end', axis, val)} />
        </div>
      )}

      {selecting && <p className="selecting-hint">{selectingHint}</p>}

      {errors.length > 0 && (
        <p className="form-error">
          ⚠ <span className="form-error-required">{t('error_required')}</span>: {errors.join(', ')}
        </p>
      )}

      {points.length === 2 && !selecting && (
        <>
          <RuleFindings t={t} element={{
            elementType: 0, speed, length: Number(length), cant: 0,
          }} />
          <button className="panel-btn panel-btn-full" onClick={handleCommit}>
            {t('btn_commit')}
          </button>
          <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onTrackSaved}>
            {t('btn_cancel')}
          </button>
        </>
      )}
    </>
  )
}
