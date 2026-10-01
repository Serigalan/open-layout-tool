import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, blobUrl, splitDataUrl } from '../api/client'
import { readImageAsBase64 } from '../storage'
import { parseProjectsPayload, PayloadError, SCHEMA_VERSION } from '../utils/persistenceUtils'
import { downloadJSON } from '../utils/fileUtils'
import { languageLabels } from '../locales/i18n'
import { formatDate, loadHome, variantTree } from './collab/homeModel'
import { LogoIcon } from './icons'
import { fill } from './collab/mergeText'
import PasswordForm from './collab/PasswordForm'
import './collab/collab.css'

/**
 * The guideline is a static page of its own per language, served from `public`.
 * A language without one falls back to the German original.
 */
const GUIDE_PAGES = { de: './guideline.html', en: './guideline_en.html' }

const errorText = (t, code) => {
  const key = `collab_err_${code}`
  const s = t(key)
  return s === key ? t('collab_err_generic') : s
}

/**
 * The start page (decision 96, AP 10.7): the projects on the server, each
 * with its tree of variants — indented under the variant each was branched
 * off — and per variant its head (revision, author, date) and the local state
 * of its working copy in this browser.
 *
 * "+ New" opens a dialog; "Import" makes one server project of every project
 * in a backup file — the only place whole projects come in. The "⋯" menu of a
 * project renames, exports (a variant's head) and deletes it (its admin or
 * creator only). Branching, comparing and merging act on its variants.
 */
