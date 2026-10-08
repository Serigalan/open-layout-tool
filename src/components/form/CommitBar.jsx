import { useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../../locales/i18nContext'
import useEscape from '../../shell/useEscape'
import { ConfirmIcon, CancelIcon } from '../icons'

/**
 * Whether every button of `bar` has room for its words: each label is set on
 * one line, and its natural width (scrollWidth, which a clipped label still
 * reports) must fit the button's inner width. The buttons share the bar in
 * equal parts whether they show words or icons, so the answer does not flip
 * back and forth with what it changes.
 */
function labelsFit(bar) {
  for (const btn of bar.querySelectorAll('.commit-bar-btn')) {
    const label = btn.querySelector('.commit-bar-label')
    if (!label) continue
    const cs = getComputedStyle(btn)
    const inner = btn.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    if (label.scrollWidth > inner) return false
  }
  return true
}

/**
 * Words while they fit, icons once the bar is too narrow for them. Measured
 * when the words change (`labels`) and whenever the bar changes its width; a
 * hidden bar has none to judge.
 */
function useCompact(labels) {
  const ref = useRef(null)
  const [compact, setCompact] = useState(false)
  useLayoutEffect(() => {
    const bar = ref.current
    if (!bar) return undefined
    const measure = () => { if (bar.clientWidth > 0) setCompact(!labelsFit(bar)) }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [labels])
  return [ref, compact]
}

/**
 * Commit and Cancel at the foot of a dialog (R4.3), side by side: with their
 * words while the bar has room for them, as a tick and a cross when it has
 * not — the words then stay on the button as its title and for screen
 * readers. `disabled` locks Commit; `reason` says why, on the button itself
 * (its title) — a locked button that does not say why is a dead end. Labels
 * default to Commit/Cancel. A `reason` alone locks it too, and is said under
 * the bar as well (R10.4).
 */
export default function CommitBar({
  onCommit, onCancel, disabled: locked, reason = null, commitLabel, cancelLabel, danger = false, className = 'mt-8',
}) {
  const { t } = useI18n()
  const disabled = locked ?? !!reason
  const commitText = commitLabel ?? t('btn_commit')
  const cancelText = cancelLabel ?? t('btn_cancel')
  const [ref, compact] = useCompact(`${commitText}|${onCancel ? cancelText : ''}`)
  // Escape is Cancel (R10.2).
  useEscape(onCancel, !!onCancel)
  return (
    <div className={`commit-bar${compact ? ' commit-bar-compact' : ''} ${className}`.trim()}>
      <div className="commit-bar-row" ref={ref}>
        <button type="button" className={`panel-btn commit-bar-btn${danger ? ' danger' : ''}`}
          onClick={onCommit} disabled={disabled}
          title={disabled && reason ? reason : compact ? commitText : undefined}>
          <span className="commit-bar-icon"><ConfirmIcon /></span>
          <span className="commit-bar-label">{commitText}</span>
        </button>
        {onCancel && (
          <button type="button" className="panel-btn commit-bar-btn secondary" onClick={onCancel}
            title={compact ? cancelText : undefined}>
            <span className="commit-bar-icon"><CancelIcon /></span>
            <span className="commit-bar-label">{cancelText}</span>
          </button>
        )}
      </div>
      {disabled && reason && <p className="msg-hint msg-small commit-reason">{reason}</p>}
    </div>
  )
}
