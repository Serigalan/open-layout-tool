import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, blobUrl, splitDataUrl } from '../api/client'
import { parseProjectsPayload, PayloadError, SCHEMA_VERSION } from '../utils/persistenceUtils'
import { PROJECT_IMAGES, projectImagePicture } from '../utils/projectImages'
import { downloadJSON } from '../utils/fileUtils'
import { formatDate, loadHome, variantTree } from './collab/homeModel'
import { LogoIcon } from './icons'
import { fill } from './collab/mergeText'
import PasswordForm from './collab/PasswordForm'
import LanguageMenu from './collab/LanguageMenu'
import ProjectImagePicker from './collab/ProjectImagePicker'
import MembersDialog from './collab/MembersDialog'
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
export default function StartPage({ user, onOpenVariant, onViewVariant, onSignOut, onAdmin, onCompare, onMerge, onHistory, note = null, t, language, onLanguageChange }) {
  const [projects, setProjects] = useState(null)
  const [local, setLocal] = useState(new Map())   // variantId → number of local changes
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(note)
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
      setNotice(fill(t, 'home_imported', { n: incoming.length }))
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
      onDialog={setDialog} onCompare={onCompare} onMerge={onMerge} onHistory={onHistory} t={t} language={language} />
  )

  return (
    <div className="collab-page home">
      <header className="home-top">
        <div className="collab-brand">
          <LogoIcon className="collab-logo" />
          <h1>Open Layout Tool</h1>
        </div>
        <div className="home-user">
          <LanguageMenu language={language} onChange={onLanguageChange} t={t} />
          {isAdmin && onAdmin && <button type="button" className="collab-btn" onClick={onAdmin}>{t('home_admin')}</button>}
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
        <NewProjectDialog t={t} template={Boolean(dialog.template)} onCancel={() => setDialog(null)} onCreated={async () => { setDialog(null); await reload() }} />
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
      {dialog?.kind === 'members' && (
        <MembersDialog t={t} project={dialog.project}
          onClose={async (changed) => { setDialog(null); if (changed) await reload() }} />
      )}
      {dialog?.kind === 'branch' && (
        <BranchDialog t={t} project={dialog.project} onCancel={() => setDialog(null)} onDone={async () => { setDialog(null); await reload() }} />
      )}
      {(dialog?.kind === 'compare' || dialog?.kind === 'merge') && (
        <PairDialog t={t} kind={dialog.kind} project={dialog.project} onCancel={() => setDialog(null)}
          onSubmit={async (a, b) => {
            const outcome = await (dialog.kind === 'compare' ? onCompare(dialog.project, a, b) : onMerge(dialog.project, a, b))
            setDialog(null)
            if (outcome === 'up_to_date') setNotice(fill(t, 'merge_up_to_date', { source: a.name, target: b.name }))
          }} />
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

function ProjectCard({ project, local, opening, showArchived, canDelete, canEdit, onOpen, onView, onDialog, onCompare, onMerge, onHistory, t, language }) {
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
          {project.members?.length > 0 && (
            <p className="collab-muted home-project-members">
              {fill(t, 'home_members_line', { names: project.members.map(m => m.name).join(', ') })}
            </p>
          )}
        </div>
        <div className="home-menu">
          <button type="button" className="collab-btn collab-btn-small" aria-label={t('home_project_menu')} aria-haspopup="menu"
            aria-expanded={menu} onClick={() => setMenu(v => !v)}>⋯</button>
          {menu && (
            <div className="home-menu-list" role="menu" onMouseLeave={() => setMenu(false)}>
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
                  {fill(t, 'home_head', { n: v.head.number, author: v.head.author.name, date: formatDate(v.head.createdAt, language) })}
                </span>
                <span className="home-variant-buttons">
                  {onHistory && <button type="button" className="collab-btn collab-btn-small" onClick={() => onHistory(project, v)}>{t('home_history')}</button>}
                  {!readOnly && (
                    <button type="button" className="collab-btn collab-btn-small" title={t('home_variant_menu')}
                      onClick={() => onDialog({ kind: 'variant', project, variant: v })}>✎</button>
                  )}
                  {readOnly
                    ? <button type="button" className="collab-btn collab-btn-primary" onClick={() => onView(project, v)}>{t('home_view')}</button>
                    : <button type="button" className="collab-btn collab-btn-primary" disabled={opening === v.id} onClick={() => onOpen(project, v)}>{t('home_open')}</button>}
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
        {onCompare && <button type="button" className="collab-btn" disabled={!many} onClick={() => onDialog({ kind: 'compare', project })}>{t('home_compare')}</button>}
        {onMerge && <button type="button" className="collab-btn" disabled={!many} onClick={() => onDialog({ kind: 'merge', project })}>{t('home_merge')}</button>}
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

function NewProjectDialog({ onCancel, onCreated, t, template = false }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [picture, setPicture] = useState({ kind: 'none' })
  const { busy, error, run } = useAction(t)
  const submit = () => run(async () => {
    if (!title.trim()) return
    let payload
    const preset = picture.kind === 'preset' ? PROJECT_IMAGES.find(i => i.key === picture.key) : null
    const image = preset ? await projectImagePicture(preset)
      : picture.kind === 'file' ? splitDataUrl(picture.dataUrl) : null
    if (image) {
      const { hash } = await api.uploadImage(image.mime, image.data)
      payload = { tracks: [], switches: [], platforms: [], imageHash: hash }
    }
    await api.createProject({ title: title.trim(), description: description.trim(), template, ...(payload ? { payload } : {}) })
    await onCreated()
  })
  return (
    <FormDialog title={t(template ? 'home_new_template_title' : 'home_new_title')} submitLabel={t('start_create_btn')} busy={busy} canSubmit={Boolean(title.trim())} error={error}
      onCancel={onCancel} onSubmit={submit} t={t}>
      <label className="collab-field">
        <span>{t('start_field_title')} *</span>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('start_field_title_placeholder')} autoFocus required />
      </label>
      <label className="collab-field">
        <span>{t('start_field_description')}</span>
        <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder={t('start_field_description_placeholder')} />
      </label>
      <ProjectImagePicker value={picture} onChange={setPicture} t={t} disabled={busy} />
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

/**
 * Two variants of a project: the two states to compare (earlier, later), or
 * the source whose changes go into the target.
 */
function PairDialog({ kind, project, onCancel, onSubmit, t }) {
  const variants = project.variants.filter(v => !v.archived)
  const byId = new Map(variants.map(v => [v.id, v]))
  // A merge goes from a variant's parent into it by default, a comparison the same way round.
  const child = variants.find(v => v.parentVariantId && byId.has(v.parentVariantId)) ?? variants[1] ?? variants[0]
  const [a, setA] = useState(child?.parentVariantId && byId.has(child.parentVariantId) ? child.parentVariantId : variants[0]?.id)
  const [b, setB] = useState(child?.id ?? variants[0]?.id)
  const { busy, error, run } = useAction(t)
  const merge = kind === 'merge'
  return (
    <FormDialog title={t(merge ? 'home_merge_title' : 'home_compare_title')} submitLabel={t(merge ? 'home_merge' : 'home_compare')}
      busy={busy} canSubmit={a && b && a !== b} error={error} onCancel={onCancel} t={t}
      onSubmit={() => run(() => onSubmit(byId.get(a), byId.get(b)))}>
      {merge && <p className="collab-muted">{t('home_merge_desc')}</p>}
      <label className="collab-field">
        <span>{t(merge ? 'home_merge_source' : 'home_compare_before')}</span>
        <select value={a} onChange={e => setA(e.target.value)}>
          {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <label className="collab-field">
        <span>{t(merge ? 'home_merge_target' : 'home_compare_after')}</span>
        <select value={b} onChange={e => setB(e.target.value)}>
          {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
    </FormDialog>
  )
}
