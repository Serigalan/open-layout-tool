import { useCallback, useEffect, useRef, useState } from 'react'
import { addElementToTrack } from '../../../storage'
import {
  computeCurvedValuesUtm, arcCoordsFromRadiusUtm, projectOnBearingUtm,
  endPointStraightUtm, endPointCurvedUtm,
} from '../../../utils/elementUtils'
import { wgs84ToUTM } from '../../../utils/coordinateUtils'
import { computeClothoidUtm } from '../../../utils/clothoidUtils'
import { setLineData, setMarkerData, clearPreview } from '../../../utils/mapRenderUtils'
import { FILTER_NONE, computeAutoC, computeCantDef, MAX_CANT, cantDefLimit, SAGITTA_ELEMENT, SAGITTA_TRACK, mapIsLive } from '../../../utils/mapConstants'
import RuleFindings from '../RuleFindings'
import CantField from '../CantField'
import useTrackHover from '../../../hooks/useTrackHover'
import useDerivedField from '../../../hooks/useDerivedField'
import useElementSelection from '../../../hooks/useElementSelection'
import UtmCoordFields from '../../UtmCoordFields'
import TransitionCurveSection from './TransitionCurveSection'
import { toWgs } from './connectHelpers'

export default function ConnectCurvedForm({ t, map, project, onTrackSaved, onCommitted }) {
  const [phase, setPhase]                   = useState('select')
  const [selectedTrack, setSelectedTrack]   = useState(null)
  const [startPoint, setStartPoint]         = useState(null)   // UTM
  const [endPoint, setEndPoint]             = useState(null)   // UTM
  const [bearing, setBearing]               = useState(null)
  const [arcLength, setArcLength]           = useState('')
  const [signedRadius, setSignedRadius]     = useState('')
  const [endBearing, setEndBearing]         = useState('')
  const [speed, setSpeed]                   = useState(0)
  const [prevRadius, setPrevRadius]         = useState(null)
  const [transitionEnabled, setTransitionEnabled] = useState(false)
  const [transitionType, setTransitionType]       = useState('clothoid')
  const [transitionLength, setTransitionLength]   = useState(20)

  // Cant follows speed and radius unless the user overrode it for that pair.
  const [cant, setCant, clearCant] = useDerivedField(`${speed}|${signedRadius}`,
    computeAutoC(speed, Math.abs(Number(signedRadius))))

  const bearingRef      = useRef(null)
  const startRef        = useRef(null)   // UTM
  const arcLengthRef    = useRef(arcLength)
  const signedRadiusRef = useRef(signedRadius)
  useEffect(() => { arcLengthRef.current    = arcLength    }, [arcLength])
  useEffect(() => { signedRadiusRef.current = signedRadius }, [signedRadius])

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

  useElementSelection(map, project, phase, setPhase, 'draw', (track, endUtm, elBearing, lastEl) => {
    setSelectedTrack(track)
    setStartPoint(endUtm)
    setBearing(elBearing)
    setSpeed(lastEl?.speed ?? 80)
    setCant(lastEl?.cant ?? 0)
    setPrevRadius(lastEl?.radius ?? null)
    bearingRef.current = elBearing
    startRef.current   = endUtm
  })

  // Interactive draw — mouse determines radius
  useEffect(() => {
    if (phase !== 'draw' || !map?.current || !startRef.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'crosshair'

    const onMove = (e) => {
      const spUtm    = startRef.current
      const b        = bearingRef.current
      const mouseUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], spUtm.zone)
      const { along, perp: rawPerp } = projectOnBearingUtm(spUtm, mouseUtm, b)
      if (along <= 1) return

      const spWgs = toWgs(spUtm)
      if (Math.abs(rawPerp) < 0.5) {
        const epUtm = endPointStraightUtm(spUtm, b, along)
        const epWgs = toWgs(epUtm)
        setLineData(m, [spWgs, epWgs], `L = ${Math.round(along * 100) / 100}m`)
        setMarkerData(m, [spWgs, epWgs])
        setEndPoint(epUtm)
        setArcLength(String(Math.round(along * 1000) / 1000))
        setSignedRadius('')
        setEndBearing('')
        return
      }

      const R      = (along * along + rawPerp * rawPerp) / (2 * rawPerp)
      const epUtm  = mouseUtm
      const coords = arcCoordsFromRadiusUtm(spUtm, epUtm, R)
      if (!coords) return
      const v = computeCurvedValuesUtm(spUtm, epUtm, R)
      setLineData(m, coords, `L = ${Math.round(v.length * 100) / 100}m  R = ${Math.round(R * 100) / 100}m`)
      setMarkerData(m, [spWgs, toWgs(epUtm)])
      setEndPoint(epUtm)
      setArcLength(String(v.length))
      setSignedRadius(String(Math.round(R * 1000) / 1000))
      setEndBearing(String(v.endBearing))
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

  const updatePreviewFromFields = useCallback((len, r) => {
    const l = Number(len), rv = Number(r)
    if (isNaN(l) || l <= 0 || isNaN(rv) || Math.abs(rv) < 0.01 || !startPoint || bearing === null) return

    let arcStartUtm = startPoint
    let arcStartBrg = bearing
    let allCoords   = []

    if (transitionEnabled && transitionLength > 0) {
      const cl    = computeClothoidUtm(startPoint, bearing, transitionLength, prevRadius, rv, SAGITTA_ELEMENT, transitionType)
      allCoords   = [...cl.coords]
      arcStartUtm = cl.endUtm
      arcStartBrg = cl.endBearing
    }

    const epUtm  = endPointCurvedUtm(arcStartUtm, arcStartBrg, l, rv)
    const coords = arcCoordsFromRadiusUtm(arcStartUtm, epUtm, rv)
    if (!coords) return
    const v = computeCurvedValuesUtm(arcStartUtm, epUtm, rv)

    if (allCoords.length > 0) allCoords.push(...coords.slice(1))
    else allCoords = [...coords]

    setEndPoint(epUtm)
    setEndBearing(String(v.endBearing))

    if (map?.current) {
      setLineData(map.current, allCoords, `L = ${Math.round(l * 100) / 100}m  R = ${Math.round(Math.abs(rv) * 100) / 100}m`)
      setMarkerData(map.current, [toWgs(startPoint), toWgs(epUtm)])
    }
  }, [startPoint, bearing, transitionEnabled, transitionType, transitionLength, prevRadius, map])

  const handleArcLengthChange = (val) => { setArcLength(val);    updatePreviewFromFields(val, signedRadius) }
  const handleRadiusChange    = (val) => { setSignedRadius(val); updatePreviewFromFields(arcLength, val)   }

  // Redraw when the transition-curve parameters change; the length and radius
  // the user last entered are read from refs, so typing does not re-enter here.
  useEffect(() => {
    if (phase !== 'done') return
    updatePreviewFromFields(arcLengthRef.current, signedRadiusRef.current)
  }, [phase, updatePreviewFromFields])

  const resetForm = () => {
    setPhase('select')
    setSelectedTrack(null)
    setStartPoint(null)
    setEndPoint(null)
    setBearing(null)
    setArcLength('')
    setSignedRadius('')
    setEndBearing('')
    clearCant()
    setPrevRadius(null)
    setTransitionEnabled(false)
    setTransitionType('clothoid')
    setTransitionLength(20)
  }

  const handleCommit = () => {
    if (!startPoint || !endPoint || !selectedTrack) return
    const r = Number(signedRadius)
    if (!r || !arcLength) return

    const arcLen    = Number(arcLength)
    const trackZone = selectedTrack.epsg
    let arcStartUtm = startPoint
    let arcStartBrg = bearing

    if (transitionEnabled && transitionLength > 0) {
      const cl   = computeClothoidUtm(startPoint, bearing, transitionLength, prevRadius, r, SAGITTA_ELEMENT, transitionType)
      const clR  = computeClothoidUtm(startPoint, bearing, transitionLength, prevRadius, r, SAGITTA_TRACK, transitionType)
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
        r2:           r,
        transitionType,
        geometry:     { type: 'LineString', coordinates: cl.coords },
        renderCoords: clR.coords,
      })
      arcStartUtm = eUtm
      arcStartBrg = cl.endBearing
    }

    const arcEndUtm      = endPointCurvedUtm(arcStartUtm, arcStartBrg, arcLen, r)
    const arcCoords      = arcCoordsFromRadiusUtm(arcStartUtm, arcEndUtm, r, SAGITTA_ELEMENT)
    const arcRenderCoords = arcCoordsFromRadiusUtm(arcStartUtm, arcEndUtm, r, SAGITTA_TRACK)
    const v              = computeCurvedValuesUtm(arcStartUtm, arcEndUtm, r)
    const fallback       = [toWgs(arcStartUtm), toWgs(arcEndUtm)]
    addElementToTrack(project.id, selectedTrack.id, {
      elementType:  1,
      startNode:    v.startNode,
      endNode:      v.endNode,
      bearing:      arcStartBrg,
      length:       arcLen,
      absLength:    arcLen,
      speed,
      endBearing:   v.endBearing,
      radius:       r,
      cant,
      geometry:     { type: 'LineString', coordinates: arcCoords    || fallback },
      renderCoords: arcRenderCoords || fallback,
    })

    if (map?.current) {
      clearPreview(map.current)
      map.current.setFilter('tracks-selected-layer', FILTER_NONE)
    }
    resetForm()
    onTrackSaved?.()
    onCommitted?.()
  }

  const hasArc = phase === 'done' || !!endPoint

  return (
    <>
      {phase === 'select' && (
        <p className="selecting-hint">{t('connect_select_hint')}</p>
      )}
      {phase === 'draw' && !endPoint && (
        <p className="selecting-hint">{t('connect_set_curve')}</p>
      )}

      {selectedTrack && (
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

          {hasArc && (
            <>
              <div className="form-field">
                <label>{t('arc_length')}</label>
                <input type="number" step="0.001" value={arcLength} onChange={e => handleArcLengthChange(e.target.value)} />
              </div>
              <div className="form-field">
                <label>{t('field_radius')}</label>
                <input type="number" step="0.001" value={signedRadius} onChange={e => handleRadiusChange(e.target.value)} />
              </div>
              {endBearing && (
                <div className="form-field">
                  <label>{t('end_bearing')}</label>
                  <input type="number" readOnly value={endBearing} />
                </div>
              )}
              <div className="form-field">
                <label>{t('field_speed')}</label>
                <input type="number" min="0" value={speed} onChange={e => setSpeed(Number(e.target.value))} />
              </div>
              <CantField t={t} value={cant} onChange={setCant}
                min={-MAX_CANT} max={MAX_CANT}
                speed={speed} radius={Math.abs(Number(signedRadius))} />
              <div className="form-field">
                <label>{t('cant_def')}</label>
                <input type="number" readOnly value={computeCantDef(speed, Math.abs(Number(signedRadius)), cant)} />
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
            <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onCommitted}>
              {t('btn_cancel')}
            </button>
          </>
        )
      })()}
    </>
  )
}
