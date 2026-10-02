import { useI18n } from '../locales/i18nContext'
import { HomeIcon, UndoIcon } from '../components/icons'
import { PANELS } from './panels'

/** The sidebar of the map view, made from the panel register (R2.3). */
export default function Sidebar({ active, onSelect, onUndo, undoAvailable, onHome }) {
  const { t } = useI18n()
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
        <button type="button" className="sidebar-icon-btn" onClick={onUndo} disabled={!undoAvailable}
          title={t('tooltip_undo')} aria-label={t('tooltip_undo')}>
          <UndoIcon />
        </button>
        <button type="button" className="sidebar-icon-btn" onClick={onHome} title={t('tooltip_home')} aria-label={t('tooltip_home')}>
          <HomeIcon />
        </button>
        {PANELS.filter(p => p.place === 'bottom').map(button)}
      </div>
    </aside>
  )
}
