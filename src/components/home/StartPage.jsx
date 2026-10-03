import { useCallback, useEffect, useRef, useState } from 'react'
import { api, splitDataUrl } from '../../api/client'
import { parseProjectsPayload, PayloadError } from '../../utils/persistenceUtils'
import { loadHome } from '../collab/homeModel'
import { LogoIcon } from '../icons'
import PasswordForm from '../collab/PasswordForm'
import LanguageMenu from '../collab/LanguageMenu'
import MembersDialog from '../collab/MembersDialog'
import { useI18n } from '../../locales/i18nContext'
import { errorText } from '../collab/errorText'
import '../collab/collab.css'
import Modal from '../Modal'
import useMenu from '../form/useMenu'
import BranchDialog from './BranchDialog'
import ConfirmDialog from './ConfirmDialog'
import ExportDialog from './ExportDialog'
import NewProjectDialog from './NewProjectDialog'
import PairDialog from './PairDialog'
import ProjectCard from './ProjectCard'
import RenameProjectDialog from './RenameProjectDialog'
import VariantDialog from './VariantDialog'

/**
 * The guideline is a static page of its own per language, served from `public`.
 * A language without one falls back to the German original.
 */
const GUIDE_PAGES = { de: './guideline.html', en: './guideline_en.html' }


/**
 * The start page (decision 96, AP 10.7): the projects on the server, each
 * with its tree of variants — indented under the variant each was branched
 * off — and per variant its head (revision, author, date) and the local state
 * of its working copy in this browser.
 *
 * Each user sees the projects they created or were added to, an admin sees
 * all (decision 127). "+ New" opens a dialog; "Import" makes one server
 * project of every project in a backup file — the only place whole projects
 * come in. The "⋯" menu of a project renames, exports (a variant's head),
 * lists and changes who works on it, and deletes it (its admin or creator
 * only). Branching, comparing and merging act on its variants.
 *
 * Below them the templates: everyone branches a variant of their own off one;
 * the template itself — its root variants — only an admin edits, everyone
 * else looks at it read-only.
 */
