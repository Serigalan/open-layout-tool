import { useEffect, useRef, useState } from 'react'
import { currentProject } from '../../../storage'
import { exportToOsrd, OSRD_URL } from '../../../utils/osrdExport'
import { downloadJSON } from '../../../utils/fileUtils'
import { useI18n } from '../../../locales/i18nContext'
import { useProject } from '../../../hooks/useStore'
import { ExternalLinkIcon } from '../../icons'
import FilePickButton from '../../form/FilePickButton'
import MessageList from '../../form/MessageList'
import ExchangeSection from './ExchangeSection'
import useRailJsonImport from './useRailJsonImport'

/**
 * How long the way to OSRD stays offered after an export [ms]. The file is in
 * the downloads folder at that point and the next step is to load it into OSRD,
 * so the link is put where the eye already is — but only for as long as that
 * export is what the user is thinking about.
 */
const OSRD_LINK_TIMEOUT = 30000

/** OSRD's RailJSON, out and in. */
export default function OsrdSection() {
  const { t } = useI18n()
  const project = useProject()
  const railJson = useRailJsonImport()
  const [exported, setExported] = useState(false)
  const timerRef = useRef(null)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const exportIt = () => {
    if (!project) return
    downloadJSON(exportToOsrd(currentProject()), `${project.title}_osrd.json`)
    clearTimeout(timerRef.current)
    setExported(true)
    timerRef.current = setTimeout(() => setExported(false), OSRD_LINK_TIMEOUT)
  }

  return (
    <ExchangeSection title={t('data_exchange_osrd')} description={t('data_exchange_osrd_desc')}>
      <a href={OSRD_URL} target="_blank" rel="noreferrer" className="external-link">
        {t('data_exchange_osrd_open')}
        <ExternalLinkIcon color="var(--color-primary)" />
      </a>
      {/* While the export is fresh the section shows the way on to OSRD in
          place of its own two buttons: that is the only thing there is to do
          with the file that just landed. */}
      {exported ? (
        <a href={OSRD_URL} target="_blank" rel="noreferrer" className="panel-btn panel-btn-full link-as-btn">
          {t('data_exchange_osrd_continue')}
          <ExternalLinkIcon color="currentColor" />
        </a>
      ) : (
        <>
          <button className="panel-btn panel-btn-full" onClick={exportIt}>{t('data_exchange_export')}</button>
          <FilePickButton accept=".json,application/json" disabled={!project} onFile={railJson.importFile}
            className="panel-btn panel-btn-full mt-2">
            {t('data_exchange_import')}
          </FilePickButton>
        </>
      )}
      <MessageList items={railJson.errors} small={false} />
    </ExchangeSection>
  )
}
