import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addElementToTrack, loadTracks } from '../../../storage'
import {
  computeStraightValuesUtm, projectOnBearingUtm, endPointStraightUtm,
} from '../../../utils/elementUtils'
import { wgs84ToUTM, toWgs } from '../../../utils/coordinateUtils'
import { computeClothoidUtm } from '../../../utils/clothoidUtils'
import { SAGITTA_ELEMENT, SAGITTA_TRACK } from '../../../utils/mapConstants'
import UtmCoordFields from '../../UtmCoordFields'
import TransitionCurveSection from './TransitionCurveSection'
import RuleFindings from '../RuleFindings'
import { hasRuleError } from '../../../utils/trassierungCheck'
import { useI18n } from '../../../locales/i18nContext'
import { useMap } from '../../../map/MapContext'
import useDrawPreview from '../../../map/useDrawPreview'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'
import { trackEndAnchor } from '../../../utils/trackModel'
import useMapEvents from '../../../map/useMapEvents'

export default function ConnectStraightForm({ onCommitted }) {
  const { t } = useI18n()
  const map = useMap()
  const draw = useDrawPreview()
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


  // A click on a track continues it from the end of its last element.
  useMapPick({
    active: phase === 'select', hover: 'element',
    onPick: ({ trackId }) => {
      const track = loadTracks().find(tr => tr.id === trackId)
      const a = track && trackEndAnchor(track)
      if (!a?.endWgs) return
      draw.markers([a.endWgs])
      setSelectedTrack(track)
      setStartPoint(a.endUtm)
      setBearing(a.bearing)
      setSpeed(a.lastEl.speed ?? 80)
      setPrevRadius(a.lastEl.radius ?? null)
      prevRadiusRef.current = a.lastEl.radius ?? null
      bearingRef.current    = a.bearing
      startRef.current      = a.endUtm
      setPhase('length')
    },
  })
  useSelectedOnMap(selectedTrack ? { trackId: selectedTrack.id, elementIndex: selectedTrack.elements.length - 1 } : null)

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

  // The cursor sets the length; a click fixes it.
  useMapEvents(phase === 'length' && !!startPoint, {
    mousemove: (e) => {
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
        draw.line(allCoords, `L = ${Math.round(along * 100) / 100}m`)
        draw.markers([toWgs(sp), epWgs])
        setLength(String(Math.round(along * 1000) / 1000))
    },
    click: () => setPhase('done'),
  }, { cursor: 'crosshair' })

  const handleLengthChange = (val) => {
    setLength(val)
    const l = Number(val)
    if (isNaN(l) || l <= 0 || !startPoint || bearing === null) return
    const { utm: effUtm, bearing: effBrg, extraCoords } = getEffectiveStartUtm(startPoint, bearing)
    const epWgs = toWgs(endPointStraightUtm(effUtm, effBrg, l))
    const allCoords = extraCoords.length > 0 ? [...extraCoords, epWgs] : [toWgs(startPoint), epWgs]
    draw.line(allCoords, `L = ${Math.round(l * 100) / 100}m`)
    draw.markers([toWgs(startPoint), epWgs])
  }

  // Redraw the preview once the line is placed — the transition-curve settings
  // move its start, so the end point follows from the current length.
  useEffect(() => {
    if (phase !== 'done' || !startPoint || bearing === null) return
    const l = Number(length)
    if (isNaN(l) || l <= 0) return
    const { utm: effUtm, bearing: effBrg, extraCoords } = getEffectiveStartUtm(startPoint, bearing)
    const epUtm = endPointStraightUtm(effUtm, effBrg, l)
    const epWgs = toWgs(epUtm)
    const allCoords = extraCoords.length > 0 ? [...extraCoords, epWgs] : [toWgs(startPoint), epWgs]
    draw.line(allCoords, `L = ${Math.round(l * 100) / 100}m`)
    draw.markers([toWgs(startPoint), epWgs])
  }, [phase, startPoint, bearing, length, map, getEffectiveStartUtm, draw])

  const handleCommit = () => {
    if (!startPoint || !endPoint || !selectedTrack) return
    const trackZone = selectedTrack.epsg

    let lineStartUtm = startPoint

    if (transitionEnabled && transitionLength > 0 && prevRadius !== null) {
      const cl   = computeClothoidUtm(startPoint, bearing, transitionLength, prevRadius, null, SAGITTA_ELEMENT, transitionType)
      const clR  = computeClothoidUtm(startPoint, bearing, transitionLength, prevRadius, null, SAGITTA_TRACK, transitionType)
      const sUtm = { easting: startPoint.easting, northing: startPoint.northing, zone: trackZone }
      const eUtm = cl.endUtm
      addElementToTrack(selectedTrack.id, {
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
    addElementToTrack(selectedTrack.id, {
      elementType: 0,
      startNode:   v.startNode,
      endNode:     v.endNode,
      bearing:     v.bearing,
      length:      v.length,
      absLength:   v.length,
      speed,
      geometry:    { type: 'LineString', coordinates: [startWgs, endWgs] },
    })

    draw.clear()
    setPhase('select')
    setSelectedTrack(null)
    setStartPoint(null)
    setBearing(null)
    setLength('')
    setPrevRadius(null)
    setTransitionEnabled(false)
    setTransitionType('clothoid')
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

      {phase === 'done' && endPoint && (() => {
        const element = { elementType: 0, speed, length: Number(length), cant: 0 }
        const blocked = hasRuleError([element])
        return (
          <>
            <RuleFindings element={element} />
            <button className="panel-btn panel-btn-full" onClick={handleCommit}
              disabled={blocked}>
              {t('btn_commit')}
            </button>
            <button className="panel-btn panel-btn-full mt-2 secondary" onClick={onCommitted}>
              {t('btn_cancel')}
            </button>
          </>
        )
      })()}
    </>
  )
}
