import { lazy } from 'react'
import BackButton from '../../core/components/panels/BackButton'

// The panel is its own chunk, loaded the first time it is opened (as the server's tools are).
const LocalSplicePanel = lazy(() => import('./LocalSplicePanel'))

export function LocalSpliceTool({ onExit }) {
  return (
    <>
      <BackButton onBack={onExit} />
      <LocalSplicePanel />
    </>
  )
}
