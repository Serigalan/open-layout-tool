import { useState } from 'react'
import { api } from '../../api/client'
import './collab.css'
import { useI18n } from '../../locales/i18nContext'

const MIN = 12

/**
 * Changing one's own password — forced after an admin set a start password
 * or reset it, voluntarily from the user menu. At least twelve characters.
 */
export default function PasswordForm({ forced = false, onDone, onCancel }) {
  const { t } = useI18n()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if ([...next].length < MIN) { setError(t('password_err_short')); return }
    if (next !== repeat) { setError(t('password_err_repeat')); return }
    setBusy(true)
    setError(null)
    try {
      await api.changePassword(current, next)
      const { user } = await api.me()
      onDone(user)
    } catch (err) {
      setError(t({
        wrong_password: 'password_err_wrong', password_too_short: 'password_err_short',
        password_unchanged: 'password_err_unchanged',
      }[err.code] ?? 'collab_err_generic'))
      setBusy(false)
    }
  }

  return (
    <form className="collab-card collab-login" onSubmit={submit}>
      <h2>{t('password_title')}</h2>
      {forced && <p className="collab-muted">{t('password_forced')}</p>}
      <label className="collab-field">
        <span>{t('password_current')}</span>
        <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required autoFocus />
      </label>
      <label className="collab-field">
        <span>{t('password_new')}</span>
        <input type="password" autoComplete="new-password" minLength={MIN} value={next} onChange={e => setNext(e.target.value)} required />
      </label>
      <label className="collab-field">
        <span>{t('password_repeat')}</span>
        <input type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} required />
      </label>
      <p className="collab-hint">{t('password_rule')}</p>
      {error && <p className="collab-error" role="alert">{error}</p>}
      <div className="collab-actions">
        {onCancel && <button type="button" className="collab-btn" onClick={onCancel} disabled={busy}>{t('btn_cancel')}</button>}
        <button type="submit" className="collab-btn collab-btn-primary" disabled={busy}>{t('password_submit')}</button>
      </div>
    </form>
  )
}
