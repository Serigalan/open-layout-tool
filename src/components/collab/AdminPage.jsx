import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { formatDate } from '../../locales/i18n'
import './collab.css'
import { useI18n } from '../../locales/i18nContext'
import { errorText } from './errorText'
import Modal from '../Modal'

/** A start password: 16 characters a person can read out (no 0/O, 1/l/I). */
function startPassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  // Bytes above the last whole multiple of the alphabet are thrown away, so
  // every character is equally likely.
  const limit = 256 - (256 % alphabet.length)
  let out = ''
  while (out.length < 16) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < limit && out.length < 16) out += alphabet[b % alphabet.length]
    }
  }
  return out
}


/**
 * The user administration (AP 10.9), for admins only: who has an account, in
 * which role, whether it is active and when it was last used. Accounts are
 * made here with a start password the user replaces at the first sign-in;
 * a password is reset the same way. Nobody is deleted — a user who leaves is
 * deactivated, which ends their sessions, and their revisions keep their name.
 * The last active admin cannot give that up (the server refuses it).
 */
export default function AdminPage({ user: me, onBack }) {
  const { t, language, fill } = useI18n()
  const [users, setUsers] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)   // { text, password? }
  const [dialog, setDialog] = useState(null)   // { kind: 'create' } | { kind: 'edit', user }

  const load = useCallback(() => api.users().then(({ users: list }) => list), [])
  const reload = useCallback(() => load().then(setUsers, err => setError(err.code)), [load])
  useEffect(() => {
    let alive = true
    load().then(list => { if (alive) setUsers(list) }, err => { if (alive) setError(err.code) })
    return () => { alive = false }
  }, [load])

  const patch = async (u, body, done) => {
    setError(null)
    setNotice(null)
    try {
      await api.patchUser(u.id, body)
      if (done) setNotice(done)
      await reload()
    } catch (err) {
      setError(err.code)
    }
  }

  const resetPassword = (u) => {
    const password = startPassword()
    patch(u, { password }, { text: fill('admin_reset_done', { login: u.login }), password })
  }

  return (
    <div className="collab-page home">
      <header className="home-top">
        <div className="collab-brand">
          <h1>{t('admin_title')}</h1>
        </div>
        <div className="home-user">
          <button type="button" className="collab-btn" onClick={onBack}>{t('viewer_back')}</button>
        </div>
      </header>
      <main className="home-main">
        <div className="home-section-head">
          <h2>{fill('admin_count', { n: users?.length ?? 0 })}</h2>
          <div className="home-section-actions">
            <button type="button" className="collab-btn collab-btn-primary" onClick={() => setDialog({ kind: 'create' })}>{t('admin_create')}</button>
          </div>
        </div>
        {error && <p className="collab-error" role="alert">{errorText(t, error, 'admin_err_')}</p>}
        {notice && (
          <div className="collab-ok admin-notice" role="status">
            {notice.text}
            {notice.password && <> <code className="admin-password">{notice.password}</code> <span className="collab-hint">{t('admin_password_hint')}</span></>}
          </div>
        )}
        {users === null && !error && <p className="collab-muted">{t('home_loading')}</p>}
        <ul className="admin-users">
          {(users ?? []).map(u => (
            <li key={u.id} className={`admin-user ${u.active ? '' : 'inactive'}`}>
              <div className="admin-user-who">
                <strong>{u.name}</strong>
                <span className="collab-muted">{u.login}{u.id === me.id ? ` · ${t('admin_you')}` : ''}</span>
              </div>
              <div className="admin-user-facts">
                <span className={`admin-badge ${u.role}`}>{t(`admin_role_${u.role}`)}</span>
                <span className={`admin-badge ${u.active ? 'active' : 'off'}`}>{t(u.active ? 'admin_active' : 'admin_inactive')}</span>
                {u.mustChangePassword && <span className="admin-badge pending">{t('admin_start_password')}</span>}
                <span className="collab-muted admin-last">
                  {u.lastLoginAt ? fill('admin_last_login', { date: formatDate(u.lastLoginAt, language) }) : t('admin_never')}
                </span>
              </div>
              <div className="admin-user-actions">
                <button type="button" className="collab-btn collab-btn-small" onClick={() => setDialog({ kind: 'edit', user: u })}>{t('admin_edit')}</button>
                <button type="button" className="collab-btn collab-btn-small" onClick={() => resetPassword(u)}>{t('admin_reset')}</button>
                <button type="button" className={`collab-btn collab-btn-small ${u.active ? 'collab-btn-danger' : ''}`}
                  onClick={() => patch(u, { active: !u.active }, { text: fill(u.active ? 'admin_deactivated' : 'admin_activated', { login: u.login }) })}>
                  {t(u.active ? 'admin_deactivate' : 'admin_activate')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </main>

      {dialog?.kind === 'create' && (
        <UserDialog onCancel={() => setDialog(null)}
          onSubmit={async (body) => {
            await api.createUser(body)
            setDialog(null)
            setNotice({ text: fill('admin_created', { login: body.login }), password: body.password })
            await reload()
          }} />
      )}
      {dialog?.kind === 'edit' && (
        <UserDialog user={dialog.user} onCancel={() => setDialog(null)}
          onSubmit={async (body) => {
            await api.patchUser(dialog.user.id, body)
            setDialog(null)
            await reload()
          }} />
      )}
    </div>
  )
}

/** Create a user (login, name, role, start password) or edit one (name, role). */
function UserDialog({ user = null, onCancel, onSubmit }) {
  const { t } = useI18n()
  const [login, setLogin] = useState(user?.login ?? '')
  const [name, setName] = useState(user?.name ?? '')
  const [role, setRole] = useState(user?.role ?? 'user')
  const [password, setPassword] = useState(() => (user ? '' : startPassword()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(user ? { name: name.trim(), role } : { login: login.trim(), name: name.trim(), role, password })
    } catch (err) {
      setError(errorText(t, err.code, 'admin_err_'))
      setBusy(false)
    }
  }
  return (
    <Modal className="collab-modal" title={t(user ? 'admin_edit_title' : 'admin_create')} onClose={onCancel} busy={busy} onSubmit={submit}
      actions={<>
        <button type="button" className="modal-btn modal-btn-cancel" onClick={onCancel} disabled={busy}>{t('btn_cancel')}</button>
        <button type="submit" className="modal-btn collab-btn-primary" disabled={busy}>{t(user ? 'btn_save' : 'admin_create_submit')}</button>
      </>}>
      {!user && (
        <label className="collab-field">
          <span>{t('login_user')} *</span>
          <input value={login} onChange={e => setLogin(e.target.value)} autoFocus required autoComplete="off" />
        </label>
      )}
      <label className="collab-field">
        <span>{t('admin_name')}</span>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus={Boolean(user)} />
      </label>
      <label className="collab-field">
        <span>{t('admin_role')}</span>
        <select value={role} onChange={e => setRole(e.target.value)}>
          <option value="user">{t('admin_role_user')}</option>
          <option value="admin">{t('admin_role_admin')}</option>
        </select>
      </label>
      {!user && (
        <label className="collab-field">
          <span>{t('admin_start_password')}</span>
          <span className="admin-password-row">
            <input value={password} onChange={e => setPassword(e.target.value)} minLength={12} required autoComplete="off" />
            <button type="button" className="collab-btn collab-btn-small" onClick={() => setPassword(startPassword())}>{t('admin_generate')}</button>
          </span>
        </label>
      )}
      {error && <p className="collab-error" role="alert">{error}</p>}
    </Modal>
  )
}
