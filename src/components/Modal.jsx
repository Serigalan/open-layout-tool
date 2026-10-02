import { useEffect, useId, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The one dialog of the app (R6.4): over everything, `role="dialog"` and
 * `aria-modal`, named by its title; Escape and a click beside it close it
 * (not while `busy`); Tab stays inside it; the focus goes into it when it
 * opens — to `initialFocus` (a selector) or the first field — and back to
 * where it was when it closes.
 *
 *   title      heading of the dialog (optional; then name it with aria-label)
 *   onClose    what closing means — usually the same as Cancel
 *   onSubmit   makes the dialog a form: Enter in a field submits it
 *   actions    the buttons at the foot
 */
export default function Modal({
  title, onClose, onSubmit, busy = false, actions = null, className = '',
  initialFocus = null, ariaLabel, children,
}) {
  const titleId = useId()
  const box = useRef(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy })

  useEffect(() => {
    const before = document.activeElement
    const el = box.current
    const first = (initialFocus && el?.querySelector(initialFocus))
      ?? el?.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
      ?? el?.querySelector(FOCUSABLE)
    ;(first ?? el)?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (!busyRef.current) closeRef.current?.()
        return
      }
      if (e.key !== 'Tab' || !el) return
      const items = [...el.querySelectorAll(FOCUSABLE)]
      if (!items.length) { e.preventDefault(); return }
      const i = items.indexOf(document.activeElement)
      if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus() }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (before && typeof before.focus === 'function' && document.contains(before)) before.focus()
    }
  }, [initialFocus])

  const Box = onSubmit ? 'form' : 'div'
  const submit = onSubmit ? (e) => { e.preventDefault(); if (!busy) onSubmit(e) } : undefined
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.() }}>
      <Box ref={box} className={`modal ${className}`.trim()} role="dialog" aria-modal="true"
        aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : ariaLabel}
        tabIndex={-1} onSubmit={submit}>
        {title && <h3 id={titleId} className="modal-title">{title}</h3>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </Box>
    </div>
  )
}
