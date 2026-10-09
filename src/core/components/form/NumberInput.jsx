import { useState } from 'react'
import { formatNum, parseNumText } from '../../locales/i18n'
import { useI18n } from '../../locales/i18nContext'

/**
 * A number field (R10.8): shown with the decimal separator of the interface
 * language, and taking a comma as readily as a point — what `onChange` gets
 * is the number as text with a point, as from a `type="number"` field, so a
 * handler reads `e.target.value` as before. ↑/↓ step by `step` (1 unless
 * given, 'any' for none) within `min`/`max`, as the browser's own field did. `unit` stands behind the field.
 */
export default function NumberInput({ value, onChange, onBlur, onKeyDown, step = 1, min, max, unit, className, ...rest }) {
  const { language } = useI18n()
  const [draft, setDraft] = useState(null)
  const emit = (text) => onChange?.({ target: { value: text }, currentTarget: { value: text } })

  const keyDown = (e) => {
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && step != null && step !== 'any') {
      const now = Number(parseNumText(draft ?? value))
      if (Number.isFinite(now)) {
        e.preventDefault()
        let next = now + (e.key === 'ArrowUp' ? 1 : -1) * Number(step)
        if (min != null && min !== '') next = Math.max(Number(min), next)
        if (max != null && max !== '') next = Math.min(Number(max), next)
        const decimals = (String(step).split('.')[1] ?? '').length
        const text = String(Number(next.toFixed(Math.max(decimals, 6))))
        setDraft(formatNum(text, language))
        emit(text)
      }
    }
    onKeyDown?.(e)
  }

  const input = (
    <input {...rest} type="text" inputMode="decimal" className={className}
      value={draft ?? formatNum(value, language)}
      onChange={(e) => { setDraft(e.target.value); emit(parseNumText(e.target.value)) }}
      onBlur={(e) => { setDraft(null); onBlur?.(e) }}
      onKeyDown={keyDown} />
  )
  if (!unit) return input
  return <span className="number-field">{input}<span className="number-unit">{unit}</span></span>
}
