import { useEffect, useRef, useState } from 'react'

const ITEMS = '[role^="menuitem"]:not([disabled])'

/**
 * A drop-down menu that works by keyboard (R6.5). Opening it puts the focus on
 * its first item; ↑/↓ move between the items, Home/End to the first and last,
 * Escape closes it and gives the focus back to its button, Tab or a click
 * anywhere else just closes it. `rootRef` goes on the element around button
 * and list, `buttonRef` and `buttonProps` on the button.
 */
export default function useMenu() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const items = () => [...(rootRef.current?.querySelectorAll(ITEMS) ?? [])]
    items()[0]?.focus()
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => {
      const list = items()
      const at = list.indexOf(document.activeElement)
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); buttonRef.current?.focus() }
      else if (e.key === 'Tab') setOpen(false)
      else if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length]?.focus() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus() }
      else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
      else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return {
    open,
    close: () => setOpen(false),
    rootRef,
    buttonRef,
    buttonProps: {
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      onClick: () => setOpen(v => !v),
      // ↓ on the closed button opens it, as in any menu bar.
      // The key stops here: the menu's own listener, attached as it opens, must
      // not take the same key press for a move to the second item.
      onKeyDown: (e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); e.stopPropagation(); setOpen(true) } },
    },
  }
}
