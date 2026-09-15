import { useCallback, useEffect, useRef, useState } from 'react'
import { saveTrack, loadTracks, generateId } from '../../../storage'
import { wgs84ToUTM, epsgForLngLat } from '../../../utils/coordinateUtils'
import { computeStraightValuesUtm, endPointStraightUtm, computeCurvedValuesUtm, arcCoordsFromRadiusUtm, arcCenter } from '../../../utils/elementUtils'
import { buildTypeFields } from '../../../utils/identifierUtils'
import { setLineData, setMarkerData, clearPreview } from '../../../utils/mapRenderUtils'
import { FILTER_NONE, HIT_TOLERANCE, filterForElement, SAGITTA_ELEMENT, SAGITTA_TRACK, mapIsLive } from '../../../utils/mapConstants'
import useTrackFields from '../../../hooks/useTrackFields'
import useTrackName from '../../../hooks/useTrackName'
import TrackFields from '../TrackFields'
import useNearbyLines from '../../../hooks/useNearbyLines'
import HeightDatumField from '../HeightDatumField'
import UtmCoordFields from '../../UtmCoordFields'
import { toWgs } from './createHelpers'
import { elementPath } from '../../../utils/lineLookup'

// Start/end of an element as UTM points. Uses the stored nodes when present,
// otherwise falls back to the first/last geometry coordinate.
function elementEndpointsUtm(el, epsg) {
  if (el.startNode && el.endNode && epsg) {
    return {
      start: { easting: el.startNode[0], northing: el.startNode[1], zone: epsg },
      end:   { easting: el.endNode[0],   northing: el.endNode[1],   zone: epsg },
    }
  }
  const coords = el.geometry?.coordinates ?? []
  if (coords.length < 2) return null
  const s = wgs84ToUTM(coords[0], epsg || epsgForLngLat(coords[0]))
  const e = wgs84ToUTM(coords[coords.length - 1], s.zone)
  return {
    start: { easting: s.easting, northing: s.northing, zone: s.zone },
    end:   { easting: e.easting, northing: e.northing, zone: e.zone },
  }
}

// Offset both endpoints perpendicular to the chord by `dist` metres.
// Positive shifts to the right (seen along the chord direction).
function offsetEndpoints(src, dist) {
  const { bearing } = computeStraightValuesUtm(src.start, src.end)
  const b = (bearing * Math.PI) / 180
  const perpE = Math.cos(b), perpN = -Math.sin(b)
  const shift = (p) => ({
    easting:  p.easting  + dist * perpE,
    northing: p.northing + dist * perpN,
    zone:     p.zone,
  })
  return { start: shift(src.start), end: shift(src.end) }
}

// Concentric offset of a circular arc: same centre, radius shifted by `dist`
// (positive = right of travel → inward for a right turn, outward for a left turn).
// Returns the offset endpoints and the new signed radius, or null if invalid.
function offsetArc(src, dist) {
  const ac = arcCenter(src.start.easting, src.start.northing, src.end.easting, src.end.northing, src.signedR)
  if (!ac) return null
  const { cx, cy, absR } = ac
  const sign = src.signedR >= 0 ? 1 : -1
  const newR = absR - sign * dist
  if (newR < 0.5) return null   // offset reached/crossed the centre
  const radial = (p) => {
    const rx = p.easting - cx, ry = p.northing - cy
    const len = Math.hypot(rx, ry) || 1
    return { easting: cx + newR * rx / len, northing: cy + newR * ry / len, zone: p.zone }
  }
  return { start: radial(src.start), end: radial(src.end), signedR: sign * newR }
}

