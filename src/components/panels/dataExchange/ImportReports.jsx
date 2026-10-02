import { useState } from 'react'
import { downloadText } from '../../../utils/fileUtils'
import { useI18n } from '../../../locales/i18nContext'
import ExchangeSection from './ExchangeSection'

const reportFileName = (at) => `import-${new Date(at).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`

/** The kept reports, newest first, each opened on its own. */
export default function ImportReports({ reports, onClear }) {
  const { t, fill } = useI18n()
  const [open, setOpen] = useState(null)   // the `at` of the open report
  return (
    <ExchangeSection title={t('data_exchange_reports')} description={t('data_exchange_reports_desc')}>
      {reports.length === 0 && <p className="selecting-hint">{t('data_exchange_reports_none')}</p>}
      {reports.map(r => (
        <div key={r.at}>
          <button className="panel-btn panel-btn-full mt-2" aria-expanded={open === r.at}
            onClick={() => setOpen(open === r.at ? null : r.at)}>
            {fill('data_exchange_reports_entry', { when: new Date(r.at).toLocaleString(), source: r.source ?? '', n: r.lines?.length ?? 0 })}
          </button>
          {open === r.at && (
            <>
              <p className="selecting-hint">
                {fill('data_exchange_reports_result', { tracks: r.tracks ?? 0, switches: r.switches ?? 0 })}
              </p>
              <div className="mt-4 scroll-list-tall">
                {(r.lines ?? []).map((line, j) => <p className="msg-error msg-small" key={j}>{line}</p>)}
                {r.cut > 0 && <p className="selecting-hint">{fill('data_exchange_reports_cut', { n: r.cut })}</p>}
              </div>
              <button className="panel-btn panel-btn-full mt-2"
                onClick={() => downloadText([r.source, new Date(r.at).toISOString(), '', ...(r.lines ?? [])].join('\n'), reportFileName(r.at))}>
                {t('data_exchange_reports_save')}
              </button>
            </>
          )}
        </div>
      ))}
      {reports.length > 0 && (
        <button className="panel-btn panel-btn-full mt-6" onClick={() => { onClear(); setOpen(null) }}>
          {t('data_exchange_reports_clear')}
        </button>
      )}
    </ExchangeSection>
  )
}
