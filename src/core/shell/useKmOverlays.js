import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { showKmOverlays } from '../map/kmLineLayer'
import { LOCAL_KM_FIRST_LAYER, showLocalKmLines } from '../map/localKmLayer'
import { loadSettings, saveSettings } from '../utils/common'
import { hiddenKmLines, setKmLinesHidden } from '../storage'
import { useHiddenKmLines } from '../hooks/useStore'
import { PLATFORMS_FILL_LAYER, TRACKS_LAYER } from '../map/layerIds'

/** Where the DB overlays go: underneath the project's lines, wherever the two run together. */
const belowLocal = (m) => (m.getLayer(LOCAL_KM_FIRST_LAYER) ? LOCAL_KM_FIRST_LAYER : PLATFORMS_FILL_LAYER)

/** The project's lines `lines` drawn — once the project is on the map, which is when the style can take layers. */
function drawLocal(mapRef, lines) {
  const m = mapRef.current
  if (m?.getLayer(TRACKS_LAYER)) showLocalKmLines(m, lines, { beforeId: PLATFORMS_FILL_LAYER })
}

/**
 * The kilometrage overlays on the map — the DB network, what lies outside it,
 * and the project's own lines (`local`, decision 354) — each on or off, and
 * whether the DB tile archive turned out to be missing (a deploy without the
 * data folder). Of the project's lines `kmLines`, those hidden on this device
 * (Gleise ein-/ausblenden) stay off; `localLines` is what is drawn.
 * `restore()` puts them back on a style that has just loaded: setStyle throws
 * the whole style away.
 */
export default function useKmOverlays(map, kmLines) {
  const [kmOverlays, setState] = useState(() => {
    const s = loadSettings()
    return { db: s.kmLines ?? true, other: s.kmLinesOther ?? false, local: s.kmLinesLocal ?? false }
  })
  const [kmLinesError, setKmLinesError] = useState(false)
  const hiddenKm = useHiddenKmLines()
  const localLines = useMemo(() => (kmOverlays.local
    ? (kmLines ?? []).filter(l => !hiddenKm.has(String(l.lineNumber)))
    : []), [kmOverlays.local, kmLines, hiddenKm])
  // What the map callbacks read.
  const current = useRef(kmOverlays)
  const shownLocal = useRef(localLines)
  const allLocal = useRef(kmLines)
  useEffect(() => { allLocal.current = kmLines }, [kmLines])

  const restore = useCallback(() => {
    if (!map.current) return
    showKmOverlays(map.current, current.current, {
      beforeId: belowLocal(map.current),
      onError: () => setKmLinesError(true),
    })
    showLocalKmLines(map.current, shownLocal.current, { beforeId: PLATFORMS_FILL_LAYER })
  }, [map])

  // A line hidden or shown, the project's lines changed: drawn again.
  useEffect(() => {
    shownLocal.current = localLines
    drawLocal(map, localLines)
  }, [localLines, map])

  const setKmOverlay = useCallback((key, on) => {
    const next = { ...current.current, [key]: on }
    current.current = next
    setState(next)
    saveSettings({ kmLines: next.db, kmLinesOther: next.other, kmLinesLocal: next.local })
    if (on && key !== 'local') setKmLinesError(false)
    // Switched on with every line hidden would show nothing: they all come back.
    if (on && key === 'local') {
      const numbers = (allLocal.current ?? []).map(l => String(l.lineNumber))
      const hidden = hiddenKmLines()
      if (numbers.length && numbers.every(n => hidden.has(n))) setKmLinesHidden(numbers, false)
    }
    // Not loaded yet: the style.load handler will pick it up.
    if (key !== 'local' && map.current?.isStyleLoaded()) restore()
  }, [restore, map])

  return { kmOverlays, kmLinesError, setKmOverlay, restore, localLines }
}
