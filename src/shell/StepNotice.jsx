import { useEffect, useState } from 'react'
import { redo, undo } from '../storage'
import { useLastStep } from '../hooks/useStore'
import { describeStep, stepTrackIds } from '../utils/stepLabel'
import { fitToTracks } from '../utils/mapRenderUtils'
import { FILTER_NONE, mapIsLive } from '../map/pick'
import { TRACKS_FLASH_LAYER } from '../map/layerIds'
import { useI18n } from '../locales/i18nContext'
import { useMap } from '../map/MapContext'
import CloseButton from '../components/form/CloseButton'

/** How long the notice stays [ms], and how long what a step changed stays lit. */
const NOTICE_MS = 7000
const FLASH_MS = 3500

/**
 * What the last step did, said once over the map (R10.3) — one place for
 * every panel instead of a text of each: „Gleis 6340.12393 angelegt“ with the
 * way back (Rückgängig), or after an undo the way forward again. The tracks
 * the step brought or changed light up for a moment, and „Zeigen“ goes there.
 */
export default function StepNotice() {
  const { t, fill } = useI18n()
  const map = useMap()
  const step = useLastStep()
  const [closed, setClosed] = useState(null)   // the serial of the step whose notice is gone

  // Only the step that is the newest one has a notice, and only for a while.
  useEffect(() => {
    if (!step) return undefined
    const timer = setTimeout(() => setClosed(step.serial), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [step])

  // What a step brought or changed, lit — not what an undo took away.
  const shownIds = step && step.kind !== 'undo' && step.kind !== 'refused' ? stepTrackIds(step.before, step.after) : []
  const idsKey = shownIds.join(',')
  useEffect(() => {
    const m = map?.current
    if (!m?.getLayer(TRACKS_FLASH_LAYER) || !idsKey) return undefined
    m.setFilter(TRACKS_FLASH_LAYER, ['in', ['get', 'trackId'], ['literal', idsKey.split(',')]])
    const timer = setTimeout(() => { if (mapIsLive(map, m)) m.setFilter(TRACKS_FLASH_LAYER, FILTER_NONE) }, FLASH_MS)
    return () => { clearTimeout(timer); if (mapIsLive(map, m) && m.getLayer(TRACKS_FLASH_LAYER)) m.setFilter(TRACKS_FLASH_LAYER, FILTER_NONE) }
  }, [map, idsKey, step?.serial])

  if (!step || closed === step.serial) return null
  // A write the store would not take (decision 260): nothing to undo or show.
  if (step.kind === 'refused') {
    return (
      <div className="step-notice" role="alert">
        <span className="step-notice-text msg-warn">{fill('notice_refused_locked', { names: step.refused.join(', ') })}</span>
        <CloseButton className="step-notice-close" onClick={() => setClosed(step.serial)} />
      </div>
    )
  }
  // An undo is told as the step it took back.
  const { key, params } = step.kind === 'undo' ? describeStep(step.after, step.before) : describeStep(step.before, step.after)
  const what = fill(key, params)
  const text = step.kind === 'undo' ? fill('notice_undone', { step: what })
    : step.kind === 'redo' ? fill('notice_redone', { step: what }) : what
  const show = () => fitToTracks(map?.current, step.after.tracks.filter(tr => shownIds.includes(tr.id)))
  return (
    <div className="step-notice" role="status">
      <span className="step-notice-text">{text}</span>
      {step.kind === 'undo'
        ? <button type="button" className="link-btn" onClick={() => redo()}>{t('tooltip_redo')}</button>
        : <button type="button" className="link-btn" onClick={() => undo()}>{t('notice_undo')}</button>}
      {shownIds.length > 0 && <button type="button" className="link-btn" onClick={show}>{t('notice_show')}</button>}
      <CloseButton className="step-notice-close" onClick={() => setClosed(step.serial)} />
    </div>
  )
}
