import { Suspense, lazy } from 'react'
import BackButton from '../../core/components/panels/BackButton'

// The panels of the optimizer service as tools in the panels of core
// (`panelTools`, `importSections`, Paket L). Each is its own chunk (R9.1),
// loaded the first time it is opened.
const SpliceElementPanel = lazy(() => import('./SpliceElementPanel'))
const ReconnectPanel = lazy(() => import('./splice/ReconnectPanel'))
const OptimizeTrackPanel = lazy(() => import('./OptimizeTrackPanel'))
const MdbSection = lazy(() => import('./MdbSection'))

export function SpliceTool({ onExit }) {
  return (
    <>
      <BackButton onBack={onExit} />
      <SpliceElementPanel />
    </>
  )
}

export function ReconnectTool({ onExit }) {
  return (
    <>
      <BackButton onBack={onExit} />
      <ReconnectPanel />
    </>
  )
}

// The optimizer on one of its pages: a track, an element, or the alignment fit.
export function OptimizeTrackTool({ onExit, onShowRegelwerk }) {
  return <OptimizeTrackPanel initialPage="track" onExit={onExit} onShowRegelwerk={onShowRegelwerk} />
}

export function OptimizeElementTool({ onExit, onShowRegelwerk }) {
  return <OptimizeTrackPanel initialPage="element" onExit={onExit} onShowRegelwerk={onShowRegelwerk} />
}

export function AxisFitTool({ onExit, onShowRegelwerk }) {
  return <OptimizeTrackPanel initialPage="axis" onExit={onExit} onShowRegelwerk={onShowRegelwerk} />
}

export function MdbImport({ onReport }) {
  return <Suspense fallback={null}><MdbSection onReport={onReport} /></Suspense>
}

export function MdbDbrefImport({ onReport }) {
  return <Suspense fallback={null}><MdbSection dbref onReport={onReport} /></Suspense>
}
