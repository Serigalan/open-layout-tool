import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addElementToTrack } from '../../../storage'
import {
  computeStraightValuesUtm, projectOnBearingUtm, endPointStraightUtm,
} from '../../../utils/elementUtils'
import { wgs84ToUTM } from '../../../utils/coordinateUtils'
import { computeClothoidUtm } from '../../../utils/clothoidUtils'
import { setLineData, setMarkerData, clearPreview } from '../../../utils/mapRenderUtils'
import { FILTER_NONE, SAGITTA_ELEMENT, SAGITTA_TRACK, mapIsLive } from '../../../utils/mapConstants'
import useTrackHover from '../../../hooks/useTrackHover'
import useElementSelection from '../../../hooks/useElementSelection'
import UtmCoordFields from '../../UtmCoordFields'
import TransitionCurveSection from './TransitionCurveSection'
import { toWgs } from './connectHelpers'
import RuleFindings from '../RuleFindings'

export default function ConnectStraightForm({ t, map, project, onTrackSaved, onCommitted }) {
  const [phase, setPhase]                   = useState('select')
  const [selectedTrack, setSelectedTrack]   = useState(null)
  const [startPoint, setStartPoint]         = useState(null)   // UTM {easting, northing, zone}
  const [bearing, setBearing]               = useState(null)
  const [length, setLength]                 = useState('')
  const [speed, setSpeed]                   = useState(0)
  const [prevRadius, setPrevRadius]         = useState(null)
  const [transitionEnabled, setTransitionEnabled] = useState(false)
  const [transitionType, setTransitionType]       = useState('clothoid')
  const [transitionLength, setTransitionLength]   = useState(20)

  const bearingRef        = useRef(null)
  const startRef          = useRef(null)   // UTM
  const prevRadiusRef     = useRef(null)
  const transitionEnRef   = useRef(false)
  const transitionTypeRef = useRef('clothoid')
  const transitionLenRef  = useRef(20)

  useEffect(() => { transitionEnRef.current   = transitionEnabled }, [transitionEnabled])
  useEffect(() => { transitionTypeRef.current = transitionType    }, [transitionType])
  useEffect(() => { transitionLenRef.current  = transitionLength  }, [transitionLength])
  useEffect(() => { prevRadiusRef.current     = prevRadius        }, [prevRadius])

  useTrackHover(map, phase, 'select', project)

  useEffect(() => {
    const m = map?.current
    return () => {
      if (!mapIsLive(map, m)) return
      clearPreview(m)
      m.getCanvas().style.cursor = ''
      m.setFilter('tracks-selected-layer', FILTER_NONE)
      m.setFilter('tracks-hover-layer', FILTER_NONE)
    }
  }, [map])

  // useElementSelection now delivers UTM endUtm
  useElementSelection(map, project, phase, setPhase, 'length', (track, endUtm, elBearing, lastEl) => {
    setSelectedTrack(track)
    setStartPoint(endUtm)
    setBearing(elBearing)
    setSpeed(lastEl?.speed ?? 80)
    const pr = lastEl?.radius ?? null
    setPrevRadius(pr)
    prevRadiusRef.current = pr
    bearingRef.current    = elBearing
    startRef.current      = endUtm
  })

  // Clothoid helper: returns { utm, bearing, extraCoords } — computed in the
  // element's native CRS plane (spUtm.zone).
  const getEffectiveStartUtm = useCallback((spUtm, b) => {
    if (transitionEnabled && transitionLength > 0 && prevRadius !== null) {
      const cl = computeClothoidUtm(spUtm, b, transitionLength, prevRadius, null, SAGITTA_ELEMENT, transitionType)
      return {
        utm:         cl.endUtm,
        bearing:     cl.endBearing,
        extraCoords: cl.coords,
      }
    }
    return { utm: spUtm, bearing: b, extraCoords: [] }
  }, [transitionEnabled, transitionType, transitionLength, prevRadius])

  // Where the line ends follows from its start, the transition curve in front
  // of it and the length — so it is derived instead of stored beside them.
  const endPoint = useMemo(() => {
    if (!startPoint || bearing === null) return null
    const l = Number(length)
    if (!(l > 0)) return null
    const { utm, bearing: b } = getEffectiveStartUtm(startPoint, bearing)
    return endPointStraightUtm(utm, b, l)
  }, [startPoint, bearing, length, getEffectiveStartUtm])

  // Interactive length selection
  useEffect(() => {
    if (phase !== 'length' || !map?.current || !startRef.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'crosshair'

    const onMove = (e) => {
      const sp  = startRef.current
      const b   = bearingRef.current
      const mouseUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], sp.zone)

      let lineStartUtm = sp, lineBrg = b, extraCoords = []
      if (transitionEnRef.current && transitionLenRef.current > 0 && prevRadiusRef.current !== null) {
        const cl = computeClothoidUtm(sp, b, transitionLenRef.current, prevRadiusRef.current, null,
          SAGITTA_ELEMENT, transitionTypeRef.current)
        extraCoords  = cl.coords
        lineStartUtm = cl.endUtm
        lineBrg      = cl.endBearing
      }

      const { along } = projectOnBearingUtm(lineStartUtm, mouseUtm, lineBrg)
      if (along <= 0) return
      const epUtm = endPointStraightUtm(lineStartUtm, lineBrg, along)
      const epWgs = toWgs(epUtm)
      const allCoords = extraCoords.length > 0 ? [...extraCoords, epWgs] : [toWgs(sp), epWgs]
      setLineData(m, allCoords, `L = ${Math.round(along * 100) / 100}m`)
      setMarkerData(m, [toWgs(sp), epWgs])
      setLength(String(Math.round(along * 1000) / 1000))
    }

    const onClick = () => {
      m.off('mousemove', onMove)
      m.off('click', onClick)
      m.getCanvas().style.cursor = ''
      setPhase('done')
    }

    m.on('mousemove', onMove)
    m.on('click', onClick)
    return () => {
      m.off('mousemove', onMove)
      m.off('click', onClick)
      m.getCanvas().style.cursor = ''
    }
  }, [phase, map])

  const handleLengthChange = (val) => {
    setLength(val)
    const l = Number(val)
    if (isNaN(l) || l <= 0 || !startPoint || bearing === null) return
    const { utm: effUtm, bearing: effBrg, extraCoords } = getEffectiveStartUtm(startPoint, bearing)
    const epWgs = toWgs(endPointStraightUtm(effUtm, effBrg, l))
    if (map?.current) {
      const allCoords = extraCoords.length > 0 ? [...extraCoords, epWgs] : [toWgs(startPoint), epWgs]
      setLineData(map.current, allCoords, `L = ${Math.round(l * 100) / 100}m`)
      setMarkerData(map.current, [toWgs(startPoint), epWgs])
    }
  }

  // Redraw the preview once the line is placed — the transition-curve settings
  // move its start, so the end point follows from the current length.
  useEffect(() => {
    if (phase !== 'done' || !startPoint || bearing === null) return
    const l = Number(length)
    if (isNaN(l) || l <= 0) return
    const { utm: effUtm, bearing: effBrg, extraCoords } = getEffectiveStartUtm(startPoint, bearing)
    const epUtm = endPointStraightUtm(effUtm, effBrg, l)
    if (map?.current) {
      const epWgs = toWgs(epUtm)
      const allCoords = extraCoords.length > 0 ? [...extraCoords, epWgs] : [toWgs(startPoint), epWgs]
      setLineData(map.current, allCoords, `L = ${Math.round(l * 100) / 100}m`)
      setMarkerData(map.current, [toWgs(startPoint), epWgs])
    }
  }, [phase, startPoint, bearing, length, map, getEffectiveStartUtm])

  const handleCommit = () => {
    if (!startPoint || !endPoint || !selectedTrack) return
    const trackZone = selectedTrack.epsg

    let lineStartUtm = startPoint

    if (transitionEnabled && transitionLength > 0 && prevRadius !== null) {
      const cl   = computeClothoidUtm(startPoint, bearing, transitionLength, prevRadius, null, SAGITTA_ELEMENT, transitionType)
      const clR  = computeClothoidUtm(startPoint, bearing, transitionLength, prevRadius, null, SAGITTA_TRACK, transitionType)
      const sUtm = { easting: startPoint.easting, northing: startPoint.northing, zone: trackZone }
      const eUtm = cl.endUtm
      addElementToTrack(project.id, selectedTrack.id, {
        elementType:  2,
        startNode:    [sUtm.easting, sUtm.northing],
        endNode:      [eUtm.easting, eUtm.northing],
        bearing,
        length:       transitionLength,
        absLength:    transitionLength,
        speed,
        endBearing:   cl.endBearing,
        r1:           prevRadius,
        r2:           null,
        transitionType,
        geometry:     { type: 'LineString', coordinates: cl.coords },
        renderCoords: clR.coords,
      })
      lineStartUtm = eUtm
    }

    // All calculation in UTM, WGS84 only for geometry
    const v        = computeStraightValuesUtm(lineStartUtm, endPoint)
    const startWgs = toWgs(lineStartUtm)
    const endWgs   = toWgs(endPoint)
    addElementToTrack(project.id, selectedTrack.id, {
      elementType: 0,
      startNode:   v.startNode,
      endNode:     v.endNode,
      bearing:     v.bearing,
      length:      v.length,
      absLength:   v.length,
      speed,
      geometry:    { type: 'LineString', coordinates: [startWgs, endWgs] },
    })

    if (map?.current) {
      clearPreview(map.current)
      map.current.setFilter('tracks-selected-layer', FILTER_NONE)
    }
    setPhase('select')
    setSelectedTrack(null)
    setStartPoint(null)
    setBearing(null)
    setLength('')
    setPrevRadius(null)
    setTransitionEnabled(false)
    setTransitionType('clothoid')
    onTrackSaved?.()
    onCommitted?.()
  }

  return (
    <>
      {phase === 'select' && (
        <p className="selecting-hint">{t('connect_select_hint')}</p>
      )}
      {phase === 'length' && !endPoint && (
        <p className="selecting-hint">{t('connect_set_length')}</p>
      )}

      {selectedTrack && prevRadius !== null && (
        <TransitionCurveSection
          t={t}
          enabled={transitionEnabled}
          onEnabledChange={setTransitionEnabled}
          type={transitionType}
          onTypeChange={setTransitionType}
          length={transitionLength}
          onLengthChange={setTransitionLength}
        />
      )}

      {selectedTrack && (
        <div className="element-form">
          {startPoint && (
            <UtmCoordFields label={t('utm_start')} zone={startPoint.zone}
              easting={startPoint.easting.toFixed(2)} northing={startPoint.northing.toFixed(2)} readOnly />
          )}
          {bearing !== null && (
            <div className="form-field">
              <label>{t('bearing')}</label>
              <input type="number" readOnly value={Math.round(bearing * 1000) / 1000} />
            </div>
          )}
          {(phase === 'done' || endPoint) && (
            <>
              <div className="form-field">
                <label>{t('field_length')}</label>
                <input type="number" step="0.001" value={length} onChange={e => handleLengthChange(e.target.value)} />
              </div>
              <div className="form-field">
                <label>{t('field_speed')}</label>
                <input type="number" min="0" value={speed} onChange={e => setSpeed(Number(e.target.value))} />
              </div>
              {endPoint && (
                <UtmCoordFields label={t('utm_end')} zone={endPoint.zone}
                  easting={endPoint.easting.toFixed(2)} northing={endPoint.northing.toFixed(2)} readOnly />
              )}
            </>
          )}
        </div>
      )}

      {phase === 'done' && endPoint && (
        <>
          <RuleFindings t={t} element={{
            elementType: 0, speed, length: Number(length), cant: 0,
          }} />
          <button className="panel-btn panel-btn-full" onClick={handleCommit}>
            {t('btn_commit')}
          </button>
          <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onCommitted}>
            {t('btn_cancel')}
          </button>
        </>
      )}
    </>
  )
}
