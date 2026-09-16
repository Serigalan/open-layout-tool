import { useState, useRef, useEffect } from 'react'
import { loadProjects, saveProject, deleteProject, readImageAsBase64, generateId, importProjects, loadProjectImage, saveProjectImage, exportProjectsPayload } from '../storage'
import { parseProjectsPayload } from '../utils/persistenceUtils'
import { languageLabels } from '../locales/i18n'
import ConfirmModal from './ConfirmModal'
import { LogoIcon } from './icons'
import { downloadJSON } from '../utils/fileUtils'
import { listServerProjects, fetchServerProject } from '../utils/serverStorage'

/**
 * The guideline is a static page of its own per language, served from `public`.
 * A language without one falls back to the German original.
 */
const GUIDE_PAGES = { de: './guideline.html', en: './guideline_en.html' }

export default function StartPage({ onOpenProject, t, language, onLanguageChange }) {
  const [projects, setProjects]       = useState(() => loadProjects())
  const [pendingDelete, setPendingDelete] = useState(null)
  const [guideOpen, setGuideOpen]     = useState(false)
  const [showForm, setShowForm]       = useState(false)
  const [title, setTitle]             = useState('')
  const [creator, setCreator]         = useState('')
  const [description, setDescription] = useState('')
  const [imageFile, setImageFile]     = useState(null)
  const [selectMode, setSelectMode]   = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [importConflicts, setImportConflicts] = useState([])
  const importResolvedRef = useRef([])
  const importInputRef    = useRef(null)
  const [templates, setTemplates]         = useState([])
  const [templateBusy, setTemplateBusy]   = useState(null)   // id being fetched
  const [templateFailed, setTemplateFailed] = useState(null) // id that would not load
  const [importFailed, setImportFailed]     = useState(false) // a file this tool will not take

  const guideSrc = GUIDE_PAGES[language] ?? GUIDE_PAGES.de

  // Projects on the server, offered as starting points. The section stays out
  // of the way when there is nothing to show or no server to ask — the app runs
  // perfectly well without one.
  useEffect(() => {
    let cancelled = false
    listServerProjects()
      .then(list => { if (!cancelled) setTemplates(list) })
      .catch(() => { if (!cancelled) setTemplates([]) })
    return () => { cancelled = true }
  }, [])

  // A template is a starting point, not the same project: it comes in under a
  // fresh id. So picking one can never overwrite a project already here, and
  // what is built from it is its own project — putting that back on the server
  // adds an entry rather than writing over the template.
  const handleUseTemplate = async (entry) => {
    if (templateBusy) return
    setTemplateBusy(entry.id)
    setTemplateFailed(null)
    try {
      const [source] = parseProjectsPayload(await fetchServerProject(entry.id)).projects
      if (!source) throw new Error('empty template')
      const copy = { ...source, id: generateId(), createdAt: new Date().toISOString() }
      importProjects([copy])          // hydrates `copy` in place and stores it
      setProjects(loadProjects())
      onOpenProject(copy)
    } catch {
      setTemplateFailed(entry.id)
    } finally {
      setTemplateBusy(null)
    }
  }

  const handleCreate = async () => {
    if (!title.trim()) return
    const image = await readImageAsBase64(imageFile)
    const project = Object.fromEntries(
      Object.entries({
        id:          generateId(),
        title:       title.trim(),
        creator:     creator.trim() || null,
        description: description.trim() || null,
        createdAt:   new Date().toISOString(),
      }).filter(([, v]) => v !== null)
    )
    if (image) saveProjectImage(project.id, image)
    saveProject(project)
    setProjects(loadProjects())
    setShowForm(false)
    setTitle('')
    setCreator('')
    setDescription('')
    setImageFile(null)
    onOpenProject(project)
  }

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handleBack = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  const handleDeleteSelected = () => {
    selectedIds.forEach(id => deleteProject(id))
    setProjects(loadProjects())
    setPendingDelete(null)
    handleBack()
  }

  const handleExportSelected = () => {
    downloadJSON(exportProjectsPayload(selectedIds), 'olt_projects_export.json')
  }

  const handleImport = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    setImportFailed(false)
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        const { projects: incoming } = parseProjectsPayload(data)
        const existing = loadProjects()
        const existingIds = new Set(existing.map(p => p.id))
        const conflicting = incoming.filter(p => existingIds.has(p.id))
        const noConflict  = incoming.filter(p => !existingIds.has(p.id))
        importResolvedRef.current = noConflict
        if (conflicting.length === 0) {
          importProjects(incoming)
          setProjects(loadProjects())
        } else {
          setImportConflicts(conflicting.map(imp => ({
            imported: imp,
            existing: existing.find(p => p.id === imp.id),
          })))
        }
      } catch {
        // Broken JSON, or a project from before the current model — either way
        // nothing is imported, and the page says so instead of staying still.
        setImportFailed(true)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const resolveImportConflict = (keepImported) => {
    const [current, ...rest] = importConflicts
    importResolvedRef.current = [...importResolvedRef.current, keepImported ? current.imported : current.existing]
    if (rest.length === 0) {
      importProjects(importResolvedRef.current)
      importResolvedRef.current = []
      setImportConflicts([])
      setProjects(loadProjects())
    } else {
      setImportConflicts(rest)
    }
  }

  return (
    <div className="start-page">
      <div className="start-section start-section-title">
        <div className="start-section-header">
          <div className="start-header">
            <LogoIcon className="start-logo" />
            <h1 className="start-title">Open Layout Tool</h1>
          </div>
          <div className="start-project-actions">
            {Object.keys(languageLabels).map(lang => (
              <button
                key={lang}
                className={`start-action-btn ${language === lang ? 'start-action-btn-active' : ''}`}
                onClick={() => onLanguageChange(lang)}
              >
                {languageLabels[lang]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="start-section">
        <div className="start-section-header">
          <span className="start-section-label">{t('start_projects')}</span>
          <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleImport} />
          <div className="start-project-actions">
            {!selectMode ? (
              <>
                <button className="start-action-btn" onClick={() => setSelectMode(true)}>{t('start_select')}</button>
                <button className="start-action-btn" onClick={() => importInputRef.current?.click()}>{t('start_import')}</button>
              </>
            ) : (
              <>
                <button className="start-action-btn" onClick={handleBack}>{t('start_back')}</button>
                <button className="start-action-btn start-action-btn-danger" onClick={() => setPendingDelete({ ids: new Set(selectedIds) })} disabled={!selectedIds.size}>{t('start_delete')}</button>
                <button className="start-action-btn" onClick={handleExportSelected} disabled={!selectedIds.size}>{t('start_export')}</button>
              </>
            )}
          </div>
        </div>
        {importFailed && (
          <p className="start-import-error">{t('start_import_failed')}</p>
        )}
        <hr className="start-section-divider" />
        <div className="start-projects">
          {projects.map((project) => {
            const image = loadProjectImage(project.id)
            return (
            <div key={project.id} className="start-project-tile-wrapper">
              <button
                className={`start-project-tile ${selectMode && selectedIds.has(project.id) ? 'selected' : ''}`}
                onClick={() => selectMode ? toggleSelect(project.id) : onOpenProject(project)}
              >
                {image
                  ? <img src={image} alt={project.title} className="start-project-image" />
                  : <div className="start-project-placeholder" />
                }
                <span className="start-project-title">{project.title}</span>
                {selectMode && (
                  <div className={`start-project-checkbox ${selectedIds.has(project.id) ? 'checked' : ''}`}>
                    {selectedIds.has(project.id) && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                        <polyline points="20 6 9 17 4 12" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                )}
              </button>
            </div>
            )
          })}
          {!selectMode && (
            <button
              className={`start-project-new ${showForm ? 'active' : ''}`}
              onClick={() => setShowForm((v) => !v)}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>

        {showForm && (
          <div className="new-project-form">
            <div className="new-project-field">
              <label>{t('start_field_title')} <span className="required">*</span></label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('start_field_title_placeholder')}
                autoFocus
              />
            </div>
            <div className="new-project-field">
              <label>{t('start_field_creator')}</label>
              <input
                type="text"
                value={creator}
                onChange={(e) => setCreator(e.target.value)}
                placeholder={t('start_field_creator_placeholder')}
              />
            </div>
            <div className="new-project-field">
              <label>{t('start_field_description')}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('start_field_description_placeholder')}
                rows={3}
              />
            </div>
            <div className="new-project-field">
              <label>{t('start_field_image')}</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <button className="new-project-submit" onClick={handleCreate} disabled={!title.trim()}>
              {t('start_create_btn')}
            </button>
          </div>
        )}
      </div>

      {templates.length > 0 && (
        <div className="start-section">
          <div className="start-section-header">
            <span className="start-section-label">{t('start_templates')}</span>
            <span className="start-templates-hint">{t('start_templates_hint')}</span>
          </div>
          <hr className="start-section-divider" />
          <div className="start-projects">
            {templates.map(entry => (
              <div key={entry.id} className="start-project-tile-wrapper">
                <button
                  className="start-project-tile"
                  disabled={templateBusy !== null}
                  title={entry.title || entry.id}
                  onClick={() => handleUseTemplate(entry)}
                >
                  <div className="start-project-placeholder" />
                  <span className="start-project-title">{entry.title || entry.id}</span>
                  <span className="start-template-meta">
                    {templateBusy === entry.id
                      ? t('start_templates_loading')
                      : templateFailed === entry.id
                        ? t('start_templates_failed')
                        : t('start_templates_tracks').replace('{{n}}', entry.tracks ?? 0)}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="start-section">
        <div className="start-section-header">
          <span className="start-section-label">{t('start_guideline')}</span>
          <a href="./Leitfaden_Trassierung.pdf" download="Leitfaden_Trassierung.pdf" className="start-action-btn">{t('start_guideline_download')}</a>
        </div>
        <hr className="start-section-divider" />
        <div className={`start-guide-wrapper ${guideOpen ? 'open' : ''}`}>
          <iframe src={guideSrc} className="start-guide-frame" title={t('start_guideline')} />
          {!guideOpen && (
            <div className="start-guide-fade">
              <button className="start-guide-expand" onClick={() => setGuideOpen(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <polyline points="6 9 12 15 18 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {t('start_guideline_expand')}
              </button>
            </div>
          )}
        </div>
        {guideOpen && (
          <div className="start-guide-fullscreen">
            <div className="start-guide-fullscreen-bar">
              <span className="start-section-label">{t('start_guideline')}</span>
              <button className="start-guide-close" onClick={() => setGuideOpen(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                  <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
                {t('start_guideline_close')}
              </button>
            </div>
            <iframe src={guideSrc} className="start-guide-fullscreen-frame" title={t('start_guideline')} />
          </div>
        )}
      </div>

      {importConflicts.length > 0 && (
        <ConfirmModal
          message={(() => {
            const [before, after] = t('import_conflict_message').split('{{title}}')
            return <>{before}<code className="modal-code">{importConflicts[0].existing.title ?? importConflicts[0].existing.id}</code>{after}</>
          })()}
          onConfirm={() => resolveImportConflict(true)}
          onCancel={() => resolveImportConflict(false)}
          t={t}
          confirmLabel={t('import_keep_imported')}
          cancelLabel={t('import_keep_existing')}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          message={(() => {
            if (pendingDelete.ids) {
              const count = pendingDelete.ids.size
              if (count === 1) {
                const proj = projects.find(p => pendingDelete.ids.has(p.id))
                const [before, after] = t('start_delete_confirm').split('{{title}}')
                return <>{before}<code className="modal-code">{proj?.title ?? '?'}</code>{after}</>
              }
              const [before, after] = t('start_delete_confirm_multi').split('{{count}}')
              return <>{before}<strong>{count}</strong>{after}</>
            }
            const [before, after] = t('start_delete_confirm').split('{{title}}')
            return <>{before}<code className="modal-code">{pendingDelete.title}</code>{after}</>
          })()}
          onConfirm={() => {
            if (pendingDelete.ids) {
              handleDeleteSelected()
            } else {
              deleteProject(pendingDelete.id)
              setProjects(loadProjects())
              setPendingDelete(null)
            }
          }}
          onCancel={() => setPendingDelete(null)}
          t={t}
        />
      )}
    </div>
  )
}
