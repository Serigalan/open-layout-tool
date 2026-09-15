import { useEffect, useRef } from 'react'
import { loadTracks } from '../storage'
import { resolveEndBearing } from '../utils/elementUtils'
import { wgs84ToUTM, epsgForLngLat } from '../utils/coordinateUtils'
import { setMarkerData } from '../utils/mapRenderUtils'
import { FILTER_NONE, HIT_TOLERANCE, filterForElement } from '../utils/mapConstants'

/**
 * Hook: lets the user click a track element on the map.
 * Calls `onSelected(track, endWgs, elBearing)` once an element is picked,
 * then advances phase to `nextPhase`.
 */
export default function useElementSelection(map, project, phase, setPhase, nextPhase, onSelected) {
  const onSelectedRef = useRef(onSelected)
  useEffect(() => { onSelectedRef.current = onSelected }, [onSelected])

  useEffect(() => {
    if (phase !== 'select' || !map?.current) return
    const m = map.current

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })
      if (features.length === 0) return

      const trackId = features[0].properties.trackId
      m.setFilter('tracks-hover-layer', FILTER_NONE)

      const tracks = loadTracks(project.id)
      const track = tracks.find(tr => tr.id === trackId)
      if (!track || !track.elements || track.elements.length === 0) return

      const lastElIdx = track.elements.length - 1
      const lastEl = track.elements[lastElIdx]
      m.setFilter('tracks-selected-layer', filterForElement(trackId, lastElIdx))

      const endCoords = lastEl.geometry?.coordinates
      if (!endCoords || endCoords.length === 0) return

      const markerWgs = endCoords[endCoords.length - 1]
      const elBearing = resolveEndBearing(lastEl, track.epsg)

      // Return UTM from stored endNode – avoids repeated zone-detection on every element
      let endUtm
      if (lastEl.endNode && track.epsg) {
        endUtm = { easting: lastEl.endNode[0], northing: lastEl.endNode[1], zone: track.epsg }
      } else {
        const u = wgs84ToUTM(markerWgs, track.epsg || epsgForLngLat(markerWgs))
        endUtm = { easting: u.easting, northing: u.northing, zone: u.zone }
      }

      onSelectedRef.current(track, endUtm, elBearing, lastEl)
      setMarkerData(m, [markerWgs])
      m.getCanvas().style.cursor = ''
      m.off('click', onClick)
      setPhase(nextPhase)
    }

    m.on('click', onClick)
    return () => {
      m.off('click', onClick)
      m.getCanvas().style.cursor = ''
    }
  }, [phase, map, project, setPhase, nextPhase])
}
