import { useState } from 'react'
import { clearImportReports, loadImportReports, saveImportReport } from '../../../storage'
import { useProject } from '../../../hooks/useStore'

const reportsOf = (id) => ({ id, reports: id ? loadImportReports() : [] })

/**
 * What the imports of this project had to say, kept in the store so it
 * survives the panel being closed and the page being reloaded. Another
 * project open, its own reports.
 */
export default function useImportReports() {
  const projectId = useProject()?.id
  const [state, setState] = useState(() => reportsOf(projectId))
  if (state.id !== projectId) setState(reportsOf(projectId))
  return {
    reports: state.reports,
    add: (report) => setState({ id: projectId, reports: saveImportReport(report) }),
    clear: () => { clearImportReports(); setState({ id: projectId, reports: [] }) },
  }
}
