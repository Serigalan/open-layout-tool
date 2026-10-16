import { useI18n } from '../../locales/i18nContext'
import { historySteps, travelHistory } from '../../storage'
import { useProject } from '../../hooks/useStore'
import { describeStep } from '../../utils/stepLabel'
import InfoTip from '../form/InfoTip'

/**
 * The history (decisions 326, 328): a panel of its own, opened by the button
 * between the undo and the redo arrow — it has no entry in the sidebar. Every
 * step that can be undone or redone: what is ahead (redo) on top, greyed, the
 * state now marked, what lies behind below it, and at the foot where the
 * history starts. A click goes there in one move (travelHistory) and the
 * panel stays open. The store keeps the last 20 steps.
 */
export default function HistoryPanel() {
  const { t, fill } = useI18n()
  const project = useProject()
  // Read on every render: a write or an undo renders it again (useProject).
  const { past, future } = project ? historySteps() : { past: [], future: [] }
  const label = (step) => { const { key, params } = describeStep(step.before, step.after); return fill(key, params) }
  const empty = !past.length && !future.length

  return (
    <>
      <h2>{t('step_history_title')}<InfoTip text={t('step_history_hint')} /></h2>
      {empty ? <p className="step-history-empty">{t('step_history_empty')}</p> : (
        <div className="step-history-list">
          {[...future].reverse().map((step, i) => (
            <button key={`f${i}`} type="button" className="step-history-item step-history-ahead"
              onClick={() => travelHistory(future.length - i)}>
              {label(step)}
            </button>
          ))}
          {[...past].reverse().map((step, i) => (
            <button key={`p${i}`} type="button" aria-current={i === 0 ? 'step' : undefined}
              className={`step-history-item${i === 0 ? ' step-history-now' : ''}`} onClick={() => travelHistory(-i)}>
              {label(step)}
            </button>
          ))}
          <button type="button" aria-current={past.length ? undefined : 'step'}
            className={`step-history-item step-history-start${past.length ? '' : ' step-history-now'}`}
            onClick={() => travelHistory(-past.length)}>
            {t('step_history_start')}
          </button>
        </div>
      )}
    </>
  )
}
