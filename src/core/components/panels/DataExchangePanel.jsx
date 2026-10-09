import { useState } from 'react'
import { useI18n } from '../../locales/i18nContext'
import ExchangeSection from './dataExchange/ExchangeSection'
import ProjectSection from './dataExchange/ProjectSection'
import CompareSection from './dataExchange/CompareSection'
import TracksSection from './dataExchange/TracksSection'
import VermEsnSection from './dataExchange/VermEsnSection'
import OsrdSection from './dataExchange/OsrdSection'
import CsvSection from './dataExchange/CsvSection'
import MdbSection from '../../../server/panels/MdbSection'
import AlignmentSection from './dataExchange/AlignmentSection'
import ImportReports from './dataExchange/ImportReports'
import useImportReports from './dataExchange/useImportReports'
import ProviImportSection from './ProviImportSection'

/**
 * Data exchange: one section per format (R5.1). Behind the dot at the bottom
 * are the imports and exports needed now and then rather than every session —
 * the comparison with a file, Provi, the Gleislage CSV, the two MDB importers
 * with the reports they leave, and the alignment exchange format.
 */
export default function DataExchangePanel({ onShowCompare }) {
  const { t } = useI18n()
  const [more, setMore] = useState(false)
  const reports = useImportReports()

  return (
    <>
      <h2>{t('data_exchange')}</h2>
      <ProjectSection />
      <TracksSection />
      <VermEsnSection />
      <OsrdSection />
      {more && (
        <>
          <CompareSection onShowCompare={onShowCompare} />
          <ExchangeSection title={t('data_exchange_provi')} description={t('data_exchange_provi_desc')}>
            <ProviImportSection onReport={(source, counts, lines) => reports.add({ source, ...counts, lines })} />
          </ExchangeSection>
          <CsvSection />
          <MdbSection onReport={reports.add} />
          <MdbSection dbref onReport={reports.add} />
          <ImportReports reports={reports.reports} onClear={reports.clear} />
          <AlignmentSection />
        </>
      )}
      <div className="panel-dot-row">
        <button className={`panel-dot${more ? ' active' : ''}`} title={t('data_exchange_more')}
          aria-label={t('data_exchange_more')} aria-expanded={more} onClick={() => setMore(o => !o)} />
      </div>
    </>
  )
}
