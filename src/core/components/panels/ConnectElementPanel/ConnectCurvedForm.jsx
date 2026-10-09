import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addElementsToTrack, loadTracks } from '../../../storage'
import {
  computeCurvedValuesUtm, arcCoordsFromRadiusUtm, projectOnBearingUtm, endPointCurvedUtm,
} from '../../../utils/elementUtils'
import { wgs84ToUTM, toWgs } from '../../../utils/coordinateUtils'
import { computeClothoidUtm } from '../../../utils/clothoidUtils'
import { computeAutoC, computeCantDef, MAX_CANT } from '../../../utils/rules/cant'
import { SAGITTA_ELEMENT } from '../../../utils/geometryPrecision'
import RuleFindings from '../RuleFindings'
import { hasRuleError } from '../../../utils/trassierungCheck'
import CantField from '../CantField'
import useDerivedField from '../../../hooks/useDerivedField'
import UtmCoordFields from '../../UtmCoordFields'
import TransitionCurveSection from './TransitionCurveSection'
import { transitionChain, transitionHasError } from '../../../utils/rules/transitionLength'
import { useI18n } from '../../../locales/i18nContext'
import useDrawPreview from '../../../map/useDrawPreview'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'
import { trackEndAnchor, inheritedSpeed } from '../../../utils/trackModel'
import useMapEvents from '../../../map/useMapEvents'
import { buildConnectCurved, curveCant } from '../../../utils/commands/tracks'
import NewStretchShiftValues from '../shift/NewStretchShiftValues'
import CommitBar from '../../form/CommitBar'
import ReadOnlyField from '../../form/ReadOnlyField'
import AdvancedInfo from '../../form/AdvancedInfo'
import { firstReason } from '../../form/firstReason'
import FieldRule from '../../form/FieldRule'
import NumberInput from '../../form/NumberInput'
import { splitUnit } from '../../../locales/i18n'

