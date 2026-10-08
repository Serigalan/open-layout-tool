import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useI18n } from '../locales/i18nContext'
import { cloud3dShareUrl } from './channel'

/** The expiries a link can be given [days]; '' for none. */
const EXPIRIES = ['7', '30', '90', '365', '']
const DEFAULT_EXPIRY = '30'

/**
 * Read-only share links to this 3D view (the project's creator and the
 * admins): who has one sees the clouds chosen and the tracks of the variant
 * as they are checked in, without signing in, and changes nothing. A link
 * runs out at the expiry chosen, or holds until revoked; with every cloud
 * ticked it also shows the clouds added later. Nobody else sees this section
 * — the server refuses them the list.
 */
export default function SharePanel({ projectId, variantId, rows, walking = false, walkNow = () => null }) {
  const { t, fill, language } = useI18n()
  const [shares, setShares] = useState(null)      // null while unknown or not allowed
  const [label, setLabel] = useState('')
  const [expiry, setExpiry] = useState(DEFAULT_EXPIRY)
  const [picked, setPicked] = useState(null)      // cloud ids ticked; null for all
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(null)
  const [revoking, setRevoking] = useState(null)
  // Copied links open at the track view as it stands now (Paket RT, decision 254).
  const [atWalk, setAtWalk] = useState(false)

  useEffect(() => {
    if (!projectId) return
    api.shares(projectId).then(r => setShares(r.shares)).catch(() => setShares(null))
  }, [projectId])

  if (!shares) return null
  const ticked = picked ?? rows.map(r => r.id)
  const toggle = (id, on) => {
    const next = on ? [...ticked, id] : ticked.filter(x => x !== id)
    setPicked(next.length === rows.length ? null : next)
  }
  const date = (iso) => new Date(iso).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB')

  const copy = async (share) => {
    const url = cloud3dShareUrl(share.token, walking && atWalk ? walkNow() : null)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(share.id)
    } catch {
      setCopied(null)
      window.prompt(t('cloud3d_share_copy_manual'), url)
    }
  }
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const { share } = await api.createShare(projectId, {
        variantId: variantId ?? null, cloudIds: picked, label,
        expiresInDays: expiry === '' ? null : Number(expiry),
      })
      setShares(list => [share, ...list])
      setLabel('')
      copy(share)
    } catch (err) {
      setError(err.code)
    } finally {
      setBusy(false)
    }
  }
  const revoke = async (share) => {
    try {
      await api.deleteShare(projectId, share.id)
      setShares(list => list.filter(s => s.id !== share.id))
    } catch (err) {
      setError(err.code)
    }
    setRevoking(null)
  }
  const expired = (s) => s.expiresAt && Date.parse(s.expiresAt) <= Date.now()

  return (
    <>
      <h2>{t('cloud3d_share')}</h2>
      <p className="cloud3d-hint">{t('cloud3d_share_hint')}</p>
      {!variantId && <p className="cloud3d-warn">{t('cloud3d_share_no_variant')}</p>}
      <label className="cloud3d-field">
        <span>{t('cloud3d_share_label')}</span>
        <input type="text" value={label} maxLength={200} placeholder={t('cloud3d_share_label_placeholder')}
          onChange={e => setLabel(e.target.value)} />
      </label>
      <label className="cloud3d-field">
        <span>{t('cloud3d_share_expiry')}</span>
        <select value={expiry} onChange={e => setExpiry(e.target.value)}>
          {EXPIRIES.map(d => (
            <option key={d} value={d}>{d === '' ? t('cloud3d_share_expiry_none') : fill('cloud3d_share_expiry_days', { n: d })}</option>
          ))}
        </select>
      </label>
      <span className="cloud3d-field-label">{t('cloud3d_share_clouds')}</span>
      {rows.map(r => (
        <label key={r.id} className="cloud3d-check">
          <input type="checkbox" checked={ticked.includes(r.id)} onChange={e => toggle(r.id, e.target.checked)} />
          <span>{r.name}</span>
        </label>
      ))}
      {picked == null && <p className="cloud3d-hint">{t('cloud3d_share_all_clouds')}</p>}
      <div className="cloud3d-buttons">
        <button type="button" disabled={busy || ticked.length === 0} onClick={create}>{t('cloud3d_share_create')}</button>
      </div>
      {error && <p className="cloud3d-warn">{fill('cloud3d_share_error', { code: error })}</p>}

      {walking && (
        <label className="cloud3d-check">
          <input type="checkbox" checked={atWalk} onChange={e => setAtWalk(e.target.checked)} />
          <span>{t('cloud3d_share_at_walk')}</span>
        </label>
      )}
      {shares.length > 0 && (
        <ul className="cloud3d-shares">
          {shares.map(s => (
            <li key={s.id} className={expired(s) ? 'cloud3d-share-expired' : undefined}>
              <span className="cloud3d-share-name">{s.label || t('cloud3d_share_unnamed')}</span>
              <span className="cloud3d-hint">
                {expired(s) ? fill('cloud3d_share_expired', { date: date(s.expiresAt) })
                  : s.expiresAt ? fill('cloud3d_share_until', { date: date(s.expiresAt) }) : t('cloud3d_share_forever')}
                {' · '}
                {s.cloudIds ? fill('cloud3d_share_n_clouds', { n: s.cloudIds.length }) : t('cloud3d_share_every_cloud')}
              </span>
              <div className="cloud3d-buttons">
                {!expired(s) && (
                  <button type="button" onClick={() => copy(s)}>
                    {copied === s.id ? t('cloud3d_share_copied') : t('cloud3d_share_copy')}
                  </button>
                )}
                {revoking === s.id ? (
                  <>
                    <button type="button" className="cloud3d-danger" onClick={() => revoke(s)}>{t('cloud3d_share_revoke_sure')}</button>
                    <button type="button" onClick={() => setRevoking(null)}>{t('btn_cancel')}</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setRevoking(s.id)}>{t(expired(s) ? 'cloud3d_share_remove' : 'cloud3d_share_revoke')}</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
