import { useCallback, useRef, useState } from 'react'
import { showKmOverlays } from '../utils/kmLineLayer'
import { loadSettings, saveSettings } from '../utils/settings'

/**
 * The DB kilometrage overlays on the map — the DB network, and what lies
 * outside it — each on or off, and whether their tile archive turned out to be
 * missing (a deploy without the data folder). `restore()` puts them back on a
 * style that has just loaded: setStyle throws the whole style away.
 */
export default function useKmOverlays(map) {
  const [kmOverlays, setState] = useState(() => {
    const s = loadSettings()
    return { db: s.kmLines ?? true, other: s.kmLinesOther ?? false }
  })
  const [kmLinesError, setKmLinesError] = useState(false)
  // What the map callbacks read.
  const current = useRef(kmOverlays)

  const restore = useCallback(() => {
    if (!map.current) return
    showKmOverlays(map.current, current.current, {
      beforeId: 'platforms-fill-layer',
      onError: () => setKmLinesError(true),
    })
  }, [map])

  const setKmOverlay = useCallback((key, on) => {
    const next = { ...current.current, [key]: on }
    current.current = next
    setState(next)
    saveSettings({ kmLines: next.db, kmLinesOther: next.other })
    if (on) setKmLinesError(false)
    // Not loaded yet: the style.load handler will pick it up.
    if (map.current?.isStyleLoaded()) restore()
  }, [restore, map])

  return { kmOverlays, kmLinesError, setKmOverlay, restore }
}
