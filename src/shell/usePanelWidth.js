import { useState } from 'react'
import { loadSettings, saveSettings } from '../utils/settings'
import { clamp } from '../utils/format'

/** How wide the panel may be dragged [px]. */
const MIN = 260
const MAX = 620

/**
 * The panel's width and whether it is folded away (R10.9), both remembered on
 * this device. `null` width keeps what the stylesheet gives it (narrower on a
 * small screen). Folded away, the panel stays mounted: a form keeps what was
 * typed into it.
 */
export default function usePanelWidth() {
  const [width, setWidth] = useState(() => loadSettings().panelWidth ?? null)
  const [folded, setFolded] = useState(false)

  const onResizeStart = (e) => {
    const panel = e.currentTarget.parentElement
    const startX = e.clientX, startW = panel?.getBoundingClientRect().width ?? 320
    let last = startW
    const move = (ev) => { last = clamp(startW + ev.clientX - startX, MIN, MAX); setWidth(last) }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      saveSettings({ panelWidth: Math.round(last) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    e.preventDefault()
  }
  const resetWidth = () => { setWidth(null); saveSettings({ panelWidth: null }) }

  return { width, folded, setFolded, onResizeStart, resetWidth }
}
