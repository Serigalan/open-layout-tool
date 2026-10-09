import { lazy } from 'react'
import { useI18n } from '../core/locales/i18nContext'
import ConfirmModal from '../core/components/ConfirmModal'
import WorkingCopyBar from './collab/WorkingCopyBar'
import { currentWorkingCopy } from './workingCopies'

const ConflictDialog = lazy(() => import('./collab/ConflictDialog'))
const CheckInDialog = lazy(() => import('./collab/CheckInDialog'))

/**
 * The working copy over the map (AP 10.6, R2.5): its bar — check in, update,
 * throw away, show the changes — the one-line note on the last sync, and the
 * dialogs those open. `wc` is useWorkingCopy's; what the map view hands its
 * extras (`mapVersion`, `setCompare`) comes with it.
 */
export default function WorkingCopyLayer({ wc, mapVersion, setCompare }) {
  const { t, fill } = useI18n()
  return (
    <>
      {wc.wc && (
        <WorkingCopyBar projectTitle={wc.wc.project.title} variantName={wc.wc.variant.name} base={wc.base}
          changes={wc.changes.length} serverNewer={wc.serverNewer} busy={wc.busy}
          onCheckIn={wc.askCheckIn}
          onUpdate={() => wc.startUpdate()}
          onDiscard={wc.askDiscard}
          onShowChanges={() => setCompare({
            before: currentWorkingCopy().basePayload, after: currentWorkingCopy().project,
            beforeLabel: `${wc.wc.variant.name} · ${t('wc_base')}`, afterLabel: t('wc_working_copy'),
          })} />
      )}
      {wc.note && <button type="button" className="wc-note" onClick={wc.clearNote}>{wc.note}</button>}
      {wc.syncDialog?.kind === 'merge' && (
        <ConflictDialog mapVersion={mapVersion} result={wc.syncDialog.prepared.result} busy={wc.busy}
          title={t('wc_merge_title')} mineLabel={t('wc_working_copy')}
          theirsLabel={`${t('wc_server')} (${wc.syncDialog.prepared.head.author.name})`}
          onCancel={wc.cancelDialog} onApply={wc.applyMerge} />
      )}
      {wc.syncDialog?.kind === 'discard' && (
        <ConfirmModal message={fill('wc_discard_ask', { n: wc.changes.length })} confirmLabel={t('wc_discard')}
          busy={wc.busy} onConfirm={wc.discardChanges} onCancel={wc.cancelDialog} />
      )}
      {wc.syncDialog?.kind === 'checkin' && (
        <CheckInDialog changes={wc.changes} errors={wc.syncDialog.errors} busy={wc.busy}
          onCancel={wc.cancelDialog} onSubmit={wc.submitCheckIn} />
      )}
    </>
  )
}
