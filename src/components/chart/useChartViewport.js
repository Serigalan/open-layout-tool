import { useEffect, useRef, useState } from 'react'
import { clamp } from '../../utils/format'

// What the two drawing overlays — the elevation profile and the cross section —
// share about their drawing area (R5.3): its measured size, the height the
// overlay was dragged to, zooming with the wheel and dragging across it.

/** The CSS size `{ w, h }` of the element behind `ref`, kept current; null until measured. */
export function useElementSize(ref) {
  const [size, setSize] = useState(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    // The observer of the element's own window: one from another (a popout)
    // is not told about it.
    const Observer = el.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver
    const ro = new Observer(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

/**
 * The overlay's height once the user dragged its top edge — null while it
 * keeps the height the stylesheet gives it. `onResizeStart` goes on the edge;
 * `bodyRef` is the drawing area inside the overlay, whose parent is the
 * overlay and whose grandparent the map pane it may not outgrow.
 */
export function useOverlayHeight(bodyRef, { min, fallback = 300 }) {
  const [heightPx, setHeightPx] = useState(null)
  const onResizeStart = (e) => {
    const startY = e.clientY, startH = bodyRef.current?.parentElement?.clientHeight ?? fallback
    const maxH = (bodyRef.current?.parentElement?.parentElement?.clientHeight ?? 800) - 80
    const move = (ev) => setHeightPx(clamp(startH + (startY - ev.clientY), min, maxH))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    e.preventDefault()
  }
  return { heightPx, onResizeStart, style: heightPx ? { height: heightPx } : undefined }
}

/**
 * The wheel over the element behind `ref`, as a factor to zoom by and the
 * point it is over (px within the element). The listener is not passive, so
 * the page does not scroll along. `active` re-attaches it once the element is
 * there.
 */
export function useWheelZoom(ref, onZoom, active) {
  const onZoomRef = useRef(onZoom)
  useEffect(() => { onZoomRef.current = onZoom })
  useEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const onWheel = (e) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      onZoomRef.current(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref, active])
}

/**
 * A drag across a drawing with the pointer captured. `onStart(e)` decides
 * whether this press starts one and returns what it needs to remember (or
 * null); `onMove(e, start, d)` gets the movement `d` = { dx, dy } since the
 * press, and `onEnd(start, moved)` whether it moved more than a click would.
 * `dragging` is true while a drag without `start.quiet` is under way — for the
 * grabbing cursor.
 */
export function useDrag({ onStart, onMove, onEnd }) {
  const dragRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const handlers = {
    onPointerDown: (e) => {
      if (e.button !== 0) return
      const start = onStart(e)
      if (start == null) return
      dragRef.current = { x: e.clientX, y: e.clientY, start, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(!start.quiet)
    },
    onPointerMove: (e) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.x, dy = e.clientY - d.y
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) d.moved = true
      onMove?.(e, d.start, { dx, dy })
    },
    onPointerUp: () => {
      const d = dragRef.current
      dragRef.current = null
      setDragging(false)
      if (d) onEnd?.(d.start, d.moved)
    },
  }
  handlers.onPointerCancel = handlers.onPointerUp
  return { dragging, handlers }
}
