import { exportProjectsPayload } from '../../../storage'
import { downloadJSON } from '../../../utils/fileUtils'
import { useI18n } from '../../../locales/i18nContext'
import { useProject, useTracks } from '../../../hooks/useStore'
import ExchangeSection from './ExchangeSection'

/** The whole project as a file of the app's own format. */
export default function ProjectSection() {
  const { t, fill } = useI18n()
  const project = useProject()
  const tracks = useTracks()
  return (
    <ExchangeSection title={t('data_exchange_project')}
      description={fill('data_exchange_project_desc', { tracks: tracks.length })}>
      <button className="panel-btn panel-btn-full"
        onClick={() => downloadJSON(exportProjectsPayload(), project ? `${project.title}.json` : 'olt_projects.json')}>
        {t('data_exchange_export')}
      </button>
    </ExchangeSection>
  )
}
