import { useEffect, useRef, useState } from 'react'
import { loadTracks, loadSwitches, commitTrackEdit } from '../../../storage'
import { projectOnBearingUtm, nodeUtm } from '../../../utils/elementUtils'
import { wgs84ToUTM } from '../../../utils/coordinateUtils'
import { ZOOM_ICON_SIZE, ZOOM_LINE_WIDTH } from '../../../utils/mapConstants'
import { ensureMarkerImages, ARROW_ICON_IMAGE } from '../../../utils/markerImages'
import {
  EDIT_MARKER_SOURCE, EDIT_MARKER_LAYER, EDIT_LINES_SOURCE, EDIT_LINES_LAYER,
  planElementChange, buildLineFeatures, buildMarkerFeatures,
} from './editGeometry'
import { useI18n } from '../../../locales/i18nContext'
import { useMap } from '../../../map/MapContext'
import usePreview from '../../../map/usePreview'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'
import useMapEvents from '../../../map/useMapEvents'
import { PALETTE } from '../../../styles/palette'
import CommitBar from '../../form/CommitBar'

// Layer definitions for usePreview
const EDIT_PREVIEW_LAYERS = [
  {
    sourceId: EDIT_LINES_SOURCE,
    layer: {
      id: EDIT_LINES_LAYER,
      type: 'line',
      paint: {
        'line-color': PALETTE.mapHover,
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
      paint: { 'icon-color': PALETTE.mapHover },
    },
  },
]

const EDIT_PICK_LAYERS = [EDIT_MARKER_LAYER]

export default function EditLengthForm({ onCommitted }) {
  const { t, fill } = useI18n()
  const map = useMap()
  const [workingTracks, setWorkingTracks] = useState(() => loadTracks())
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
  const preview = usePreview(EDIT_PREVIEW_LAYERS)

  // Update preview lines and markers when working tracks change
  useEffect(() => {
    preview.set(EDIT_LINES_SOURCE, buildLineFeatures(workingTracks))
    preview.set(EDIT_MARKER_SOURCE, buildMarkerFeatures(workingTracks))
  }, [workingTracks, preview])

  // Phase: select element — by its arrow on the preview layer.
  useMapPick({
    active: phase === 'select', layers: EDIT_PICK_LAYERS,
    onPick: ({ trackId, elementIndex: elIdx }) => {
      setSelectedTrackId(trackId)
      setSelectedElIdx(elIdx)
      const track = workingRef.current.find(tr => tr.id === trackId)
      const el = track?.elements?.[elIdx]
      if (!el) return
      startUtmRef.current = nodeUtm(el.startNode, el.geometry.coordinates[0], track.epsg)
      bearingRef.current  = el.bearing
      planRef.current = null
      setPlan(null)
      setPhase('adjusting')
    },
    onMiss: () => { setSelectedTrackId(null); setSelectedElIdx(null) },
  })
  useSelectedOnMap(selectedTrackId === null ? null : { trackId: selectedTrackId, elementIndex: selectedElIdx })

  // Phase: adjust the length with the cursor; a click ends it.
  useMapEvents(phase === 'adjusting', {
    mousemove: (e) => {
      const start    = startUtmRef.current
      const mouseUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], start.zone)
      const { along } = projectOnBearingUtm(start, mouseUtm, bearingRef.current)
      if (along <= 0) return
      const { trackId, elIdx } = selectedRef.current
      if (!trackId || elIdx === null) return
      // The drag shows what the change would do even where it reaches too far;
      // the reach is reported beside it, and the commit is what refuses.
      const next = planElementChange(
        workingRef.current, loadSwitches(), trackId, elIdx, { length: along })
      planRef.current = next
      setPlan(next)
      setWorkingTracks(next.tracks)
    },
    click: () => setPhase('select'),
  }, { cursor: 'crosshair' })

  const handleCommit = () => {
    const last = planRef.current
    if (last?.error) return
    commitTrackEdit(workingRef.current, last?.touchedSwitchIds ?? [])
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
          {fill('table_edit_reach', { tracks: String(plan.touchedTrackIds.length), switches: String(plan.touchedSwitchIds.length) })}
        </p>
      )}
      <CommitBar onCommit={handleCommit} onCancel={onCommitted} disabled={!!plan?.error} />
    </>
  )
}
