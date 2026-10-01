import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, blobUrl, splitDataUrl } from '../api/client'
import { readImageAsBase64 } from '../storage'
import { languageLabels } from '../locales/i18n'
import { formatDate, loadHome, variantTree } from './collab/homeModel'
import { LogoIcon } from './icons'
import { fill } from './collab/mergeText'
import './collab/collab.css'

/**
 * The start page (decision 96): the projects on the server, each with its
 * tree of variants — indented under the variant each was branched off — and
 * per variant its head (revision, author, date) and the local state of its
 * working copy in this browser.
 */
export default function StartPage({ user, onOpenVariant, onSignOut, t, language, onLanguageChange }) {
  const [projects, setProjects] = useState(null)
  const [local, setLocal] = useState(new Map())   // variantId → number of local changes
  const [error, setError] = useState(null)
  const [dialog, setDialog] = useState(null)      // { kind: 'new' }
  const [opening, setOpening] = useState(null)

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
      setError(err.code ?? 'collab_err_generic')
      setOpening(null)
    }
  }

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
          <span className="home-user-name">{user.name}</span>
          <button type="button" className="collab-btn" onClick={onSignOut}>{t('user_sign_out')}</button>
        </div>
      </header>

      <main className="home-main">
        <div className="home-section-head">
          <h2>{t('start_projects')}</h2>
          <div className="home-section-actions">
            <button type="button" className="collab-btn collab-btn-primary" onClick={() => setDialog({ kind: 'new' })}>{t('home_new')}</button>
          </div>
        </div>
        {error && <p className="collab-error" role="alert">{t(`collab_err_${error}`) === `collab_err_${error}` ? t('collab_err_generic') : t(`collab_err_${error}`)}</p>}
        {projects === null && !error && <p className="collab-muted">{t('home_loading')}</p>}
        {projects?.length === 0 && <p className="collab-muted">{t('home_empty')}</p>}
        <ul className="home-projects">
          {(projects ?? []).map(p => (
            <ProjectCard key={p.id} project={p} local={local} opening={opening} onOpen={open} t={t} language={language} />
          ))}
        </ul>
      </main>

      {dialog?.kind === 'new' && (
        <NewProjectDialog t={t} onCancel={() => setDialog(null)}
          onCreated={async () => { setDialog(null); await reload() }} />
      )}
    </div>
  )
}

function ProjectCard({ project, local, opening, onOpen, t, language }) {
  const rows = useMemo(() => variantTree(project.variants.filter(v => !v.archived)), [project])
  const image = blobUrl(project.imageHash)
  return (
    <li className="home-project">
      <div className="home-project-head">
        {image ? <img className="home-project-image" src={image} alt="" /> : <div className="home-project-image home-project-placeholder" />}
        <div className="home-project-titles">
          <h3>{project.title}</h3>
          {project.description && <p className="collab-muted">{project.description}</p>}
        </div>
      </div>
      <ul className="home-variants">
        {rows.map(({ variant: v, depth }) => {
          const changes = local.get(v.id) ?? 0
          return (
            <li key={v.id} className="home-variant" style={{ '--depth': depth }}>
              <div className="home-variant-main">
                <span className="home-variant-name">{depth > 0 && <span className="home-branch">└</span>}{v.name}</span>
                <span className="home-variant-head">
                  {fill(t, 'home_head', { n: v.head.number, author: v.head.author.name, date: formatDate(v.head.createdAt, language) })}
                </span>
                <button type="button" className="collab-btn" disabled={opening === v.id} onClick={() => onOpen(project, v)}>{t('home_open')}</button>
              </div>
              {changes > 0 && <div className="home-variant-local">● {fill(t, 'home_local_changes', { n: changes })}</div>}
            </li>
          )
        })}
      </ul>
    </li>
  )
}

function NewProjectDialog({ onCancel, onCreated, t }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    try {
      let payload
      const image = splitDataUrl(await readImageAsBase64(file))
      if (image) {
        const { hash } = await api.uploadImage(image.mime, image.data)
        payload = { tracks: [], switches: [], platforms: [], imageHash: hash }
      }
      await api.createProject({ title: title.trim(), description: description.trim(), ...(payload ? { payload } : {}) })
      await onCreated()
    } catch (err) {
      setError(err.code)
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <form className="modal collab-modal" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <h3 className="collab-modal-title">{t('home_new_title')}</h3>
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
        {error && <p className="collab-error" role="alert">{t('collab_err_generic')}</p>}
        <div className="modal-actions">
          <button type="button" className="modal-btn modal-btn-cancel" onClick={onCancel} disabled={busy}>{t('btn_cancel')}</button>
          <button type="submit" className="modal-btn collab-btn-primary" disabled={busy || !title.trim()}>{t('start_create_btn')}</button>
        </div>
      </form>
    </div>
  )
}
