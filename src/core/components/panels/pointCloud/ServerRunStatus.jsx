import { useI18n } from '../../../locales/i18nContext'

/**
 * A long run on the server while it waits or runs (AP 13.7): its progress,
 * that the window may be closed meanwhile, and — for whoever may — cancelling it.
 */
export default function ServerRunStatus({ run, mayCancel, onCancel }) {
  const { t } = useI18n()
  const queued = run.status === 'queued'
  return (
    <>
      {queued
        ? <progress className="full-width" />
        : <progress className="full-width" max={1} value={run.progress ?? 0} />}
      <span className="range-use">{t(queued ? 'server_run_queued' : 'server_run_running')}</span>
      {mayCancel && (
        <button className="panel-btn panel-btn-danger panel-btn-full" onClick={onCancel}>{t('btn_cancel')}</button>
      )}
    </>
  )
}
