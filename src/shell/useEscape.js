import { useEffect, useRef } from 'react'
import { pushEscape } from './escape'

/** Escape cancels this form while `active` (R10.2 — see shell/escape). */
export default function useEscape(onEscape, active = true) {
  const fnRef = useRef(onEscape)
  useEffect(() => { fnRef.current = onEscape })
  useEffect(() => {
    if (!active) return undefined
    return pushEscape(() => fnRef.current?.())
  }, [active])
}
