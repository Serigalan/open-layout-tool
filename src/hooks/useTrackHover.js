import { useEffect } from 'react'
import { loadTracks } from '../storage'
import { FILTER_NONE, HIT_TOLERANCE, filterForElement, mapIsLive } from '../utils/mapConstants'

/**
 * Hook: highlights the hovered element on the tracks-hover-layer.
 * Active only when `phase === selectPhase`.
 */
export default function useTrackHover(map, phase, selectPhase, project, excludeSwitchBranch = false) {
  useEffect(() => {
    if (phase !== selectPhase || !map?.current) return
    const m = map.current

    const onMove = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })
      const feature = features.find(f => {
        if (!excludeSwitchBranch || !project) return true
        const { trackId, elementIndex } = f.properties
        const track = loadTracks(project.id).find(t => t.id === trackId)
        const el = track?.elements?.[Number(elementIndex)]
        return !el?.switchBranch
      })
      if (feature) {
        const { trackId, elementIndex } = feature.properties
        m.setFilter('tracks-hover-layer', filterForElement(trackId, elementIndex))
        m.getCanvas().style.cursor = 'pointer'
      } else {
        m.setFilter('tracks-hover-layer', FILTER_NONE)
        m.getCanvas().style.cursor = 'default'
      }
    }

    m.on('mousemove', onMove)
    return () => {
      m.off('mousemove', onMove)
      if (!mapIsLive(map, m)) return
      if (m.getLayer('tracks-hover-layer')) {
        m.setFilter('tracks-hover-layer', FILTER_NONE)
      }
    }
  }, [phase, map, selectPhase, project, excludeSwitchBranch])
}
