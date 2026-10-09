import { Fragment } from 'react'
import { extensionsOf } from '../../extensions'
import { useI18n } from '../../locales/i18nContext'

/**
 * The buttons of the tools the server puts into a panel's menu (extension
 * point `panelTools`, Paket L): { panel, id, icon, titleKey, section?,
 * Component }, a heading wherever the `section` changes. The Component is the
 * tool's page and gets `onExit` (and what the panel hands on) — it draws its
 * own way back. `onPick(id)` opens it. Without the server there are none.
 */
export default function PanelToolButtons({ panel, onPick }) {
  const { t } = useI18n()
  const tools = extensionsOf('panelTools').filter(tool => tool.panel === panel)
  return tools.map((tool, i) => {
    const Icon = tool.icon
    return (
      <Fragment key={tool.id}>
        {tool.section && tool.section !== tools[i - 1]?.section && (
          <span className="create-element-section">{t(tool.section)}</span>
        )}
        <button className="create-element-btn" onClick={() => onPick(tool.id)}>
          <Icon />
          {t(tool.titleKey)}
        </button>
      </Fragment>
    )
  })
}
