import { useEffect, useMemo, useRef, useState } from 'react'
import { loadTracks, replaceAllTracks, remapSwitchTrackIds, generateId, rebuildCoords, recalcAbsLengths } from '../../storage'
import { computeStraightValuesUtm, computeCurvedValuesUtm, resolveEndBearing, reverseElement, nodeUtm } from '../../utils/elementUtils'
import { computeSpliceWithClothoids, computeArcSpliceWithClothoids, validateSpliceTangents } from '../../utils/spliceUtils'
import {
  HIT_TOLERANCE, ZOOM_LINE_WIDTH, cantSign, computeAutoC, computeCantDef, roundCant, CANT_STEP,
  MAX_CANT, MAX_CANT_DEF,
} from '../../utils/mapConstants'
import useTrackHover from '../../hooks/useTrackHover'
import usePreviewLayers from '../../hooks/usePreviewLayers'
import useDerivedField from '../../hooks/useDerivedField'
import { truncateHeights } from '../../utils/heightUtils'

const SPLICE_PREVIEW_SOURCE = 'splice-preview-source'
const SPLICE_PREVIEW_LAYER  = 'splice-preview-layer'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

// Layer definitions for usePreviewLayers
const SPLICE_PREVIEW_LAYERS = [{
  sourceId: SPLICE_PREVIEW_SOURCE,
  layer: {
    id: SPLICE_PREVIEW_LAYER, type: 'line',
    paint: {
      'line-color': '#ff8c00',
      'line-width': ZOOM_LINE_WIDTH,
      'line-dasharray': [6, 4],
    },
  },
}]

function buildPreviewGeoJSON(coords) {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    }],
  }
}

function trackLabel(track) {
  return [track.lineNumber, track.trackNumber].filter(Boolean).join(' / ') || track.name || track.id.slice(0, 8)
}


/**
 * The vertical alignment the merged track starts with: the departure track's,
 * cut where its last element is re-shaped — everything from there on belongs
 * to a track that did not exist before and is read from the terrain (see
 * elevationFill). `heights: undefined` when nothing is left to keep.
 */
function spliceHeights(depTrack, elIdx) {
  const cutAt = (depTrack.elements ?? []).slice(0, elIdx).reduce((sum, el) => sum + (el.length ?? 0), 0)
  return { heights: truncateHeights(depTrack.heights, cutAt) }
}

