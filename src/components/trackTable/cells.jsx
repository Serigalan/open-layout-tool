import { useRef, useState } from 'react'
import { formatNum, parseNumText } from '../../locales/i18n'
import { useI18n } from '../../locales/i18nContext'

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

/** The editable cell beside `input` in direction `step` ('up', 'down', 'left', 'right'), or null. */
function neighbourCell(input, step) {
  const td = input.closest('td')
  const tr = td?.parentElement
  if (!td || !tr) return null
  const editable = (cell) => cell?.querySelector('input:not([disabled])') ?? null
  if (step === 'up' || step === 'down') {
    for (let row = step === 'up' ? tr.previousElementSibling : tr.nextElementSibling; row;
      row = step === 'up' ? row.previousElementSibling : row.nextElementSibling) {
      const hit = editable(row.cells[td.cellIndex])
      if (hit) return hit
    }
    return null
  }
  for (let cell = step === 'left' ? td.previousElementSibling : td.nextElementSibling; cell;
    cell = step === 'left' ? cell.previousElementSibling : cell.nextElementSibling) {
    const hit = editable(cell)
    if (hit) return hit
  }
  return null
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
  const { language } = useI18n()
  const [draft, setDraft] = useState(null)
  const droppedRef = useRef(false)   // Escape took the typing back: the blur commits nothing
  // Numbers as the interface language writes them, typed with comma or point (R10.8).
  const numeric = type === 'number'
  const shown = value == null ? '' : numeric ? formatNum(value, language) : String(value)
  return (
    <input className={inputClass(wide, className)} type={numeric ? 'text' : type} inputMode={numeric ? 'decimal' : undefined}
      disabled={disabled} data-step={step}
      placeholder={placeholder}
      value={draft ?? shown}
      onFocus={() => setDraft(shown)}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        if (!droppedRef.current && draft != null && draft !== shown) onCommit(numeric ? parseNumText(draft) : draft)
        droppedRef.current = false
        setDraft(null)
      }}
      onKeyDown={e => {
        // Escape takes the typing back, and only that (R10.2).
        if (e.key === 'Escape') { e.preventDefault(); droppedRef.current = true; e.currentTarget.blur(); return }
        // Like a spreadsheet (R10.11): Enter takes the value and goes down,
        // ↑/↓ go up and down the column, ←/→ to the neighbouring cell once the
        // caret stands at the edge of what is typed.
        const el = e.currentTarget
        const atStart = el.selectionStart === 0 && el.selectionEnd === 0
        const atEnd = el.selectionStart === el.value.length
        const step = e.key === 'Enter' ? (e.shiftKey ? 'up' : 'down')
          : e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowUp' ? 'up'
            : e.key === 'ArrowLeft' && atStart ? 'left' : e.key === 'ArrowRight' && atEnd ? 'right' : null
        if (!step) return
        const next = neighbourCell(el, step)
        if (e.key === 'Enter' || next) e.preventDefault()
        if (next) next.focus()
        else if (e.key === 'Enter') el.blur()
      }} />
  )
}
