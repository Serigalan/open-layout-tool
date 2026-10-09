import { useEffect, useRef } from 'react'
import { useMap } from './MapContext'
import { mapIsLive } from './pick'

/**
 * Listen to the map while `active` (R3.1): `handlers` is { click, mousemove,
 * … } — MapLibre event names to functions (event, map). The latest handlers
 * are always the ones called, so they need not be memoized; the listeners are
 * registered once per activation. `cursor` is set on the canvas while active
 * and taken back after; `resetCursor` only takes it back (for handlers that
 * set it themselves as the mouse moves).
 *
 * What draws on the map from a click — placing points, dragging a length —
 * goes through this; what picks a track or a switch goes through useMapPick.
 */
export default function useMapEvents(active, handlers, { cursor = null, resetCursor = false } = {}) {
  const mapRef = useMap()
  const latest = useRef(handlers)
  useEffect(() => { latest.current = handlers })
  const names = Object.keys(handlers).sort().join(',')

  useEffect(() => {
    const m = active ? mapRef.current : null
    if (!m) return undefined
    const bound = names.split(',').filter(Boolean).map((name) => {
      const fn = (e) => latest.current[name]?.(e, m)
      m.on(name, fn)
      return [name, fn]
    })
    if (cursor) m.getCanvas().style.cursor = cursor
    return () => {
      for (const [name, fn] of bound) m.off(name, fn)
      if ((cursor || resetCursor) && mapIsLive(mapRef, m)) m.getCanvas().style.cursor = ''
    }
  }, [mapRef, active, names, cursor, resetCursor])
}
