import { useEffect, useRef, useState } from 'react'
import { loadTracks, loadSwitches, commitTrackEdit } from '../../../storage'
import { projectOnBearingUtm, nodeUtm } from '../../../utils/elementUtils'
import { wgs84ToUTM } from '../../../utils/coordinateUtils'
import { FILTER_NONE, HIT_TOLERANCE, ZOOM_ICON_SIZE, ZOOM_LINE_WIDTH, filterForElement } from '../../../utils/mapConstants'
import { ensureMarkerImages, ARROW_ICON_IMAGE } from '../../../utils/markerImages'
import usePreviewLayers from '../../../hooks/usePreviewLayers'
import {
  EDIT_MARKER_SOURCE, EDIT_MARKER_LAYER, EDIT_LINES_SOURCE, EDIT_LINES_LAYER,
  planElementChange, buildLineFeatures, buildMarkerFeatures,
} from './editGeometry'

// Layer definitions for usePreviewLayers
const EDIT_PREVIEW_LAYERS = [
  {
    sourceId: EDIT_LINES_SOURCE,
    layer: {
      id: EDIT_LINES_LAYER,
      type: 'line',
      paint: {
        'line-color': '#ff8c00',
        'line-width': ZOOM_LINE_WIDTH,
      },
    },
  },
  {
    sourceId: EDIT_MARKER_SOURCE,
    layer: {
      id: EDIT_MARKER_LAYER,
      type: 'symbol',
      layout: {
        'icon-image': ARROW_ICON_IMAGE,
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-size': ZOOM_ICON_SIZE,
      },
      paint: { 'icon-color': '#ff8c00' },
    },
  },
]

export default function EditLengthForm({ t, map, project, onCommitted, onTrackSaved }) {
  const [workingTracks, setWorkingTracks] = useState(() => loadTracks(project.id))
  const [selectedTrackId, setSelectedTrackId] = useState(null)
  const [selectedElIdx, setSelectedElIdx] = useState(null)
  const [phase, setPhase] = useState('select')
  // The last dry run of the drag: what it would reach, and why it is refused.
  const [plan, setPlan] = useState(null)

  const workingRef  = useRef(workingTracks)
  const planRef     = useRef(null)
  const selectedRef = useRef({ trackId: null, elIdx: null })
  const startUtmRef = useRef(null)   // element start in the track's plane
  const bearingRef  = useRef(null)

  useEffect(() => { workingRef.current = workingTracks }, [workingTracks])
  useEffect(() => { selectedRef.current = { trackId: selectedTrackId, elIdx: selectedElIdx } }, [selectedTrackId, selectedElIdx])

  // The preview's arrows are the track markers, recoloured by the layer.
  useEffect(() => {
    if (map?.current) ensureMarkerImages(map.current)
  }, [map])

  // Setup / cleanup preview layers
  usePreviewLayers(map, EDIT_PREVIEW_LAYERS, { resetFilters: ['tracks-selected-layer'], resetCursor: true })

  // Update preview lines and markers when working tracks change
  useEffect(() => {
    if (!map?.current) return
    const m = map.current
    m.getSource(EDIT_LINES_SOURCE)?.setData(buildLineFeatures(workingTracks))
    m.getSource(EDIT_MARKER_SOURCE)?.setData(buildMarkerFeatures(workingTracks))
  }, [workingTracks, map])

  // Phase: select element
  useEffect(() => {
    if (phase !== 'select' || !map?.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'pointer'

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: [EDIT_MARKER_LAYER] })
      if (features.length === 0) {
        setSelectedTrackId(null)
        setSelectedElIdx(null)
        m.setFilter('tracks-selected-layer', FILTER_NONE)
        return
      }
      const { trackId, elementIndex } = features[0].properties
      const elIdx = Number(elementIndex)
      setSelectedTrackId(trackId)
      setSelectedElIdx(elIdx)
      m.setFilter('tracks-selected-layer', filterForElement(trackId, elIdx))

      const track = workingRef.current.find(t => t.id === trackId)
      const el = track?.elements?.[elIdx]
      if (!el) return
      startUtmRef.current = nodeUtm(el.startNode, el.geometry.coordinates[0], track.epsg)
      bearingRef.current  = el.bearing
      planRef.current = null
      setPlan(null)
      setPhase('adjusting')
    }

    m.on('click', onClick)
    return () => { m.off('click', onClick); m.getCanvas().style.cursor = '' }
  }, [phase, map])

  // Phase: adjust length interactively
  useEffect(() => {
    if (phase !== 'adjusting' || !map?.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'crosshair'

    const onMove = (e) => {
      const start    = startUtmRef.current
      const mouseUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], start.zone)
      const { along } = projectOnBearingUtm(start, mouseUtm, bearingRef.current)
      if (along <= 0) return
      const { trackId, elIdx } = selectedRef.current
      if (!trackId || elIdx === null) return
      // The drag shows what the change would do even where it reaches too far;
      // the reach is reported beside it, and the commit is what refuses.
      const next = planElementChange(
        workingRef.current, loadSwitches(project.id), trackId, elIdx, { length: along })
      planRef.current = next
      setPlan(next)
      setWorkingTracks(next.tracks)
    }

    const onClick = () => {
      m.getCanvas().style.cursor = 'pointer'
      setPhase('select')
    }

    m.on('mousemove', onMove)
    m.on('click', onClick)
    return () => {
      m.off('mousemove', onMove)
      m.off('click', onClick)
      m.getCanvas().style.cursor = ''
    }
  }, [phase, map, project.id])

  const handleCommit = () => {
    const last = planRef.current
    if (last?.error) return
    commitTrackEdit(project.id, workingRef.current, last?.touchedSwitchIds ?? [])
    onTrackSaved?.()
    onCommitted?.()
  }

  return (
    <>
      {phase === 'select' && <p>{t('edit_element_hint')}</p>}
      {phase === 'adjusting' && selectedTrackId !== null && (
        <p>{t('edit_element_selected')}: <code>{selectedTrackId}[{selectedElIdx}]</code></p>
      )}
      {plan?.error && <p className="form-error">{t(plan.error)}</p>}
      {!plan?.error && plan && plan.touchedTrackIds.length > 1 && (
        <p className="selecting-hint">
          {t('table_edit_reach')
            .replace('{{tracks}}', String(plan.touchedTrackIds.length))
            .replace('{{switches}}', String(plan.touchedSwitchIds.length))}
        </p>
      )}
      <button className="panel-btn panel-btn-full" style={{ marginTop: 8, opacity: plan?.error ? 0.5 : 1 }}
        onClick={handleCommit} disabled={!!plan?.error}>
        {t('btn_commit')}
      </button>
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onCommitted}>
        {t('btn_cancel')}
      </button>
    </>
  )
}
