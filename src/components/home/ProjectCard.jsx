import { useMemo } from 'react'
import { blobUrl } from '../../api/client'
import { variantTree } from '../collab/homeModel'
import { formatDate } from '../../locales/i18n'
import { useI18n } from '../../locales/i18nContext'
import useMenu from '../form/useMenu'

export default function ProjectCard({ project, local, opening, showArchived, canDelete, canEdit, onOpen, onView, onDialog, onCompare, onMerge, onHistory }) {
  const { t, language, fill } = useI18n()
  const rows = useMemo(() => variantTree(project.variants.filter(v => showArchived || !v.archived)), [project, showArchived])
  const { open: menuOpen, close: closeMenu, rootRef: menuRootRef, buttonRef: menuButtonRef, buttonProps: menuButtonProps } = useMenu()
  const image = blobUrl(project.imageHash)
  const byId = new Map(project.variants.map(v => [v.id, v]))
  const many = project.variants.filter(v => !v.archived).length > 1
  const item = (label, kind, extra = {}) => (
    <button type="button" role="menuitem" className={extra.danger ? 'danger' : ''}
      onClick={() => { closeMenu(); onDialog({ kind, project }) }}>{label}</button>
  )
  return (
    <li className="home-project">
      <div className="home-project-head">
        {image ? <img className="home-project-image" src={image} alt="" /> : <div className="home-project-image home-project-placeholder" />}
        <div className="home-project-titles">
          <h3>{project.title}</h3>
          {project.description && <p className="collab-muted">{project.description}</p>}
          {project.members?.length > 0 && (
            <p className="collab-muted home-project-members">
              {fill('home_members_line', { names: project.members.map(m => m.name).join(', ') })}
            </p>
          )}
        </div>
        <div className="home-menu" ref={menuRootRef}>
          <button ref={menuButtonRef} type="button" className="collab-btn collab-btn-small" aria-label={t('home_project_menu')}
            title={t('home_project_menu')} {...menuButtonProps}>⋯</button>
          {menuOpen && (
            <div className="home-menu-list" role="menu">
              {canEdit && item(t('home_rename'), 'rename')}
              {item(t('start_export'), 'export')}
              {!project.template && item(t('home_members'), 'members')}
              {canDelete && item(t('start_delete'), 'delete', { danger: true })}
            </div>
          )}
        </div>
      </div>
      <ul className="home-variants">
        {rows.map(({ variant: v, depth }) => {
          const changes = local.get(v.id) ?? 0
          const parent = v.parentVariantId ? byId.get(v.parentVariantId) : null
          // A template's own variant, for anyone but an admin: looked at, not edited.
          const readOnly = !canEdit && !v.parentVariantId
          return (
            <li key={v.id} className={`home-variant ${v.archived ? 'archived' : ''}`} style={{ '--depth': depth }}>
              <div className="home-variant-main">
                <span className="home-variant-name">{depth > 0 && <span className="home-branch">└</span>}{v.name}</span>
                <span className="home-variant-head">
                  {fill('home_head', { n: v.head.number, author: v.head.author.name, date: formatDate(v.head.createdAt, language) })}
                </span>
                <span className="home-variant-buttons">
                  {onHistory && <button type="button" className="collab-btn collab-btn-small" onClick={() => onHistory(project, v)}>{t('home_history')}</button>}
                  {!readOnly && (
                    <button type="button" className="collab-btn collab-btn-small" title={t('home_variant_menu')} aria-label={t('home_variant_menu')}
                      onClick={() => onDialog({ kind: 'variant', project, variant: v })}>✎</button>
                  )}
                  {readOnly
                    ? <button type="button" className="collab-btn collab-btn-primary" onClick={() => onView(project, v)}>{t('home_view')}</button>
                    : <button type="button" className="collab-btn collab-btn-primary" disabled={opening === v.id} onClick={() => onOpen(project, v)}>{t('home_open')}</button>}
                </span>
              </div>
              {changes > 0 && <div className="home-variant-local">● {fill('home_local_changes', { n: changes })}</div>}
              {parent && v.parentAhead > 0 && (
                <div className="home-variant-ahead">{fill('home_parent_ahead', { parent: parent.name, n: v.parentAhead })}</div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="home-project-actions">
        <button type="button" className="collab-btn" onClick={() => onDialog({ kind: 'branch', project })}>{t('home_branch')}</button>
        {onCompare && <button type="button" className="collab-btn" disabled={!many} onClick={() => onDialog({ kind: 'compare', project })}>{t('home_compare')}</button>}
        {onMerge && <button type="button" className="collab-btn" disabled={!many} onClick={() => onDialog({ kind: 'merge', project })}>{t('home_merge')}</button>}
      </div>
    </li>
  )
}
