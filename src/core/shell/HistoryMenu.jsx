import { useLayoutEffect, useState } from 'react'
import { useI18n } from '../locales/i18nContext'
import { HistoryIcon } from '../components/icons'
import { historySteps, travelHistory } from '../storage'
import { useProject } from '../hooks/useStore'
import { describeStep } from '../utils/stepLabel'
import useMenu from '../components/form/useMenu'

/**
 * The history between the undo and the redo arrow (decision 326): every step
 * that can be undone or redone, in a list beside the sidebar — what is ahead
 * (redo) on top, greyed, the state now marked, what lies behind below it, and
 * at the foot where the history starts. A click goes there in one move
 * (travelHistory). The store keeps the last 20 steps.
 */
export default function HistoryMenu() {
  const { t, fill } = useI18n()
  const project = useProject()
  const { open, close, rootRef, buttonRef, buttonProps } = useMenu()
  const [place, setPlace] = useState(null)
  // Read on every render while open: a write or an undo renders it again (useProject).
  const { past, future } = project ? historySteps() : { past: [], future: [] }
  const label = (step) => { const { key, params } = describeStep(step.before, step.after); return fill(key, params) }

  // Beside the sidebar, its foot level with the button.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const r = buttonRef.current.getBoundingClientRect()
    const side = buttonRef.current.closest('.sidebar-primary')?.getBoundingClientRect()
    setPlace({ left: (side?.right ?? r.right) + 6, bottom: Math.max(8, window.innerHeight - r.bottom) })
  }, [open, buttonRef])

  const go = (n) => { travelHistory(n); close() }
  const empty = !past.length && !future.length

  return (
    <div className="history-menu" ref={rootRef}>
      <button ref={buttonRef} type="button" className="sidebar-icon-btn history-btn"
        title={t('step_history_title')} aria-label={t('step_history_title')} disabled={!project} {...buttonProps}>
        <HistoryIcon />
      </button>
      {open && (
        <div className="history-list" role="menu" style={place ?? undefined}>
          <div className="history-head">{t('step_history_title')}</div>
          {empty && <div className="history-empty">{t('step_history_empty')}</div>}
          {[...future].reverse().map((step, i) => (
            <button key={`f${i}`} type="button" role="menuitem" className="history-item history-ahead"
              onClick={() => go(future.length - i)}>
              {label(step)}
            </button>
          ))}
          {[...past].reverse().map((step, i) => (
            <button key={`p${i}`} type="button" role="menuitem" aria-current={i === 0 ? 'step' : undefined}
              className={`history-item${i === 0 ? ' history-now' : ''}`} onClick={() => go(-i)}>
              {label(step)}
            </button>
          ))}
          {!empty && (
            <button type="button" role="menuitem" aria-current={past.length ? undefined : 'step'}
              className={`history-item history-start${past.length ? '' : ' history-now'}`} onClick={() => go(-past.length)}>
              {t('step_history_start')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
