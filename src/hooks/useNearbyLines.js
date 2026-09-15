import { useEffect, useState } from 'react'
import { nearbyLineNumbers } from '../utils/kmLineLayer'
import { mapIsLive } from '../utils/mapConstants'

/**
 * Hook: the line numbers the kilometrage overlay shows around the current
 * view, for a form to offer instead of asking for the number to be typed.
 *
 * It follows the view, because the answer depends on where the user is about
 * to draw — and stays empty while the overlay is off, which is what makes the
 * field itself keep working as a plain input.
 */
export default function useNearbyLines(map) {
  const [lines, setLines] = useState([])

  useEffect(() => {
    if (!map?.current) return
    const m = map.current
    const read = () => {
      if (!mapIsLive(map, m) || !m.isStyleLoaded()) return
      setLines(nearbyLineNumbers(m))
    }
    read()
    m.on('idle', read)
    return () => { m.off('idle', read) }
  }, [map])

  return lines
}
