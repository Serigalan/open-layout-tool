import { fill } from './mergeText'
import './collab.css'
import { useI18n } from '../../locales/i18nContext'

/**
 * The status of the open working copy, at the top of the app (AP 10.6):
 * which project and variant, the revision it rests on, and whether it is all
 * checked in, has local changes, or the server has moved on — with the two
 * ways to act on that, check in and update.
 */
export default function WorkingCopyBar({ projectTitle, variantName, base, changes, serverNewer, busy, onCheckIn, onUpdate, onShowChanges }) {
  const { t } = useI18n()
  const state = serverNewer ? 'newer' : changes > 0 ? 'local' : 'clean'
  return (
    <div className="wc-bar" role="status">
      <span className="wc-where">
        <strong>{projectTitle}</strong>
        <span className="wc-sep">›</span>
        <span>{variantName}</span>
        {base && <span className="wc-rev">{fill(t, 'wc_rev', { n: base.number })}</span>}
      </span>
      <button type="button" className={`wc-state wc-state-${state}`} onClick={onShowChanges} disabled={!changes}>
        {changes > 0 ? fill(t, 'wc_changes', { n: changes }) : t('wc_clean')}
        {serverNewer && <span className="wc-newer">{t('wc_server_newer')}</span>}
      </button>
      <span className="wc-actions">
        <button type="button" className="wc-btn" onClick={onUpdate} disabled={busy}>{t('wc_update')}</button>
        <button type="button" className="wc-btn wc-btn-primary" onClick={onCheckIn} disabled={busy || !changes}>{t('wc_checkin')}</button>
      </span>
    </div>
  )
}