export default function ParallelLineForm({ t, map, project, onTrackSaved }) {
  const lineOptions = useNearbyLines(map)
  const { fields, errors, setErrors, setField, lineNumberError } = useTrackFields()
  const [nameError, setNameError] = useState(false)
  const [selecting, setSelecting] = useState(true)
  const [offset, setOffset]       = useState('4.5')
  const [speed, setSpeed]         = useState(80)
  const [length, setLength]       = useState('')
  const [bearing, setBearing]     = useState('')
  const [startE, setStartE]       = useState('')
  const [startN, setStartN]       = useState('')
  const [endE, setEndE]           = useState('')
  const [endN, setEndN]           = useState('')
  const [epsg, setUtmZone]     = useState('')
  const [endBearing, setEndBearing] = useState('')
  const [isArc, setIsArc]         = useState(false)
  const [signedR, setSignedR]     = useState(0)      // signed radius of the parallel arc
  const [points, setPoints]       = useState([])     // [startUtm, endUtm] of the parallel
  const sourceRef                 = useRef(null)      // { start, end, signedR } UTM of the picked element
  // The track as it would be saved: the line it lies on names it.
  const geometry = points.length === 2 ? elementPath(points[0], points[1], isArc ? signedR : null) : null
  const { name, setName } = useTrackName(project.id, fields, { geometry, setField })

  useEffect(() => {
    const m = map?.current
    return () => {
      if (!mapIsLive(map, m)) return
      clearPreview(m)
      m.getCanvas().style.cursor = ''
      m.setFilter('tracks-selected-layer', FILTER_NONE)
    }
  }, [map])

  const applyPoints = useCallback((startUtm, endUtm, m) => {
    const v = computeStraightValuesUtm(startUtm, endUtm)
    setIsArc(false)
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
  }, [])

  const applyArc = useCallback((startUtm, endUtm, sR, m) => {
    const v = computeCurvedValuesUtm(startUtm, endUtm, sR)
    setIsArc(true)
    setPoints([startUtm, endUtm])
    setSignedR(sR)
    setUtmZone(v.epsg)
    setStartE(startUtm.easting.toFixed(2)); setStartN(startUtm.northing.toFixed(2))
    setEndE(endUtm.easting.toFixed(2));     setEndN(endUtm.northing.toFixed(2))
    setLength(String(v.length))
    setBearing(String(v.bearing))
    setEndBearing(String(v.endBearing))
    if (m) {
      const coords = arcCoordsFromRadiusUtm(startUtm, endUtm, sR, SAGITTA_TRACK) || [toWgs(startUtm), toWgs(endUtm)]
      setLineData(m, coords, `R = ${Math.abs(sR).toFixed(1)}m`)
      setMarkerData(m, [toWgs(startUtm), toWgs(endUtm)])
    }
  }, [])

  const buildParallel = useCallback((src, dist, m) => {
    if (src.signedR != null) {
      const r = offsetArc(src, dist)
      if (r) applyArc(r.start, r.end, r.signedR, m)
    } else {
      const { start, end } = offsetEndpoints(src, dist)
      applyPoints(start, end, m)
    }
  }, [applyArc, applyPoints])

  // Pick an element to offset.
  useEffect(() => {
    if (!selecting || !map?.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'pointer'

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })
        .filter(f => !f.properties.switchBranch)
      if (features.length === 0) return

      const { trackId, elementIndex } = features[0].properties
      const elIdx = Number(elementIndex)
      const track = loadTracks(project.id).find(tr => tr.id === trackId)
      const el = track?.elements?.[elIdx]
      if (!el) return
      const src = elementEndpointsUtm(el, track.epsg)
      if (!src) return
      src.signedR = el.radius != null ? el.radius : null   // null = straight

      sourceRef.current = src
      setSpeed(el.speed ?? 80)
      m.setFilter('tracks-selected-layer', filterForElement(trackId, elIdx))
      m.getCanvas().style.cursor = ''
      m.off('click', onClick)
      setSelecting(false)
      buildParallel(src, Number(offset) || 0, m)
    }

    m.on('click', onClick)
    return () => { m.off('click', onClick); m.getCanvas().style.cursor = '' }
  }, [selecting, map, buildParallel, offset, project.id])

  const handleOffsetChange = (val) => {
    setOffset(val)
    const d = Number(val)
    if (isNaN(d) || !sourceRef.current) return
    buildParallel(sourceRef.current, d, map?.current)
  }

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

  const handleCommit = () => {
    setErrors([])
    if (lineNumberError) return
    const existingNames = new Set(loadTracks(project.id).map(t => t.name).filter(Boolean))
    if (name && existingNames.has(name)) { setNameError(true); return }
    setNameError(false)

    const startUtm = points[0], endUtm = points[1]
    const startWgs = toWgs(startUtm), endWgs = toWgs(endUtm)

    let element, trackCoords, trackZone
    if (isArc) {
      const v      = computeCurvedValuesUtm(startUtm, endUtm, signedR)
      const coords = arcCoordsFromRadiusUtm(startUtm, endUtm, signedR, SAGITTA_ELEMENT) || [startWgs, endWgs]
      const render = arcCoordsFromRadiusUtm(startUtm, endUtm, signedR, SAGITTA_TRACK)   || coords
      trackCoords = render
      trackZone   = v.epsg
      element = {
        elementType: 1,
        startNode:   v.startNode,
        endNode:     v.endNode,
        bearing:     v.bearing,
        length:      v.length,
        absLength:   v.length,
        speed,
        endBearing:  v.endBearing,
        radius:      signedR,
        geometry:     { type: 'LineString', coordinates: coords },
        renderCoords: render,
      }
    } else {
      const v = computeStraightValuesUtm(startUtm, endUtm)
      trackCoords = [startWgs, endWgs]
      trackZone   = v.epsg
      element = {
        elementType: 0,
        startNode:   v.startNode,
        endNode:     v.endNode,
        bearing:     v.bearing,
        length:      v.length,
        absLength:   v.length,
        speed,
        geometry:    { type: 'LineString', coordinates: [startWgs, endWgs] },
      }
    }

    saveTrack(project.id, {
      id:          generateId(),
      name,
      owner:       fields.owner,
      ...buildTypeFields(fields),
      coordinates: trackCoords,
      epsg:     trackZone,
      elements:    [element],
    })

    if (map?.current) {
      clearPreview(map.current)
      map.current.setFilter('tracks-selected-layer', FILTER_NONE)
    }
    onTrackSaved?.()
  }

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
            <label>{t('field_offset')}</label>
            <input type="number" step="0.01" value={offset} onChange={e => handleOffsetChange(e.target.value)} />
          </div>
          {isArc ? (
            <>
              <div className="form-field">
                <label>{t('field_radius')}</label>
                <input type="number" readOnly value={Math.abs(signedR).toFixed(2)} />
              </div>
              <div className="form-field">
                <label>{t('arc_length')}</label>
                <input type="number" readOnly value={length} />
              </div>
              <div className="form-field">
                <label>{t('bearing')}</label>
                <input type="number" readOnly value={bearing} />
              </div>
              <div className="form-field">
                <label>{t('end_bearing')}</label>
                <input type="number" readOnly value={endBearing} />
              </div>
            </>
          ) : (
            <>
              <div className="form-field">
                <label>{t('field_length')}</label>
                <input type="number" step="0.001" value={length} onChange={e => handleLengthChange(e.target.value)} />
              </div>
              <div className="form-field">
                <label>{t('bearing')}</label>
                <input type="number" step="0.001" min="0" max="360" value={bearing} onChange={e => handleBearingChange(e.target.value)} />
              </div>
            </>
          )}
          <div className="form-field">
            <label>{t('field_speed')}</label>
            <input type="number" min="0" value={speed} onChange={e => setSpeed(Number(e.target.value))} />
          </div>
          <HeightDatumField t={t} value={fields.heightEpsg} onChange={v => setField('heightEpsg', v)} />
          <UtmCoordFields label="Start" zone={epsg} easting={startE} northing={startN} readOnly={isArc}
            onChange={isArc ? undefined : (axis, val) => handleCoordChange('start', axis, val)} />
          <UtmCoordFields label="End" zone={epsg} easting={endE} northing={endN} readOnly={isArc}
            onChange={isArc ? undefined : (axis, val) => handleCoordChange('end', axis, val)} />
        </div>
      )}

      {selecting && <p className="selecting-hint">{t('create_selecting_element')}</p>}

      {errors.length > 0 && (
        <p className="form-error">
          ⚠ <span className="form-error-required">{t('error_required')}</span>: {errors.join(', ')}
        </p>
      )}

      {points.length === 2 && !selecting && (
        <>
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
