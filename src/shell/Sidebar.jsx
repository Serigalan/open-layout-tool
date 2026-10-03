import { useI18n } from '../locales/i18nContext'
import { HomeIcon, RedoIcon, UndoIcon } from '../components/icons'
import { useRedoStep, useUndoStep } from '../hooks/useStore'
import { describeStep } from '../utils/stepLabel'
import { PANELS } from './panels'

/** The sidebar of the map view, made from the panel register (R2.3). */
export default function Sidebar({ active, onSelect, onUndo, onRedo, onHome }) {
  const { t, fill } = useI18n()
  // What the two buttons would do, said on them (R10.1).
  const undoStep = useUndoStep()
  const redoStep = useRedoStep()
  const stepText = (step) => { const { key, params } = describeStep(step.before, step.after); return fill(key, params) }
  const undoTitle = undoStep ? fill('tooltip_undo_step', { step: stepText(undoStep) }) : t('tooltip_undo')
  const redoTitle = redoStep ? fill('tooltip_redo_step', { step: stepText(redoStep) }) : t('tooltip_redo')
  const button = (panel) => {
    const Icon = panel.icon
    return (
      <button key={panel.id} type="button"
        className={`sidebar-icon-btn ${active === panel.id ? 'active' : ''}`}
        onClick={() => onSelect(panel.id)} title={t(panel.titleKey)} aria-label={t(panel.titleKey)}
        aria-pressed={active === panel.id}>
        <Icon />
      </button>
    )
  }
  return (
    <aside className="sidebar-primary">
      <div className="sidebar-top">{PANELS.filter(p => p.place === 'top').map(button)}</div>
      <div className="sidebar-bottom">
        <button type="button" className="sidebar-icon-btn" onClick={onUndo} disabled={!undoStep}
          title={undoTitle} aria-label={undoTitle}>
          <UndoIcon />
        </button>
        <button type="button" className="sidebar-icon-btn" onClick={onRedo} disabled={!redoStep}
          title={redoTitle} aria-label={redoTitle}>
          <RedoIcon />
        </button>
        <button type="button" className="sidebar-icon-btn" onClick={onHome} title={t('tooltip_home')} aria-label={t('tooltip_home')}>
          <HomeIcon />
        </button>
        {PANELS.filter(p => p.place === 'bottom').map(button)}
      </div>
    </aside>
  )
}
