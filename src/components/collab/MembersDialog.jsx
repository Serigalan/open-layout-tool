import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import './collab.css'
import { useI18n } from '../../locales/i18nContext'
import { errorText } from './errorText'
import Modal from '../Modal'

/** How long the search field has to hold still before it asks the server [ms]. */
const SEARCH_DELAY = 250
const MIN_QUERY = 2


/**
 * Who works on a project (decision 127): its creator, the members listed
 * here, and every admin. The creator and the admins add members — found by
 * name or login — and take them off again; everyone else sees the list.
 * `onClose(changed)` says whether the list changed, so the start page can
 * read the projects again.
 */
export default function MembersDialog({ project, onClose }) {
  const { t, fill } = useI18n()
  const [members, setMembers] = useState(project.members ?? [])
  const [canManage, setCanManage] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState({ query: '', users: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    let alive = true
    api.members(project.id).then(
      res => { if (alive) { setMembers(res.members); setCanManage(res.canManage) } },
      err => { if (alive) setError(errorText(t, err.code)) })
    return () => { alive = false }
  }, [project.id, t])

  const trimmed = query.trim()
  useEffect(() => {
    if (!canManage || trimmed.length < MIN_QUERY) return undefined
    let alive = true
    const timer = setTimeout(() => {
      api.searchUsers(trimmed).then(
        res => { if (alive) setHits({ query: trimmed, users: res.users }) },
        err => { if (alive) setError(errorText(t, err.code)) })
    }, SEARCH_DELAY)
    return () => { alive = false; clearTimeout(timer) }
  }, [trimmed, canManage, t])

  const change = async (call) => {
    setBusy(true)
    setError(null)
    try {
      setMembers((await call()).members)
      setChanged(true)
    } catch (err) {
      setError(errorText(t, err.code))
    } finally {
      setBusy(false)
    }
  }

  const taken = new Set([project.createdBy?.id, ...members.map(m => m.id)])
  const results = trimmed.length >= MIN_QUERY && hits.query === trimmed ? hits.users : null
  const close = () => onClose(changed)

  return (
    <Modal className="collab-modal" title={fill('members_title', { title: project.title })} onClose={close} busy={busy}
      actions={<>
        <button type="button" className="modal-btn collab-btn-primary" onClick={close} disabled={busy}>{t('members_done')}</button>
      </>}>
      <p className="collab-muted members-intro">{t('members_intro')}</p>

      <ul className="members-list">
        <li className="members-row">
          <span className="members-who"><strong>{project.createdBy?.name}</strong>
            {project.createdBy?.login && <span className="collab-muted">{project.createdBy.login}</span>}</span>
          <span className="admin-badge">{t('members_creator')}</span>
        </li>
        {members.map(m => (
          <li key={m.id} className="members-row">
            <span className="members-who"><strong>{m.name}</strong><span className="collab-muted">{m.login}</span></span>
            {!m.active && <span className="admin-badge off">{t('admin_inactive')}</span>}
            {canManage && (
              <button type="button" className="collab-btn collab-btn-small" disabled={busy}
                onClick={() => change(() => api.removeMember(project.id, m.id))}>{t('members_remove')}</button>
            )}
          </li>
        ))}
      </ul>
      {members.length === 0 && <p className="collab-muted">{t('members_none')}</p>}

      {canManage && (
        <div className="members-add">
          <label className="collab-field">
            <span>{t('members_search')}</span>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} autoFocus
              placeholder={t('members_search_placeholder')} autoComplete="off" />
          </label>
          {results && results.length === 0 && <p className="collab-muted">{t('members_no_hits')}</p>}
          {results && results.length > 0 && (
            <ul className="members-list members-hits">
              {results.map(u => (
                <li key={u.id} className="members-row">
                  <span className="members-who"><strong>{u.name}</strong><span className="collab-muted">{u.login}</span></span>
                  {taken.has(u.id)
                    ? <span className="collab-muted">{t('members_already')}</span>
                    : (
                      <button type="button" className="collab-btn collab-btn-small collab-btn-primary" disabled={busy}
                        onClick={() => change(() => api.addMember(project.id, u.id))}>{t('members_add')}</button>
                    )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="collab-error" role="alert">{error}</p>}
    </Modal>
  )
}