export default function StartPage({ user, onOpenVariant, onSignOut, onAdmin, onCompare, onMerge, onHistory, t, language, onLanguageChange }) {
  const [projects, setProjects] = useState(null)
  const [local, setLocal] = useState(new Map())   // variantId → number of local changes
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [dialog, setDialog] = useState(null)      // { kind, project?, variant? }
  const [opening, setOpening] = useState(null)
  const [userMenu, setUserMenu] = useState(false)
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
      setNotice(fill(t, 'home_imported', { n: incoming.length }))
      await reload()
    } catch (err) {
      setError(err.code)
    }
  }

  const canDelete = (p) => user.role === 'admin' || p.createdBy?.id === user.id

  return (
    <div className="collab-page home">
      <header className="home-top">
        <div className="collab-brand">
          <LogoIcon className="collab-logo" />
          <h1>Open Layout Tool</h1>
        </div>
        <div className="home-user">
          {Object.keys(languageLabels).map(lang => (
            <button key={lang} type="button" className={`collab-link ${language === lang ? 'active' : ''}`} onClick={() => onLanguageChange(lang)}>
              {languageLabels[lang]}
            </button>
          ))}
          {user.role === 'admin' && onAdmin && <button type="button" className="collab-btn" onClick={onAdmin}>{t('home_admin')}</button>}
          <div className="home-menu">
            <button type="button" className="collab-btn" aria-haspopup="menu" aria-expanded={userMenu} onClick={() => setUserMenu(v => !v)}>
              {user.name} ▾
            </button>
            {userMenu && (
              <div className="home-menu-list" role="menu" onMouseLeave={() => setUserMenu(false)}>
                <button type="button" role="menuitem" onClick={() => { setUserMenu(false); setDialog({ kind: 'password' }) }}>{t('password_title')}</button>
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
        {projects?.length === 0 && <p className="collab-muted">{t('home_empty')}</p>}
        <ul className="home-projects">
          {(projects ?? []).map(p => (
            <ProjectCard key={p.id} project={p} local={local} opening={opening} showArchived={showArchived}
              canDelete={canDelete(p)} onOpen={open} onDialog={setDialog} onCompare={onCompare} onMerge={onMerge}
              onHistory={onHistory} t={t} language={language} />
          ))}
        </ul>
        {projects?.some(p => p.variants.some(v => v.archived)) && (
          <label className="collab-check home-archived-toggle">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            {t('home_show_archived')}
          </label>
        )}

        <details className="home-guide">
          <summary>{t('start_guideline')}</summary>
          <p>
            <a href="./Leitfaden_Trassierung.pdf" download="Leitfaden_Trassierung.pdf" className="collab-link">{t('start_guideline_download')}</a>
          </p>
          <iframe src={GUIDE_PAGES[language] ?? GUIDE_PAGES.de} title={t('start_guideline')} />
        </details>
      </main>

      {dialog?.kind === 'new' && (
        <NewProjectDialog t={t} onCancel={() => setDialog(null)} onCreated={async () => { setDialog(null); await reload() }} />
      )}
      {dialog?.kind === 'rename' && (
        <RenameProjectDialog t={t} project={dialog.project} onCancel={() => setDialog(null)} onDone={async () => { setDialog(null); await reload() }} />
      )}
      {dialog?.kind === 'export' && (
        <ExportDialog t={t} project={dialog.project} onCancel={() => setDialog(null)} onDone={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog t={t} message={fill(t, 'home_delete_confirm', { title: dialog.project.title })} danger
          confirmLabel={t('start_delete')} onCancel={() => setDialog(null)}
          onConfirm={async () => { await api.deleteProject(dialog.project.id); setDialog(null); await reload() }} />
      )}
      {dialog?.kind === 'branch' && (
        <BranchDialog t={t} project={dialog.project} onCancel={() => setDialog(null)} onDone={async () => { setDialog(null); await reload() }} />
      )}
      {dialog?.kind === 'variant' && (
        <VariantDialog t={t} variant={dialog.variant} onCancel={() => setDialog(null)} onDone={async () => { setDialog(null); await reload() }} />
      )}
      {dialog?.kind === 'password' && (
        <div className="modal-overlay" onClick={() => setDialog(null)}>
          <div onClick={e => e.stopPropagation()}>
            <PasswordForm t={t} onCancel={() => setDialog(null)} onDone={() => { setDialog(null); setNotice(t('password_done')) }} />
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectCard({ project, local, opening, showArchived, canDelete, onOpen, onDialog, onCompare, onMerge, onHistory, t, language }) {
  const rows = useMemo(() => variantTree(project.variants.filter(v => showArchived || !v.archived)), [project, showArchived])
  const [menu, setMenu] = useState(false)
  const image = blobUrl(project.imageHash)
  const byId = new Map(project.variants.map(v => [v.id, v]))
  const many = project.variants.filter(v => !v.archived).length > 1
  const item = (label, kind, extra = {}) => (
    <button type="button" role="menuitem" className={extra.danger ? 'danger' : ''}
      onClick={() => { setMenu(false); onDialog({ kind, project }) }}>{label}</button>
  )
  return (
    <li className="home-project">
      <div className="home-project-head">
        {image ? <img className="home-project-image" src={image} alt="" /> : <div className="home-project-image home-project-placeholder" />}
        <div className="home-project-titles">
          <h3>{project.title}</h3>
          {project.description && <p className="collab-muted">{project.description}</p>}
        </div>
        <div className="home-menu">
          <button type="button" className="collab-btn collab-btn-small" aria-label={t('home_project_menu')} aria-haspopup="menu"
            aria-expanded={menu} onClick={() => setMenu(v => !v)}>⋯</button>
          {menu && (
            <div className="home-menu-list" role="menu" onMouseLeave={() => setMenu(false)}>
              {item(t('home_rename'), 'rename')}
              {item(t('start_export'), 'export')}
              {canDelete && item(t('start_delete'), 'delete', { danger: true })}
            </div>
          )}
        </div>
      </div>
      <ul className="home-variants">
        {rows.map(({ variant: v, depth }) => {
          const changes = local.get(v.id) ?? 0
          const parent = v.parentVariantId ? byId.get(v.parentVariantId) : null
          return (
            <li key={v.id} className={`home-variant ${v.archived ? 'archived' : ''}`} style={{ '--depth': depth }}>
              <div className="home-variant-main">
                <span className="home-variant-name">{depth > 0 && <span className="home-branch">└</span>}{v.name}</span>
                <span className="home-variant-head">
                  {fill(t, 'home_head', { n: v.head.number, author: v.head.author.name, date: formatDate(v.head.createdAt, language) })}
                </span>
                <span className="home-variant-buttons">
                  {onHistory && <button type="button" className="collab-btn collab-btn-small" onClick={() => onHistory(project, v)}>{t('home_history')}</button>}
                  <button type="button" className="collab-btn collab-btn-small" title={t('home_variant_menu')}
                    onClick={() => onDialog({ kind: 'variant', project, variant: v })}>✎</button>
                  <button type="button" className="collab-btn" disabled={opening === v.id} onClick={() => onOpen(project, v)}>{t('home_open')}</button>
                </span>
              </div>
              {changes > 0 && <div className="home-variant-local">● {fill(t, 'home_local_changes', { n: changes })}</div>}
              {parent && v.parentAhead > 0 && (
                <div className="home-variant-ahead">{fill(t, 'home_parent_ahead', { parent: parent.name, n: v.parentAhead })}</div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="home-project-actions">
        <button type="button" className="collab-btn" onClick={() => onDialog({ kind: 'branch', project })}>{t('home_branch')}</button>
        {onCompare && <button type="button" className="collab-btn" disabled={!many} onClick={() => onCompare(project)}>{t('home_compare')}</button>}
        {onMerge && <button type="button" className="collab-btn" disabled={!many} onClick={() => onMerge(project)}>{t('home_merge')}</button>}
      </div>
    </li>
  )
}

/** A small modal form: title, the fields, cancel and submit, an error line. */
function FormDialog({ title, submitLabel, busy, error, onCancel, onSubmit, children, t, danger = false, canSubmit = true }) {
  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <form className="modal collab-modal" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); onSubmit() }}>
        <h3 className="collab-modal-title">{title}</h3>
        {children}
        {error && <p className="collab-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="modal-btn modal-btn-cancel" onClick={onCancel} disabled={busy}>{t('btn_cancel')}</button>
          <button type="submit" className={`modal-btn ${danger ? 'modal-btn-confirm' : 'collab-btn-primary'}`} disabled={busy || !canSubmit}>{submitLabel}</button>
        </div>
      </form>
    </div>
  )
}

/** Run an async action with busy and error state for a dialog. */
function useAction(t) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try { await fn() } catch (err) { setError(errorText(t, err.code)); setBusy(false) }
  }
  return { busy, error, run }
}

function ConfirmDialog({ message, confirmLabel, onConfirm, onCancel, t, danger }) {
  const { busy, error, run } = useAction(t)
  return (
    <FormDialog title={message} submitLabel={confirmLabel} busy={busy} error={error} danger={danger}
      onCancel={onCancel} onSubmit={() => run(onConfirm)} t={t} />
  )
}

function NewProjectDialog({ onCancel, onCreated, t }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState(null)
  const { busy, error, run } = useAction(t)
  const submit = () => run(async () => {
    if (!title.trim()) return
    let payload
    const image = splitDataUrl(await readImageAsBase64(file))
    if (image) {
      const { hash } = await api.uploadImage(image.mime, image.data)
      payload = { tracks: [], switches: [], platforms: [], imageHash: hash }
    }
    await api.createProject({ title: title.trim(), description: description.trim(), ...(payload ? { payload } : {}) })
    await onCreated()
  })
  return (
    <FormDialog title={t('home_new_title')} submitLabel={t('start_create_btn')} busy={busy} canSubmit={Boolean(title.trim())} error={error}
      onCancel={onCancel} onSubmit={submit} t={t}>
      <label className="collab-field">
        <span>{t('start_field_title')} *</span>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('start_field_title_placeholder')} autoFocus required />
      </label>
      <label className="collab-field">
        <span>{t('start_field_description')}</span>
        <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder={t('start_field_description_placeholder')} />
      </label>
      <label className="collab-field">
        <span>{t('start_field_image')}</span>
        <input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </label>
    </FormDialog>
  )
}

function RenameProjectDialog({ project, onCancel, onDone, t }) {
  const [title, setTitle] = useState(project.title)
  const [description, setDescription] = useState(project.description ?? '')
  const { busy, error, run } = useAction(t)
  return (
    <FormDialog title={t('home_rename')} submitLabel={t('btn_save')} busy={busy} canSubmit={Boolean(title.trim())} error={error} onCancel={onCancel} t={t}
      onSubmit={() => run(async () => { await api.patchProject(project.id, { title: title.trim(), description: description.trim() }); await onDone() })}>
      <label className="collab-field">
        <span>{t('start_field_title')} *</span>
        <input value={title} onChange={e => setTitle(e.target.value)} autoFocus required />
      </label>
      <label className="collab-field">
        <span>{t('start_field_description')}</span>
        <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} />
      </label>
    </FormDialog>
  )
}

async function imageAsDataUrl(hash) {
  const res = await fetch(blobUrl(hash), { credentials: 'same-origin' })
  if (!res.ok) return null
  const blob = await res.blob()
  return await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

/** Export the head of one variant as a self-contained backup file, its picture embedded. */
function ExportDialog({ project, onCancel, onDone, t }) {
  const variants = project.variants.filter(v => !v.archived)
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '')
  const { busy, error, run } = useAction(t)
  const submit = () => run(async () => {
    const { payload, variant } = await api.head(variantId)
    const { imageHash, ...record } = payload
    const image = imageHash ? await imageAsDataUrl(imageHash) : null
    const exported = { ...record, title: project.title, ...(image ? { image } : {}) }
    downloadJSON({ version: SCHEMA_VERSION, projects: [exported] }, `${project.title} – ${variant.name}.json`)
    onDone()
  })
  return (
    <FormDialog title={t('home_export_title')} submitLabel={t('start_export')} busy={busy} error={error} onCancel={onCancel} onSubmit={submit} t={t}>
      <label className="collab-field">
        <span>{t('home_variant')}</span>
        <select value={variantId} onChange={e => setVariantId(e.target.value)}>
          {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
    </FormDialog>
  )
}

/** Branch a new variant off one of the project's variants, at its head. */
function BranchDialog({ project, onCancel, onDone, t }) {
  const variants = project.variants.filter(v => !v.archived)
  const [name, setName] = useState('')
  const [from, setFrom] = useState(variants[0]?.id ?? '')
  const { busy, error, run } = useAction(t)
  return (
    <FormDialog title={t('home_branch_title')} submitLabel={t('home_branch_submit')} busy={busy} canSubmit={Boolean(name.trim())} error={error} onCancel={onCancel} t={t}
      onSubmit={() => run(async () => { await api.branch(project.id, { name: name.trim(), fromVariant: from }); await onDone() })}>
      <label className="collab-field">
        <span>{t('home_branch_name')} *</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="2030" autoFocus required />
      </label>
      <label className="collab-field">
        <span>{t('home_branch_from')}</span>
        <select value={from} onChange={e => setFrom(e.target.value)}>
          {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
    </FormDialog>
  )
}

/** Rename a variant, or archive it (and take it back). */
function VariantDialog({ variant, onCancel, onDone, t }) {
  const [name, setName] = useState(variant.name)
  const [archived, setArchived] = useState(variant.archived)
  const { busy, error, run } = useAction(t)
  return (
    <FormDialog title={t('home_variant_menu')} submitLabel={t('btn_save')} busy={busy} canSubmit={Boolean(name.trim())} error={error} onCancel={onCancel} t={t}
      onSubmit={() => run(async () => { await api.patchVariant(variant.id, { name: name.trim(), archived }); await onDone() })}>
      <label className="collab-field">
        <span>{t('home_variant_name')}</span>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus required />
      </label>
      <label className="collab-check">
        <input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />
        {t('home_variant_archived')}
      </label>
    </FormDialog>
  )
}
