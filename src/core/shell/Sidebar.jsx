import { useState } from 'react'
import { useI18n } from '../locales/i18nContext'
import { HomeIcon, RedoIcon, UndoIcon } from '../components/icons'
import { useRedoStep, useUndoStep } from '../hooks/useStore'
import { describeStep } from '../utils/stepLabel'
import { loadSettings, saveSettings } from '../utils/settings'
import { PANELS } from './panels'
import { extensionsOf } from '../extensions'

/**
 * The sidebar of the map view, made from the panel register (R2.3): the work
 * steps in their order, a line between them, and their names beside the
 * symbols (R10.7), which can be folded away — remembered on this device.
 * At its foot, beside that button, what the server puts there
 * (`sidebarFoot`): whether the services are there (R10.12).
 */
export default function Sidebar({ active, onSelect, onUndo, onRedo, onHome }) {
  const { t, fill } = useI18n()
  // Their names show unless they were folded away on this device.
  const [labels, setLabels] = useState(() => loadSettings().sidebarLabels !== false)
  const toggleLabels = () => setLabels(on => { saveSettings({ sidebarLabels: !on }); return !on })
  // What the two buttons would do, said on them (R10.1).
  const undoStep = useUndoStep()
  const redoStep = useRedoStep()
  const stepText = (step) => { const { key, params } = describeStep(step.before, step.after); return fill(key, params) }
  const undoTitle = undoStep ? fill('tooltip_undo_step', { step: stepText(undoStep) }) : t('tooltip_undo')
  const redoTitle = redoStep ? fill('tooltip_redo_step', { step: stepText(redoStep) }) : t('tooltip_redo')

  const iconButton = ({ key, icon, title, onClick, disabled, active: on, pressed }) => {
    const Icon = icon
    return (
      <button key={key} type="button" className={`sidebar-icon-btn${on ? ' active' : ''}`}
        onClick={onClick} disabled={disabled} title={title} aria-label={title} aria-pressed={pressed}>
        <Icon />
        {labels && <span className="sidebar-label">{title}</span>}
      </button>
    )
  }
  const panelButton = (panel) => iconButton({
    key: panel.id, icon: panel.icon, title: t(panel.titleKey), onClick: () => onSelect(panel.id),
    active: active === panel.id, pressed: active === panel.id,
  })
  // A line wherever the work step changes.
  const withDividers = (panels) => panels.flatMap((panel, i) => (
    i > 0 && panel.group !== panels[i - 1].group
      ? [<hr key={`d-${panel.id}`} className="sidebar-divider" />, panelButton(panel)]
      : [panelButton(panel)]))

  return (
    <aside className={`sidebar-primary${labels ? ' with-labels' : ''}`}>
      <div className="sidebar-top">
        {withDividers(PANELS.filter(p => p.place === 'top'))}
      </div>
      <div className="sidebar-bottom">
        {iconButton({ key: 'undo', icon: UndoIcon, title: undoTitle, onClick: onUndo, disabled: !undoStep })}
        {iconButton({ key: 'redo', icon: RedoIcon, title: redoTitle, onClick: onRedo, disabled: !redoStep })}
        {iconButton({ key: 'home', icon: HomeIcon, title: t('tooltip_home'), onClick: onHome })}
        {PANELS.filter(p => p.place === 'bottom').map(panelButton)}
        <div className="sidebar-foot">
          {extensionsOf('sidebarFoot').map((Foot, i) => <Foot key={i} />)}
          <button type="button" className="sidebar-label-toggle" onClick={toggleLabels}
            aria-pressed={labels} title={t(labels ? 'sidebar_labels_hide' : 'sidebar_labels_show')}
            aria-label={t(labels ? 'sidebar_labels_hide' : 'sidebar_labels_show')}>
            <span aria-hidden="true">{labels ? '«' : '»'}</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