export default function ConnectCurvedForm({ onCommitted }) {
  const { t } = useI18n()
  const draw = useDrawPreview()
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
  const [lastEl, setLastEl]                 = useState(null)   // the element the track ends with
  const [transitionEnabled, setTransitionEnabled] = useState(false)
  const [transitionType, setTransitionType]       = useState('clothoid')
  const [transitionLength, setTransitionLength]   = useState(20)

  // Cant follows speed and radius unless the user overrode it for that pair —
  // a magnitude, signed with the curve where the arc is judged and written.
  const [cant, setCant, clearCant] = useDerivedField(`${speed}|${signedRadius}`,
    computeAutoC(speed, Math.abs(Number(signedRadius))))

  const bearingRef      = useRef(null)
  const startRef        = useRef(null)   // UTM
  const arcLengthRef    = useRef(arcLength)
  const signedRadiusRef = useRef(signedRadius)
  useEffect(() => { arcLengthRef.current    = arcLength    }, [arcLength])
  useEffect(() => { signedRadiusRef.current = signedRadius }, [signedRadius])


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
      setSpeed(inheritedSpeed(track) ?? a.lastEl.speed ?? 80)
      setCant(Math.abs(a.lastEl.cant ?? 0))
      setPrevRadius(a.lastEl.radius ?? null)
      setLastEl(a.lastEl)
      bearingRef.current = a.bearing
      startRef.current   = a.endUtm
      setPhase('draw')
    },
  })
  useSelectedOnMap(selectedTrack ? { trackId: selectedTrack.id, elementIndex: selectedTrack.elements.length - 1 } : null)

  // The cursor sets the radius and length; a click fixes it.
  useMapEvents(phase === 'draw' && !!startPoint, {
    mousemove: (e) => {
        const spUtm    = startRef.current
        const b        = bearingRef.current
        const mouseUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], spUtm.zone)
        const { along, perp: rawPerp } = projectOnBearingUtm(spUtm, mouseUtm, b)
        if (along <= 1) return

        // Always an arc, however close the cursor runs to the tangent — a
        // straight is "Gerade verbinden". Only exactly on it is there none.
        const spWgs = toWgs(spUtm)
        if (Math.abs(rawPerp) < 1e-6) return
        const R      = (along * along + rawPerp * rawPerp) / (2 * rawPerp)
        const epUtm  = mouseUtm
        const coords = arcCoordsFromRadiusUtm(spUtm, epUtm, R)
        if (!coords) return
        const v = computeCurvedValuesUtm(spUtm, epUtm, R)
        draw.line(coords, `L = ${Math.round(v.length * 100) / 100}m  R = ${Math.round(R * 100) / 100}m`)
        draw.markers([spWgs, toWgs(epUtm)])
        setEndPoint(epUtm)
        setArcLength(String(v.length))
        setSignedRadius(String(Math.round(R * 1000) / 1000))
        setEndBearing(String(v.endBearing))
    },
    click: () => { if (Number(signedRadiusRef.current)) setPhase('done') },
  }, { cursor: 'crosshair' })

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

    draw.line(allCoords, `L = ${Math.round(l * 100) / 100}m  R = ${Math.round(Math.abs(rv) * 100) / 100}m`)
    draw.markers([toWgs(startPoint), toWgs(epUtm)])
  }, [startPoint, bearing, transitionEnabled, transitionType, transitionLength, prevRadius, draw])

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
    setLastEl(null)
    setTransitionEnabled(false)
    setTransitionType('clothoid')
    setTransitionLength(20)
  }

  // The arc once it has a radius, and the transition in front of it — judged
  // in the chain it is laid into.
  const nextEl = Number(signedRadius)
    ? { elementType: 1, radius: Number(signedRadius), cant: curveCant(Number(signedRadius), cant), speed, length: Number(arcLength) }
    : null
  const transitionChainNow = transitionEnabled && nextEl
    ? transitionChain({ prev: lastEl, next: nextEl, r1: prevRadius, length: transitionLength, type: transitionType, speed })
    : null

  // What would be appended, for its shift values against a reference axis (Paket V).
  const appended = useMemo(() => (startPoint && endPoint && Number(signedRadius) && Number(arcLength) > 0 ? buildConnectCurved({
    start: startPoint, bearing, arcLength: Number(arcLength), signedR: Number(signedRadius), speed, cant,
    transition: transitionEnabled ? { length: transitionLength, type: transitionType, fromRadius: prevRadius } : null,
  }) : null), [startPoint, endPoint, bearing, arcLength, signedRadius, speed, cant, transitionEnabled, transitionLength, transitionType, prevRadius])

  const handleCommit = () => {
    if (!startPoint || !endPoint || !selectedTrack) return
    const r = Number(signedRadius)
    if (!r || !arcLength) return

    addElementsToTrack(selectedTrack.id, buildConnectCurved({
      start: startPoint, bearing, arcLength: Number(arcLength), signedR: r, speed, cant,
      transition: transitionEnabled ? { length: transitionLength, type: transitionType, fromRadius: prevRadius } : null,
    }))

    draw.clear()
    resetForm()
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
          enabled={transitionEnabled}
          onEnabledChange={setTransitionEnabled}
          type={transitionType}
          onTypeChange={setTransitionType}
          length={transitionLength}
          onLengthChange={setTransitionLength}
          prev={lastEl} next={nextEl} r1={prevRadius} speed={speed}
        />
      )}

      {selectedTrack && (
        <div className="element-form">
          {hasArc && (
            <>
              <div className="form-field">
                <label>{splitUnit(t('arc_length')).text}</label>
                <NumberInput step="0.001" value={arcLength} onChange={e => handleArcLengthChange(e.target.value)} unit="m" />
              </div>
              <div className="form-field">
                <label>{splitUnit(t('field_radius')).text}</label>
                <NumberInput step="0.001" value={signedRadius} onChange={e => handleRadiusChange(e.target.value)} unit="m" />
                <FieldRule name="radius" />
              </div>
              <div className="form-field">
                <label>{splitUnit(t('field_speed')).text}</label>
                <NumberInput min="0" value={speed} onChange={e => setSpeed(Number(e.target.value))} unit="km/h" />
                <FieldRule name="speed" />
              </div>
              <CantField value={cant} onChange={setCant}
                min={0} max={MAX_CANT}
                speed={speed} radius={Math.abs(Number(signedRadius))} />
            </>
          )}
          <AdvancedInfo>
            {startPoint && (
              <UtmCoordFields label={t('utm_start')} zone={startPoint.zone}
                easting={startPoint.easting.toFixed(2)} northing={startPoint.northing.toFixed(2)} readOnly />
            )}
            {bearing !== null && (
              <ReadOnlyField type="number" label={t('bearing')} value={Math.round(bearing * 1000) / 1000} />
            )}
            {hasArc && endBearing && (
              <ReadOnlyField type="number" label={t('end_bearing')} value={endBearing} />
            )}
            {hasArc && (
              <ReadOnlyField type="number" label={t('cant_def')} value={computeCantDef(speed, Math.abs(Number(signedRadius)), cant)} />
            )}
            {hasArc && endPoint && (
              <UtmCoordFields label={t('utm_end')} zone={endPoint.zone}
                easting={endPoint.easting.toFixed(2)} northing={endPoint.northing.toFixed(2)} readOnly />
            )}
          </AdvancedInfo>
        </div>
      )}

      {selectedTrack && appended && <NewStretchShiftValues id="shift-connect-curved" track={selectedTrack} elements={appended} />}

      {phase === 'done' && endPoint && (() => {
        // Judged once, shown and acted on: the findings say what the catalogue
        // found, and anything it calls an error stops the commit.
        const element = nextEl ?? {
          elementType: 1, radius: Number(signedRadius), cant: curveCant(Number(signedRadius), cant), speed, length: Number(arcLength),
        }
        const blocked = hasRuleError([element]) || (!!transitionChainNow && transitionHasError(transitionChainNow))
        return (
          <>
            <RuleFindings element={element} />
            <CommitBar onCommit={handleCommit} onCancel={onCommitted} reason={firstReason(!Number(signedRadius) && t('arc_radius_required'), blocked && t('commit_blocked_rules'))} className="" />
          </>
        )
      })()}
    </>
  )
}
