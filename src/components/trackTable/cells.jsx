import { useRef, useState } from 'react'

const inputClass = (wide, className) =>
  `track-table-input${wide ? ' track-table-input-wide' : ''}${className ? ` ${className}` : ''}`

/**
 * Read-only cell, styled like the editable ones; `wide` for text that does not
 * fit a number column (type label, radius ramp). What such a cell has to say
 * about itself is titled on the <td> around it, not here: a disabled input
 * takes no pointer events (it would swallow the row's click), so a tooltip on
 * it would never open.
 */
export function TextCell({ value, wide = false, className = '' }) {
  return <input className={inputClass(wide, className)} disabled readOnly value={value} />
}

/**
 * Editable cell with a typing draft, committed on blur or Enter. Numeric
 * unless told otherwise — the justification is the one text column. Only a
 * real change is committed: merely tabbing through a cell must not rebuild the
 * element and re-chain everything behind it.
 */
export function EditCell({
  value, onCommit, disabled = false, step, type = 'number', wide = false, className = '', placeholder,
}) {
  const [draft, setDraft] = useState(null)
  const droppedRef = useRef(false)   // Escape took the typing back: the blur commits nothing
  const shown = value == null ? '' : String(value)
  return (
    <input className={inputClass(wide, className)} type={type} disabled={disabled} step={step}
      placeholder={placeholder}
      value={draft ?? shown}
      onFocus={() => setDraft(shown)}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        if (!droppedRef.current && draft != null && draft !== shown) onCommit(draft)
        droppedRef.current = false
        setDraft(null)
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
        // Escape takes the typing back, and only that (R10.2).
        if (e.key === 'Escape') { e.preventDefault(); droppedRef.current = true; e.currentTarget.blur() }
      }} />
  )
}
