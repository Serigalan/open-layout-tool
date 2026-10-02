import { useState } from 'react'
import { api } from '../../api/client'
import { languageLabels } from '../../locales/i18n'
import { LogoIcon } from '../icons'
import { fill } from './mergeText'
import './collab.css'
import { useI18n } from '../../locales/i18nContext'

/**
 * The sign-in, before everything else (decision 88): the app is only usable
 * signed in. Accounts are made by an admin (decision 89), so there is nothing
 * to register here.
 */
export default function LoginPage({ onSignedIn }) {
  const { t, language, setLanguage } = useI18n()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { user } = await api.login(login, password)
      onSignedIn(user)
    } catch (err) {
      setError(err.code === 'too_many_attempts'
        ? fill(t, 'login_err_too_many', { seconds: err.body?.retryAfter ?? 60 })
        : t(err.code === 'offline' ? 'login_err_offline' : 'login_err_invalid'))
      setBusy(false)
    }
  }

  return (
    <div className="collab-page collab-center">
      <form className="collab-card collab-login" onSubmit={submit}>
        <div className="collab-brand">
          <LogoIcon className="collab-logo" />
          <h1>Open Layout Tool</h1>
        </div>
        <p className="collab-muted">{t('login_intro')}</p>
        <label className="collab-field">
          <span>{t('login_user')}</span>
          <input autoFocus autoComplete="username" value={login} onChange={e => setLogin(e.target.value)} required />
        </label>
        <label className="collab-field">
          <span>{t('login_password')}</span>
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {error && <p className="collab-error" role="alert">{error}</p>}
        <button type="submit" className="collab-btn collab-btn-primary collab-btn-block" disabled={busy || !login || !password}>
          {t('login_submit')}
        </button>
        <div className="collab-langs">
          {Object.keys(languageLabels).map(lang => (
            <button key={lang} type="button" className={`collab-link ${language === lang ? 'active' : ''}`} onClick={() => setLanguage(lang)}>
              {languageLabels[lang]}
            </button>
          ))}
        </div>
      </form>
    </div>
  )
}