export default function StartPage({ user, onOpenVariant, onViewVariant, onSignOut, onAdmin, onCompare, onMerge, onHistory, note = null }) {
  const { t, language, setLanguage, fill } = useI18n()
  const [projects, setProjects] = useState(null)
  const [local, setLocal] = useState(new Map())   // variantId → number of local changes
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(note)
  const [dialog, setDialog] = useState(null)      // { kind, project?, variant? }
  const [opening, setOpening] = useState(null)
  const { open: userMenuOpen, close: closeUserMenu, rootRef: userMenuRootRef, buttonRef: userMenuButtonRef, buttonProps: userMenuButtonProps } = useMenu()
  const [showArchived, setShowArchived] = useState(false)
  const importRef = useRef(null)

  const apply = useCallback(({ projects: list, local: copies }) => {
    setProjects(list)
    setLocal(copies)
    setError(null)
  }, [])
  const reload = useCallback(() => loadHome().then(apply, err => setError(err.code)), [apply])
  useEffect(() => {
    let alive = true
    loadHome().then(data => { if (alive) apply(data) }, err => { if (alive) setError(err.code) })
    return () => { alive = false }
  }, [apply])

  const open = async (project, variant) => {
    setOpening(variant.id)
    try {
      await onOpenVariant(project, variant)
    } catch (err) {
      setError(err.code ?? 'generic')
      setOpening(null)
    }
  }

  const view = async (project, variant) => {
    try {
      await onViewVariant(project, variant)
    } catch (err) {
      setError(err.code ?? 'generic')
    }
  }

  // A backup file: every project in it becomes a server project of its own,
  // its picture uploaded on the way.
  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setNotice(null)
    let incoming
    try {
      incoming = parseProjectsPayload(JSON.parse(await file.text())).projects
    } catch (err) {
      setError(err instanceof PayloadError && err.code === 'unsupported_version' ? 'import_version' : 'import_invalid')
      return
    }
    try {
      for (const p of incoming) {
        const { image, id: _id, ...record } = p
        const picture = splitDataUrl(image)
        if (picture) record.imageHash = (await api.uploadImage(picture.mime, picture.data)).hash
        await api.createProject({ title: p.title || file.name.replace(/\.json$/i, ''), description: p.description ?? '', payload: record })
      }
      setNotice(fill('home_imported', { n: incoming.length }))
      await reload()
    } catch (err) {
      setError(err.code)
    }
  }

  const isAdmin = user.role === 'admin'
  const canDelete = (p) => isAdmin || (!p.template && p.createdBy?.id === user.id)
  const regular = projects?.filter(p => !p.template)
  const templates = projects?.filter(p => p.template)
  const card = (p) => (
    <ProjectCard key={p.id} project={p} local={local} opening={opening} showArchived={showArchived}
      canDelete={canDelete(p)} canEdit={isAdmin || !p.template} onOpen={open} onView={view}
      onDialog={setDialog} onCompare={onCompare} onMerge={onMerge} onHistory={onHistory} />
  )

  return (
    <div className="collab-page home">
      <header className="home-top">
        <div className="collab-brand">
          <LogoIcon className="collab-logo" />
          <h1>Open Layout Tool</h1>
        </div>
        <div className="home-user">
          <LanguageMenu onChange={setLanguage} />
          {isAdmin && onAdmin && <button type="button" className="collab-btn" onClick={onAdmin}>{t('home_admin')}</button>}
          <div className="home-menu" ref={userMenuRootRef}>
            <button ref={userMenuButtonRef} type="button" className="collab-btn" {...userMenuButtonProps}>
              {user.name} ▾
            </button>
            {userMenuOpen && (
              <div className="home-menu-list" role="menu">
                <button type="button" role="menuitem" onClick={() => { closeUserMenu(); setDialog({ kind: 'password' }) }}>{t('password_title')}</button>
                <button type="button" role="menuitem" onClick={onSignOut}>{t('user_sign_out')}</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="home-main">
        <div className="home-section-head">
          <h2>{t('start_projects')}</h2>
          <div className="home-section-actions">
            <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={handleImport} />
            <button type="button" className="collab-btn collab-btn-primary" onClick={() => setDialog({ kind: 'new' })}>{t('home_new')}</button>
            <button type="button" className="collab-btn" onClick={() => importRef.current?.click()}>{t('start_import')}</button>
          </div>
        </div>
        {error && <p className="collab-error" role="alert">{errorText(t, error)}</p>}
        {notice && <p className="collab-ok" role="status">{notice}</p>}
        {projects === null && !error && <p className="collab-muted">{t('home_loading')}</p>}
        {regular?.length === 0 && <p className="collab-muted">{t('home_empty')}</p>}
        <ul className="home-projects">
          {(regular ?? []).map(card)}
        </ul>
        {projects?.some(p => p.variants.some(v => v.archived)) && (
          <label className="collab-check home-archived-toggle">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            {t('home_show_archived')}
          </label>
        )}

        <section className="home-section">
          <div className="home-section-head">
            <h2>{t('home_templates')}</h2>
            {isAdmin && (
              <div className="home-section-actions">
                <button type="button" className="collab-btn collab-btn-primary" onClick={() => setDialog({ kind: 'new', template: true })}>{t('home_new')}</button>
              </div>
            )}
          </div>
          {templates?.length === 0 && <p className="collab-muted">{t('home_templates_empty')}</p>}
          <ul className="home-projects">
            {(templates ?? []).map(card)}
          </ul>
        </section>

        <section className="home-section home-guide">
          <div className="home-section-head">
            <h2>{t('start_guideline')}</h2>
            <div className="home-section-actions">
              <a href="./Leitfaden_Trassierung.pdf" download="Leitfaden_Trassierung.pdf" className="collab-btn">{t('start_guideline_download')}</a>
            </div>
          </div>
          <iframe src={GUIDE_PAGES[language] ?? GUIDE_PAGES.de} title={t('start_guideline')} />
        </section>
      </main>

      {dialog?.kind === 'new' && (
        <NewProjectDialog template={Boolean(dialog.template)} onCancel={() => setDialog(null)} onCreated={async () => { setDialog(null); await reload() }} />
      )}
      {dialog?.kind === 'rename' && (
        <RenameProjectDialog project={dialog.project} onCancel={() => setDialog(null)} onDone={async () => { setDialog(null); await reload() }} />
      )}
      {dialog?.kind === 'export' && (
        <ExportDialog project={dialog.project} onCancel={() => setDialog(null)} onDone={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog message={fill('home_delete_confirm', { title: dialog.project.title })} danger
          confirmLabel={t('start_delete')} onCancel={() => setDialog(null)}
          onConfirm={async () => { await api.deleteProject(dialog.project.id); setDialog(null); await reload() }} />
      )}
      {dialog?.kind === 'members' && (
        <MembersDialog project={dialog.project}
          onClose={async (changed) => { setDialog(null); if (changed) await reload() }} />
      )}
      {dialog?.kind === 'branch' && (
        <BranchDialog project={dialog.project} onCancel={() => setDialog(null)} onDone={async () => { setDialog(null); await reload() }} />
      )}
      {(dialog?.kind === 'compare' || dialog?.kind === 'merge') && (
        <PairDialog kind={dialog.kind} project={dialog.project} onCancel={() => setDialog(null)}
          onSubmit={async (a, b) => {
            const outcome = await (dialog.kind === 'compare' ? onCompare(dialog.project, a, b) : onMerge(dialog.project, a, b))
            setDialog(null)
            if (outcome === 'up_to_date') setNotice(fill('merge_up_to_date', { source: a.name, target: b.name }))
          }} />
      )}
      {dialog?.kind === 'variant' && (
        <VariantDialog variant={dialog.variant} onCancel={() => setDialog(null)} onDone={async () => { setDialog(null); await reload() }} />
      )}
      {dialog?.kind === 'password' && (
        <Modal className="modal-bare" ariaLabel={t('password_title')} onClose={() => setDialog(null)}>
          <PasswordForm onCancel={() => setDialog(null)} onDone={() => { setDialog(null); setNotice(t('password_done')) }} />
        </Modal>
      )}
    </div>
  )
}
