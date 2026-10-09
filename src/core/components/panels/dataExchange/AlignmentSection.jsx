import { currentProject } from '../../../storage'
import { exportExchange, FORMAT_VERSION } from '../../../utils/exchangeExport'
import { downloadJSON } from '../../../utils/fileUtils'
import { useI18n } from '../../../locales/i18nContext'
import { useProject } from '../../../hooks/useStore'
import FilePickButton from '../../form/FilePickButton'
import MessageList from '../../form/MessageList'
import ExchangeSection from './ExchangeSection'
import useRailJsonImport from './useRailJsonImport'

/**
 * The alignment exchange format: the same tracks as the OSRD export, but with
 * the design data itself — element chain and heights.
 */
export default function AlignmentSection() {
  const { t, fill } = useI18n()
  const project = useProject()
  const railJson = useRailJsonImport()
  return (
    <ExchangeSection title={t('data_exchange_alignment')}
      description={fill('data_exchange_alignment_desc', { version: FORMAT_VERSION })}>
      <button className="panel-btn panel-btn-full" disabled={!project}
        onClick={() => downloadJSON(exportExchange(currentProject()), `${project.title}_trassierung.json`)}>
        {t('data_exchange_export')}
      </button>
      <FilePickButton accept=".json,application/json" disabled={!project} onFile={railJson.importFile}
        className="panel-btn panel-btn-full mt-2">
        {t('data_exchange_import')}
      </FilePickButton>
      <MessageList items={railJson.errors} small={false} />
    </ExchangeSection>
  )
}
