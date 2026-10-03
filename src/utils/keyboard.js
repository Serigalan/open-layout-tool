// Keyboard shortcuts the app takes for itself, and where it leaves them alone.

/**
 * Whether the keyboard event belongs to a field the user is typing in — an
 * input, a textarea, a select or anything contenteditable. Such a field keeps
 * its own shortcuts (Ctrl+Z undoes the last keystroke there, not the last
 * project step).
 */
export function isTypingTarget(target) {
  if (!target || typeof target !== 'object') return false
  if (target.isContentEditable) return true
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : ''
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Ctrl/Cmd+Z without Shift, outside a field — the project's undo. */
export function isProjectUndo(e) {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
    && (e.key === 'z' || e.key === 'Z') && !isTypingTarget(e.target)
}

/** Ctrl/Cmd+Y, or Ctrl/Cmd+Shift+Z, outside a field — the project's redo (R10.1). */
export function isProjectRedo(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || isTypingTarget(e.target)) return false
  const key = e.key.toLowerCase()
  return (key === 'y' && !e.shiftKey) || (key === 'z' && e.shiftKey)
}

/** A field whose own keys include Escape: a text area, a select, anything contenteditable. */
export function isMultilineTarget(target) {
  if (!target || typeof target !== 'object') return false
  if (target.isContentEditable) return true
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : ''
  return tag === 'TEXTAREA' || tag === 'SELECT'
}
