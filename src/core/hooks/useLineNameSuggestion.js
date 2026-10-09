import { useEffect, useRef } from 'react'
import { lineNameOf } from '../utils/lineLookup'

/** How long the number has to hold still before its name is looked up. */
const SETTLE_MS = 300

/**
 * Hook: the line name (Streckenbezeichnung) proposed from the line number —
 * whenever the number changes, the name of that line is written into the name
 * field through `setField('lineName', …)`.
 *
 * A name the user wrote stands. The field is only taken over while it is
 * empty or still holds the name of the number before, which is how a name
 * filled in here, or loaded with a track, follows the number along. A number
 * no line file knows leaves the name as it is; emptying the number takes a
 * proposed name with it.
 */
export default function useLineNameSuggestion(lineNumber, lineName, setField, active = true) {
  const number = active ? String(lineNumber ?? '').trim() : ''
  // The name of the number looked up last: what the field may still show
  // without it being the user's own.
  const previousRef = useRef(null)
  // Read when a lookup returns, which is renders after the one it started in.
  const lineNameRef = useRef(lineName)
  const setFieldRef = useRef(setField)
  useEffect(() => {
    lineNameRef.current = lineName
    setFieldRef.current = setField
  })

  useEffect(() => {
    if (!active) return
    const shown = () => String(lineNameRef.current ?? '')
    const proposed = () => shown() === '' || shown() === previousRef.current
    if (number === '') {
      if (previousRef.current && proposed()) setFieldRef.current('lineName', '')
      previousRef.current = null
      return
    }
    let live = true
    const timer = setTimeout(() => {
      lineNameOf(number)
        .then((name) => {
          if (!live || !name) return
          if (name !== shown() && proposed()) setFieldRef.current('lineName', name)
          previousRef.current = name
        })
        .catch((err) => console.warn('[useLineNameSuggestion]', err))
    }, SETTLE_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [number, active])
}
