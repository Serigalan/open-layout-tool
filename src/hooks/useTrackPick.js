import { useEffect, useRef } from 'react'
import { elementUnderPoint, filterForTrack, FILTER_NONE, mapIsLive } from '../utils/mapConstants'

const HOVER_LAYER = 'tracks-hover-layer'

/**
 * Hook: picking a track on the map. While `active`, a click hands
 * `onPick({ trackId, elementIndex })` whatever lies under it, and the cursor
 * turns into a pointer wherever something does.
 *
 * `prefer` settles an overlap in favour of one track — the one already open in
 * the editor. `highlight` draws the whole track under the cursor on the hover
 * layer, which is what picking a *track* wants, as against picking one row of
 * one; it stays off where something else already owns that layer.
 */
export default function useTrackPick(map, active, onPick, { prefer = null, highlight = false } = {}) {
  const onPickRef = useRef(onPick)
  useEffect(() => { onPickRef.current = onPick }, [onPick])

  useEffect(() => {
    const m = active ? map?.current : null
    if (!m) return

    const onClick = (e) => {
      const hit = elementUnderPoint(m, e.point, prefer)
      if (hit) onPickRef.current(hit)
    }

    const onMove = (e) => {
      const hit = elementUnderPoint(m, e.point, prefer)
      m.getCanvas().style.cursor = hit ? 'pointer' : ''
      if (highlight && m.getLayer(HOVER_LAYER)) {
        m.setFilter(HOVER_LAYER, hit ? filterForTrack(hit.trackId) : FILTER_NONE)
      }
    }

    m.on('click', onClick)
    m.on('mousemove', onMove)
    return () => {
      m.off('click', onClick)
      m.off('mousemove', onMove)
      // Whoever takes the layer next says what it shows — this only gives back
      // what it borrowed, and only while there is still a map to give it to.
      if (!mapIsLive(map, m)) return
      m.getCanvas().style.cursor = ''
      if (highlight && m.getLayer(HOVER_LAYER)) m.setFilter(HOVER_LAYER, FILTER_NONE)
    }
  }, [map, active, prefer, highlight])
}
