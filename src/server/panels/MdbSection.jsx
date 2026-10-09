import { useState } from 'react'
import { commitImport, loadSwitches, loadTracks } from '../../core/storage'
import { EPSG_OPTIONS } from '../../core/utils/coordinateUtils'
import { ALL_STRECKEN } from '../../core/utils/import/mdbPipeline'
import { importMdb } from '../../core/utils/import/mdbImportJob'
import { useI18n } from '../../core/locales/i18nContext'
import { useProject } from '../../core/hooks/useStore'
import FilePickButton from '../../core/components/form/FilePickButton'
import MessageList from '../../core/components/form/MessageList'
import ExchangeSection from '../../core/components/panels/dataExchange/ExchangeSection'
import useMdbFile from './useMdbFile'
import useServiceHealth from '../useServiceHealth'
import useElapsed from '../../core/hooks/useElapsed'

/** The DB_REF planes an import can write. */
const DBREF_OPTIONS = EPSG_OPTIONS.filter(o => o.code >= 5681 && o.code <= 5685)

/**
 * An Access database of the DB ASCII interface, in one of two ways: `dbref`
 * false keeps every chain in the plane it was surveyed in, `dbref` true writes
 * them all into one DB_REF plane, for good (planeTransform). Two sections,
 * each with its own file and line picker: they are different questions asked
 * of the same kind of database. `onReport` keeps what each import had to say.
 */
export default function MdbSection({ dbref = false, onReport }) {
  const { t, fill } = useI18n()
  const project = useProject()
  const mdb = useMdbFile()
  const [withSwitches, setWithSwitches] = useState(true)
  const [target, setTarget] = useState('5684')
  // The conversion needs the optimizer service; without it the section says so (R10.12).
  const optimizerDown = useServiceHealth().optimizer.ok === false
  const elapsed = useElapsed(mdb.busy)

  const importIt = async () => {
    const payload = mdb.payloadRef.current
    if (!payload || !mdb.strecke || !project) return
    mdb.setBusy(true)
    try {
      const { notes, counts, commit } = await importMdb({
        payload, strecke: mdb.strecke, withSwitches, target: dbref ? Number(target) : null,
        existing: { tracks: loadTracks(), switches: loadSwitches() }, fill, signal: mdb.startRun(),
      })
      // Every import leaves its report behind, whether it placed anything or
      // not — that is the run whose messages someone comes back to.
      mdb.setErrors(notes)
      onReport?.({
        source: `${mdb.name || 'MDB'} · ${mdb.strecke === ALL_STRECKEN ? t('data_exchange_reports_all') : mdb.strecke}`,
        ...counts, lines: notes,
      })
      // One commit, one undo step — a whole database is thousands of tracks.
      if (commit) commitImport(commit)
    } catch (err) {
      mdb.setErrors([err?.name === 'AbortError' ? t('run_aborted') : `${t('import_parse_error')}: ${err.message}`])
    } finally {
      mdb.setBusy(false)
    }
  }

  return (
    <ExchangeSection title={t(dbref ? 'data_exchange_dbref' : 'data_exchange_mdb')}
      description={t(dbref ? 'data_exchange_dbref_desc' : 'data_exchange_mdb_desc')}>
      {optimizerDown && <p className="msg-warn msg-small">{t('service_needs_optimizer')}</p>}
      <FilePickButton accept=".mdb,.MDB,.accdb,application/x-msaccess" disabled={!project || mdb.busy || optimizerDown}
        title={optimizerDown ? t('service_needs_optimizer') : undefined} onFile={mdb.read}>
        {mdb.busy ? t('data_exchange_mdb_reading') : t('data_exchange_mdb_choose')}
      </FilePickButton>
      {/* A run of minutes says how long it has been going, and can be stopped. */}
      {mdb.busy && (
        <div className="run-status">
          <span>{fill('run_elapsed', { s: elapsed })}</span>
          <button type="button" className="link-btn" onClick={mdb.stop}>{t('btn_abort')}</button>
        </div>
      )}
      {mdb.counts && <p className="selecting-hint">{fill('data_exchange_mdb_counts', mdb.counts)}</p>}
      {mdb.strecken.length > 0 && (
        <>
          <div className="form-field mt-6">
            <label>{t('data_exchange_csv_line')}</label>
            <select className="settings-select" value={mdb.strecke} onChange={e => mdb.setStrecke(e.target.value)}>
              <option value={ALL_STRECKEN}>{fill('data_exchange_mdb_all', { n: mdb.strecken.length })}</option>
              {mdb.strecken.map(x => <option key={x.strecke} value={x.strecke}>{x.strecke} ({x.count})</option>)}
            </select>
          </div>
          {dbref && (
            <div className="form-field mt-6">
              <label>{t('data_exchange_dbref_target')}</label>
              <select className="settings-select" value={target} onChange={e => setTarget(e.target.value)}>
                {DBREF_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.code} – {o.label}</option>)}
              </select>
            </div>
          )}
          <label className="transition-curve-row">
            <input type="checkbox" checked={withSwitches} onChange={e => setWithSwitches(e.target.checked)} />
            <span>{t('data_exchange_mdb_switches')}</span>
          </label>
          <button className="panel-btn panel-btn-full mt-2" disabled={!mdb.strecke || mdb.busy} onClick={importIt}>
            {t('data_exchange_import')}
          </button>
        </>
      )}
      <MessageList items={mdb.errors} className="mt-6 scroll-list" />
    </ExchangeSection>
  )
}
