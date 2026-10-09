import { useState } from 'react'
import { loadSettings, saveSettings } from '../utils/settings'
import { clamp } from '../utils/format'

/** How wide the panel may be dragged [px]. */
const MIN = 260
const MAX = 620

/**
 * The panel's width (R10.9), remembered on this device. `null` keeps what the
 * stylesheet gives it (narrower on a small screen).
 */
export default function usePanelWidth() {
  const [width, setWidth] = useState(() => loadSettings().panelWidth ?? null)

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

  return { width, onResizeStart, resetWidth }
}
