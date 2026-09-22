import { useState } from 'react'
import { CANT_STEP, cantFromInput, equilibriumCant } from '../../utils/mapConstants'

/**
 * The cant field of a dialog: a value that is proposed and may be overridden,
 * with the ausgleichende Überhöhung one click away.
 *
 * **What is typed is kept as text** until the field is left, and only then
 * rounded onto the design step and clamped. Doing that on every keystroke —
 * which is what these fields did — makes the field unusable for any value
 * whose leading digits are not themselves on the step: typing 65 went 6 → 5,
 * and the 5 that was left is what the next keystroke built on, so the value
 * could not be reached at all. It is the same split the element table already
 * keeps between a draft and the value under it.
 *
 * The offer below the field appears only where there is something to offer: a
 * speed and a radius to compute u_0 from, and a value that is not already it.
 * It reads as `.field-override` reads everywhere else in the panels — a small
 * line under the field that says what it would put there.
 */
export default function CantField({
  t, label, value, onChange, min, max, speed, radius, children,
}) {
  const [draft, setDraft] = useState(null)

  const commit = () => {
    if (draft === null) return
    const committed = cantFromInput(draft, min, max)
    if (committed !== null) onChange(committed)
    setDraft(null)
  }

  const offer = radius && speed
    ? Math.max(min, Math.min(max, equilibriumCant(speed, radius)))
    : null

  return (
    <div className="form-field">
      <label>{label ?? t('cant')}</label>
      <input
        type="number" step={CANT_STEP} min={min} max={max}
        value={draft ?? value}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      />
      {offer != null && offer !== value && (
        <button type="button" className="field-override" title={t('cant_equilibrium_hint')}
          onClick={() => onChange(offer)}>
          {`${t('cant_equilibrium')} (${offer} mm)`}
        </button>
      )}
      {children}
    </div>
  )
}