export default function SpliceElementPanel({ t, map, project, onTrackSaved }) {
  const [phase, setPhase]         = useState('select_first')
  const [picks, setPicks]         = useState([])   // [{trackId,elIdx,endUtm,startUtm,bearing,signedR,epsg,label}]
  const [radius, setRadius]       = useState(500)
  const [speed, setSpeed]         = useState(0)
  // The radius field is a magnitude here, so the cant is one too; it is signed
  // by the fitted arc when the element is written. Follows speed and radius
  // unless the user overrode it for that pair.
  const [cant, setCant] = useDerivedField(`${speed}|${radius}`, Math.abs(computeAutoC(speed, Math.abs(Number(radius)))))
  const [clothoidEnabled, setClothoidEnabled] = useState(false)
  const [transitionType, setTransitionType] = useState('clothoid')  // 'clothoid' | 'bloss'
  const [clothoidDep, setClothoidDep] = useState(60)
  const [clothoidArr, setClothoidArr] = useState(60)
  // Feedback from picking the two elements; the config phase has its own,
  // derived from the geometry (see `splice` below).
  const [selectStatus, setStatus] = useState(null)  // { msg, error }

  const picksRef = useRef(picks)
  useEffect(() => { picksRef.current = picks }, [picks])

  // Hover highlights for both select phases
  useTrackHover(map, phase, 'select_first', project)
  useTrackHover(map, phase, 'select_second', project)

  // ── Setup / cleanup preview layer ─────────────────────────────────────────
  usePreviewLayers(map, SPLICE_PREVIEW_LAYERS, { resetFilters: ['tracks-hover-layer'], resetCursor: true })

  // ── Click handler for select phases ──────────────────────────────────────
  useEffect(() => {
    if ((phase !== 'select_first' && phase !== 'select_second') || !map?.current) return
    const m = map.current

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })
      if (!features.length) return

      const { trackId, elementIndex } = features[0].properties
      const elIdx  = Number(elementIndex)
      const tracks = loadTracks(project.id)
      const track  = tracks.find(tr => tr.id === trackId)
      const el     = track?.elements?.[elIdx]
      if (!el) return

      // Clothoid/transition elements can't be spliced directly
      if (el.elementType === 2) {
        setStatus({ msg: t('splice_hint_straight_only'), error: true })
        return
      }

      const coords   = el.geometry.coordinates
      const epsg     = track.epsg
      const endUtm   = nodeUtm(el.endNode, coords[coords.length - 1], epsg)
      const startUtm = nodeUtm(el.startNode, coords[0], epsg)
      const bearing  = resolveEndBearing(el, epsg)
      const signedR  = el.radius != null ? el.radius : null   // null = straight
      const pick     = { trackId, elIdx, endUtm, startUtm, bearing, signedR, epsg, label: trackLabel(track) }

      if (phase === 'select_first') {
        setPicks([pick])
        setStatus(null)
        setPhase('select_second')
      } else {
        // Prevent picking the same element twice
        const first = picksRef.current[0]
        if (first && first.trackId === trackId && first.elIdx === elIdx) return
        if (first && first.trackId === trackId) {
          setStatus({ msg: t('splice_error_same_track'), error: true })
          return
        }
        // Both elements must be the same kind (two straights, or two arcs)
        if (first && (first.signedR == null) !== (signedR == null)) {
          setStatus({ msg: t('splice_error_mixed'), error: true })
          return
        }
        // Splicing merges both tracks into one, and a track has exactly one
        // CRS. Carrying the arrival track's nodes over unchanged would put
        // them in the wrong plane; reprojecting them would preserve the ground
        // geometry but distort the design scalars (R 800 m → 799.834 m across
        // GK4/UTM32). So require a common CRS instead.
        if (first && Number(first.epsg) !== Number(epsg)) {
          setStatus({ msg: t('splice_error_crs'), error: true })
          return
        }

        setPicks([first, pick])
        setStatus(null)
        setPhase('config')
      }
    }

    m.on('click', onClick)
    return () => m.off('click', onClick)
  }, [phase, map, project.id, t])

  // ── Spliced geometry, derived from the two picks and the parameters ──────
  // The preview and the commit read the same value, so they cannot disagree.
  const splice = useMemo(() => {
    const [dep, arr] = picks
    if (phase !== 'config' || !dep || !arr) return null
    const Ld = clothoidEnabled ? clothoidDep : 0
    const La = clothoidEnabled ? clothoidArr : 0
    const arcMode = dep.signedR != null && arr.signedR != null   // two arcs → straight connector

    // Solved in the shared native plane — the select phase rejects picks whose
    // tracks differ in CRS, so both picks' points and bearings are in this plane.
    let result, validationErr = null
    if (arcMode) {
      result = computeArcSpliceWithClothoids(
        dep.endUtm, dep.bearing, dep.signedR, arr.endUtm, arr.bearing, arr.signedR,
        dep.startUtm, arr.startUtm, Ld, La, transitionType,
      )
    } else {
      result = computeSpliceWithClothoids(
        dep.endUtm, dep.bearing, arr.endUtm, arr.bearing, radius, Ld, La, transitionType,
      )
      if (result && !result.error) {
        validationErr = validateSpliceTangents(result, dep.startUtm, result.reverseArr ? arr.startUtm : arr.endUtm, result.reverseArr)
      }
    }
    if (!result || result.error || validationErr) {
      return { error: result?.error ?? validationErr ?? 'splice_error_parallel' }
    }
    return { result, arcMode, Ld, La }
  }, [phase, picks, radius, clothoidEnabled, clothoidDep, clothoidArr, transitionType])

  // What the panel reports about it — the picking phases have their own message.
  const configStatus = useMemo(() => {
    if (!splice) return null
    if (splice.error) return { msg: t(splice.error), error: true }
    const { result, arcMode, Ld, La } = splice
    const tr = (Ld > 0 || La > 0) ? ` | ${t('transition_curve')}: ${Ld}+${La} m` : ''
    if (arcMode) {
      return { msg: `${t('splice_arrival')} ↔ ${t('splice_departure')}: ~${result.straightLength.toFixed(1)} m${tr}`, error: false }
    }
    return { msg: `${t('splice_arc_length')}: ~${result.arcLength.toFixed(1)} m${tr} | ${result.curveSide}`, error: false }
  }, [splice, t])

  const status    = phase === 'config' ? configStatus : selectStatus
  const canCommit = !!splice?.result

  // Preview of the spliced geometry.
  useEffect(() => {
    const src = map?.current?.getSource(SPLICE_PREVIEW_SOURCE)
    if (!src) return
    src.setData(splice?.result ? buildPreviewGeoJSON(splice.result.previewCoords) : EMPTY_FC)
  }, [splice, map])

  const clearPreview = () => {
    if (!map?.current) return
    map.current.getSource(SPLICE_PREVIEW_SOURCE)?.setData(EMPTY_FC)
  }

  const handleCancel = () => {
    clearPreview()
    setPhase('select_first')
    setPicks([])
    setStatus(null)
  }

  const handleCommit = () => {
    const arc = splice?.result
    if (!arc) return

    const [dep, arr] = picks
    const tracks = loadTracks(project.id)
    const depTrack = tracks.find(t => t.id === dep.trackId)
    const arrTrack = tracks.find(t => t.id === arr.trackId)
    if (!depTrack || !arrTrack) return

    // ── Arc + arc → straight connector ────────────────────────────────────
    if (dep.signedR != null && arr.signedR != null) {
      // Reshaped arcs keep their original speed; the new straight + clothoids
      // take the panel's speed.
      const depOrig   = depTrack.elements[dep.elIdx]
      const arrOrig   = arrTrack.elements[arr.elIdx]
      // A re-shaped arc keeps its cant as well; the arrival arc is folded in
      // backwards, so the magnitude is re-signed from the rebuilt radius.
      const keepCant  = (el, orig) => (orig?.cant != null && el.radius != null)
        ? { ...el, cant: cantSign(el.radius) * Math.abs(orig.cant) }
        : el
      const depPrefix = depTrack.elements.slice(0, dep.elIdx).map(el => ({ ...el }))
      const mid       = arc.elements.map((el, i, a) =>
        i === 0            ? keepCant({ ...el, speed: depOrig?.speed ?? speed }, depOrig)
        : i === a.length-1 ? keepCant({ ...el, speed: arrOrig?.speed ?? speed }, arrOrig)
        :                    { ...el, speed })
      const arrPrefix = arrTrack.elements.slice(0, arr.elIdx).reverse().map(reverseElement)

      const mergedId       = generateId()
      const mergedElements = recalcAbsLengths([...depPrefix, ...mid, ...arrPrefix])
      const mergedTrack    = {
        ...depTrack,
        id:          mergedId,
        elements:    mergedElements,
        coordinates: rebuildCoords(mergedElements),
        ...spliceHeights(depTrack, dep.elIdx),
      }
      const newTracks = tracks
        .filter(t => t.id !== dep.trackId && t.id !== arr.trackId)
        .concat(mergedTrack)

      replaceAllTracks(project.id, newTracks)
      // arrPrefix is folded in reversed, so the arrival track's BEGIN becomes
      // the merged track's END; the departure side keeps its direction.
      remapSwitchTrackIds(project.id, [
        { oldId: dep.trackId, newId: mergedId },
        { oldId: arr.trackId, newId: mergedId, flip: true },
      ])
      onTrackSaved?.()
      clearPreview()
      setPhase('select_first')
      setPicks([])
      setStatus(null)
      return
    }

    const trackZone = depTrack.epsg
    const Ld = clothoidEnabled ? arc.clothoidDepLength : 0
    const La = clothoidEnabled ? arc.clothoidArrLength : 0

    // ── Departure side: shorten last element to clothoid start (or arc start) ─
    const depElements  = depTrack.elements.slice(0, dep.elIdx).map(el => ({ ...el }))
    const depOrigEl    = depTrack.elements[dep.elIdx]
    const depOrigStart = depOrigEl.geometry.coordinates[0]                   // WGS84, for the drawn geometry
    const depOrigStartUtm = nodeUtm(depOrigEl.startNode, depOrigStart, trackZone)
    const svDep = computeStraightValuesUtm(depOrigStartUtm, arc.depClStartUtm)
    depElements.push({
      ...depOrigEl,
      length:    svDep.length,
      bearing:   svDep.bearing,
      startNode: svDep.startNode,
      endNode:   svDep.endNode,
      geometry:  { type: 'LineString', coordinates: [depOrigStart, arc.depTangentWgs] },
    })

    // ── Entry clothoid (if Ld > 0) ────────────────────────────────────────
    if (Ld > 0) {
      const s = arc.depClStartUtm
      const e = arc.arcStartUtm
      depElements.push({
        elementType: 2,
        transitionType: arc.transitionType,
        r1:        null,
        r2:        arc.signedR,
        bearing:   arc.depBearing,
        endBearing: arc.arcStartBearing,
        length:    Ld,
        absLength: Ld,
        speed,
        startNode: [s.easting, s.northing],
        endNode:   [e.easting, e.northing],
        geometry:     { type: 'LineString', coordinates: arc.depClothoidCoords },
        renderCoords: arc.depClothoidCoordsRender,
      })
    }

    // ── Circular arc ──────────────────────────────────────────────────────
    const arcStartUtm = Ld > 0 ? arc.arcStartUtm : arc.depClStartUtm
    const arcEndUtm   = La > 0 ? arc.arcEndUtm   : arc.arrClEndUtm
    const cv = computeCurvedValuesUtm(arcStartUtm, arcEndUtm, arc.signedR)
    const arcEl = {
      elementType: 1,
      startNode:  cv.startNode,
      endNode:    cv.endNode,
      bearing:    cv.bearing,
      length:     cv.length,
      absLength:  cv.length,
      speed,
      cant:       cantSign(arc.signedR) * Math.abs(cant),
      endBearing: cv.endBearing,
      radius:     arc.signedR,
      geometry:     { type: 'LineString', coordinates: arc.arcCoords },
      renderCoords: arc.arcCoordsRender,
    }

    const allElements = [...depElements, arcEl]

    // ── Exit clothoid (if La > 0) ─────────────────────────────────────────
    if (La > 0) {
      const s = arc.arcEndUtm
      const e = arc.arrClEndUtm
      allElements.push({
        elementType: 2,
        transitionType: arc.transitionType,
        r1:        arc.signedR,
        r2:        null,
        bearing:   arc.arcEndBearing,
        endBearing: arc.exitBearing,
        length:    La,
        absLength: La,
        speed,
        startNode: [s.easting, s.northing],
        endNode:   [e.easting, e.northing],
        geometry:     { type: 'LineString', coordinates: arc.arrClothoidCoords },
        renderCoords: arc.arrClothoidCoordsRender,
      })
    }

    // ── Arrival side ─────────────────────────────────────────────────────
    // Reversed (corner): join at the arrival END, reshape back to its start, and
    // keep the elements before it (reversed). Forward (continuation): join at the
    // arrival START, reshape forward to its end, and keep the elements after it.
    const arrOrigEl    = arrTrack.elements[arr.elIdx]
    const arrCoordsEl  = arrOrigEl.geometry.coordinates
    const arrJoinWgs   = arc.reverseArr ? arrCoordsEl[0] : arrCoordsEl[arrCoordsEl.length - 1]
    const arrJoinUtm   = nodeUtm(arc.reverseArr ? arrOrigEl.startNode : arrOrigEl.endNode, arrJoinWgs, trackZone)
    const svArr        = computeStraightValuesUtm(arc.arrClEndUtm, arrJoinUtm)
    const arrEl = {
      ...arrOrigEl,
      length:    svArr.length,
      bearing:   svArr.bearing,
      startNode: svArr.startNode,
      endNode:   svArr.endNode,
      geometry:  { type: 'LineString', coordinates: [arc.arrTangentWgs, arrJoinWgs] },
    }
    const arrTail = arc.reverseArr
      ? arrTrack.elements.slice(0, arr.elIdx).reverse().map(reverseElement)
      : arrTrack.elements.slice(arr.elIdx + 1).map(el => ({ ...el }))

    const mergedId       = generateId()
    const mergedElements = recalcAbsLengths([...allElements, arrEl, ...arrTail])
    const mergedTrack    = {
      ...depTrack,
      id:          mergedId,
      elements:    mergedElements,
      coordinates: rebuildCoords(mergedElements),
      ...spliceHeights(depTrack, dep.elIdx),
    }

    const newTracks = tracks
      .filter(t => t.id !== dep.trackId && t.id !== arr.trackId)
      .concat(mergedTrack)

    replaceAllTracks(project.id, newTracks)
    // Reversed join (a corner): the arrival tail is folded in backwards, so its
    // BEGIN/END swap. Forward join (a continuation): its direction is kept.
    remapSwitchTrackIds(project.id, [
      { oldId: dep.trackId, newId: mergedId },
      { oldId: arr.trackId, newId: mergedId, flip: arc.reverseArr },
    ])
    onTrackSaved?.()
    clearPreview()
    setPhase('select_first')
    setPicks([])
    setStatus(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (phase === 'config') {
    const [departure, arrival] = picks
    const bothArcs = departure?.signedR != null && arrival?.signedR != null
    // Only the inserted arc takes a cant; an arc+arc splice re-shapes the two
    // existing arcs, which keep theirs.
    const cantDef = computeCantDef(speed, radius, cant)
    const defErr  = !bothArcs && cantDef > MAX_CANT_DEF
    return (
      <>
        <h2>{t('splice_element')}</h2>
        <div className="element-form">
          <div className="form-field">
            <label>{t('splice_departure')}</label>
            <input type="text" readOnly value={departure?.label ?? ''} />
          </div>
          <div className="form-field">
            <label>{t('splice_arrival')}</label>
            <input type="text" readOnly value={arrival?.label ?? ''} />
          </div>
          {!bothArcs && (
            <div className="form-field">
              <label>{t('field_radius')}</label>
              <input
                type="number" min="1" value={radius}
                onChange={e => setRadius(Number(e.target.value))}
              />
            </div>
          )}
          <div className="form-field">
            <label>{t('field_speed')}</label>
            <input
              type="number" min="0" value={speed}
              onChange={e => setSpeed(Number(e.target.value))}
            />
          </div>
          {!bothArcs && (
            <>
              <div className="form-field">
                <label>{t('cant')}</label>
                <input
                  type="number" min={0} max={MAX_CANT} step={CANT_STEP} value={cant}
                  onChange={e => setCant(roundCant(Math.max(0, Math.min(MAX_CANT, Number(e.target.value) || 0))))}
                />
              </div>
              <div className="form-field">
                <label>{t('cant_def')}</label>
                <input type="number" readOnly value={cantDef} />
              </div>
            </>
          )}
          <label className="transition-curve-row">
            <input
              type="checkbox" checked={clothoidEnabled}
              onChange={e => setClothoidEnabled(e.target.checked)}
            />
            <span>{t('transition_curve')}</span>
          </label>
          {clothoidEnabled && (
            <>
              <div className="form-field">
                <label>{t('type')}</label>
                <select value={transitionType} onChange={e => setTransitionType(e.target.value)}>
                  <option value="clothoid">{t('transition_type_clothoid')}</option>
                  <option value="bloss">{t('transition_type_bloss')}</option>
                </select>
              </div>
              <div className="form-field">
                <label>{t('splice_departure')} – {t('field_length')}</label>
                <input
                  type="number" min="1" step="10" value={clothoidDep}
                  onChange={e => setClothoidDep(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <div className="form-field">
                <label>{t('splice_arrival')} – {t('field_length')}</label>
                <input
                  type="number" min="1" step="10" value={clothoidArr}
                  onChange={e => setClothoidArr(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </>
          )}
        </div>
        {status && (
          <p style={{ color: status.error ? '#e74c3c' : '#5b9bd5', fontSize: 12, marginTop: 4 }}>
            {status.msg}
          </p>
        )}
        {defErr && <p className="form-error">{t('cant_def_error')}</p>}
        <button
          className="panel-btn panel-btn-full"
          style={{ marginTop: 8, opacity: (canCommit && !defErr) ? 1 : 0.5 }}
          onClick={handleCommit}
          disabled={!canCommit || defErr}
        >
          {t('btn_commit')}
        </button>
        <button
          className="panel-btn panel-btn-full"
          style={{ marginTop: 2, background: '#888' }}
          onClick={handleCancel}
        >
          {t('btn_cancel')}
        </button>
      </>
    )
  }

  // select_first / select_second
  return (
    <>
      <h2>{t('splice_element')}</h2>
      <p>{phase === 'select_first' ? t('splice_hint_first') : t('splice_hint_second')}</p>
      {picks.length > 0 && (
        <p style={{ fontSize: 12, color: '#5b9bd5', marginTop: 4 }}>
          {t('splice_first_selected')}: {picks[0].label}
        </p>
      )}
      {status && (
        <p style={{ color: status.error ? '#e74c3c' : '#888', fontSize: 12, marginTop: 4 }}>
          {status.msg}
        </p>
      )}
      {phase === 'select_second' && (
        <button className="panel-btn panel-btn-full" style={{ marginTop: 8, background: '#888' }} onClick={handleCancel}>
          {t('btn_cancel')}
        </button>
      )}
    </>
  )
}
