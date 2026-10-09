import { useCallback, useEffect, useRef, useState } from 'react'
import { PayloadError } from '../utils/persistenceUtils'
import { downloadJSON } from '../utils/fileUtils'
import { persistStorage } from '../utils/pointCloud/cloudStore'
import { useI18n } from '../locales/i18nContext'
import { formatDate } from '../locales/i18n'
import { LogoIcon } from '../components/icons'
import LanguageMenu from '../components/collab/LanguageMenu'
import '../components/collab/collab.css'
import GuideDialog, { GuidePreview } from '../components/GuideDialog'
import LocalStorageDialog from '../components/home/LocalStorageDialog'
import ConfirmModal from '../components/ConfirmModal'
import useMenu from '../components/form/useMenu'
import LocalProjectDialog from './LocalProjectDialog'
import {
  createLocalProject, deleteLocalProject, exportLocalProject, importLocalProjects, listLocalProjects, updateLocalProject,
} from './localProjects'

/** One project of the list: its picture, title and description, what it holds, open, and its menu. */
function LocalProjectCard({ project, opening, onOpen, onDialog, onExport }) {
  const { t, fill, language } = useI18n()
  const { open, close, rootRef, buttonRef, buttonProps } = useMenu()
  const item = (label, onClick, danger = false) => (
    <button type="button" role="menuitem" className={danger ? 'danger' : ''} onClick={() => { close(); onClick() }}>{label}</button>
  )
  return (
    <li className="home-project">
      <div className="home-project-head">
        {project.image ? <img className="home-project-image" src={project.image} alt="" /> : <div className="home-project-image home-project-placeholder" />}
        <div className="home-project-titles">
          <h3>{project.title}</h3>
          {project.description && <p className="collab-muted">{project.description}</p>}
          <p className="collab-muted">
            {fill('local_project_line', {
              tracks: project.tracks, switches: project.switches,
              date: formatDate(project.updatedAt, language, { time: true }),
            })}
          </p>
        </div>
        <button type="button" className="collab-btn collab-btn-primary home-project-open" disabled={opening === project.id}
          onClick={() => onOpen(project)}>{t('home_open')}</button>
        <div className="home-menu" ref={rootRef}>
          <button ref={buttonRef} type="button" className="collab-btn collab-btn-small" aria-label={t('home_project_menu')}
            title={t('home_project_menu')} {...buttonProps}>⋯</button>
          {open && (
            <div className="home-menu-list" role="menu">
              {item(t('home_rename'), () => onDialog({ kind: 'edit', project }))}
              {item(t('start_export'), () => onExport(project))}
              {item(t('start_delete'), () => onDialog({ kind: 'delete', project }), true)}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

/**
 * The start page of the local build (Paket L, decisions 279, 281): no sign-in,
 * no server — the projects of this browser, kept in its IndexedDB. "+ New"
 * makes an empty one, "Import" a project of every project in a file (as
 * exported here or from a server's variant); each project opens, is renamed,
 * exported as a file or deleted. The browser holds the only copy, so the page
 * asks it to keep its storage (storage.persist) and says whether it does.
 * What the app keeps here — the projects, point clouds, settings — is looked
 * at and deleted in the local storage dialog.
 */
export default function LocalStartPage({ onOpen }) {
  const { t, fill, setLanguage } = useI18n()
  const [projects, setProjects] = useState(null)
  const [persisted, setPersisted] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [dialog, setDialog] = useState(null)      // { kind, project? }
  const [opening, setOpening] = useState(null)
  const importRef = useRef(null)

  const reload = useCallback(() => listLocalProjects().then(setProjects, err => { setProjects([]); setError(err.message) }), [])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { persistStorage().then(setPersisted) }, [])

  const open = async (project) => {
    setOpening(project.id)
    setError(null)
    try {
      await onOpen(project.id)
    } catch {
      setError(t('local_open_failed'))
      setOpening(null)
    }
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setNotice(null)
    try {
      const n = await importLocalProjects(JSON.parse(await file.text()), file.name.replace(/\.json$/i, ''))
      setNotice(fill('home_imported', { n }))
      await reload()
    } catch (err) {
      setError(t(err instanceof PayloadError && err.code === 'unsupported_version' ? 'collab_err_import_version' : 'collab_err_import_invalid'))
    }
  }

  const exportProject = async (project) => {
    const data = await exportLocalProject(project.id)
    if (data) downloadJSON(data, `${project.title || 'project'}.json`)
  }

  const done = async () => { setDialog(null); await reload() }

  return (
    <div className="collab-page home">
      <header className="home-top">
        <div className="collab-brand">
          <LogoIcon className="collab-logo" />
          <h1>Open Layout Tool</h1>
          <span className="local-badge">{t('local_badge')}</span>
        </div>
        <div className="home-user">
          <LanguageMenu onChange={setLanguage} />
          <button type="button" className="collab-btn" onClick={() => setDialog({ kind: 'local' })}>{t('local_store_menu')}</button>
        </div>
      </header>

      <main className="home-main">
        <p className="collab-muted">{t('local_start_intro')}</p>
        {persisted === false && <p className="local-store-warn">{t('local_not_persisted')}</p>}
        <div className="home-section-head">
          <h2>{t('start_projects')}</h2>
          <div className="home-section-actions">
            <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={handleImport} />
            <button type="button" className="collab-btn collab-btn-primary" onClick={() => setDialog({ kind: 'new' })}>{t('home_new')}</button>
            <button type="button" className="collab-btn" onClick={() => importRef.current?.click()}>{t('start_import')}</button>
          </div>
        </div>
        {error && <p className="collab-error" role="alert">{error}</p>}
        {notice && <p className="collab-ok" role="status">{notice}</p>}
        {projects === null && !error && <p className="collab-muted">{t('home_loading')}</p>}
        {projects?.length === 0 && <p className="collab-muted">{t('home_empty')}</p>}
        <ul className="home-projects">
          {(projects ?? []).map(p => (
            <LocalProjectCard key={p.id} project={p} opening={opening} onOpen={open} onDialog={setDialog} onExport={exportProject} />
          ))}
        </ul>

        <section className="home-section home-guide">
          <div className="home-section-head">
            <h2>{t('start_guideline')}</h2>
            <div className="home-section-actions">
              <a href="./Leitfaden_Trassierung.pdf" download="Leitfaden_Trassierung.pdf" className="collab-btn">{t('start_guideline_download')}</a>
            </div>
          </div>
          <GuidePreview onOpen={() => setDialog({ kind: 'guide' })} />
        </section>
      </main>

      {dialog?.kind === 'guide' && <GuideDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'new' && (
        <LocalProjectDialog onCancel={() => setDialog(null)}
          onSubmit={async (fields) => { await createLocalProject(fields); await done() }} />
      )}
      {dialog?.kind === 'edit' && (
        <LocalProjectDialog project={dialog.project} onCancel={() => setDialog(null)}
          onSubmit={async (fields) => { await updateLocalProject(dialog.project.id, fields); await done() }} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmModal message={fill('local_projects_delete_ask', { title: dialog.project.title })} confirmLabel={t('start_delete')}
          onConfirm={async () => { await deleteLocalProject(dialog.project.id); await done() }} onCancel={() => setDialog(null)} />
      )}
      {dialog?.kind === 'local' && (
        <LocalStorageDialog projects={projects} introKey="local_store_intro_local" deleteAllKey="local_store_delete_all_ask_local"
          onClose={async (changed) => { setDialog(null); if (changed) await reload() }} />
      )}
    </div>
  )
}
