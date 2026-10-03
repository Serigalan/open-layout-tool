// What Escape does on the map view (R10.2), in one order and one place:
//
//   1. a dialog is open        → the dialog closes (Modal does that itself)
//   2. a form is under way     → it is cancelled, the map pick with it
//   3. a comparison is shown   → it closes
//   4. a popup is shown        → it closes
//   5. an overlay is shown     → it closes (the element table asks first)
//
// Forms take part by registering their Cancel (useEscape); the newest one
// registered is the one in front.

const _handlers = []

/** Put `fn` in front for Escape until the returned function takes it away again. */
export function pushEscape(fn) {
  const entry = { fn }
  _handlers.push(entry)
  return () => {
    const i = _handlers.indexOf(entry)
    if (i >= 0) _handlers.splice(i, 1)
  }
}

/** The Cancel of the form in front, or null. */
export const frontHandler = () => _handlers[_handlers.length - 1]?.fn ?? null

/**
 * What Escape is to do: 'modal' (nothing here — the dialog has it), 'form',
 * 'compare', 'popup', 'overlay', or null for nothing at all.
 */
export function escapeAction({ modalOpen, formCancel, compare, popup, overlay }) {
  if (modalOpen) return 'modal'
  if (formCancel) return 'form'
  if (compare) return 'compare'
  if (popup) return 'popup'
  if (overlay) return 'overlay'
  return null
}
