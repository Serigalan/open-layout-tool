import { useEffect, useRef, useState } from 'react'
import { loadPlanHeader, savePlanHeader } from '../../../storage'
import { normalizeHeader } from '../../../utils/planHeader'

/** Pause in typing after which the title block is saved to the project [ms]. */
const HEADER_SAVE_DELAY = 500

/**
 * The title block's fields, kept in the project. The header is project
 * metadata; typing in it saves once the typing pauses rather than writing the
 * whole project on every key, and whatever is pending is saved when the
 * dialog closes. `onSaveFailed` hears of a header too large to store.
 */
export default function usePlanHeader(onSaveFailed) {
  const [header, setHeader] = useState(() => normalizeHeader(loadPlanHeader()))
  const pendingRef = useRef(null)
  const timerRef = useRef(null)
  const failedRef = useRef(onSaveFailed)
  useEffect(() => { failedRef.current = onSaveFailed })

  const flush = () => {
    clearTimeout(timerRef.current)
    timerRef.current = null
    if (!pendingRef.current) return
    const ok = savePlanHeader(pendingRef.current)
    pendingRef.current = null
    if (!ok) failedRef.current?.()
  }
  const flushRef = useRef(flush)
  useEffect(() => { flushRef.current = flush })
  useEffect(() => () => flushRef.current(), [])

  const change = (next) => {
    setHeader(next)
    pendingRef.current = next
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => flushRef.current(), HEADER_SAVE_DELAY)
  }
  return [header, change]
}
