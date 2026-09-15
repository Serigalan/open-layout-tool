import { useEffect, useRef, useState } from 'react'
import { identifyTrackLine } from '../utils/lineLookup'

/** How long the geometry has to hold still before the lines are looked up. */
const SETTLE_MS = 300

/**
 * Hook: the line a DB line track being drawn lies on — filled into its fields,
 * and handed back as `{ lineNumber, lineName, km }` for its name to be built
 * from (null while there is nothing to say).
 *
 * `geometry` is the track as it would be saved, `{ epsg, path }` in its plane,
 * or null while there is none yet. It is compared by content, so a caller may
 * build it afresh on every render.
 *
 * Once the geometry settles, the nearest line's number and name are written
 * into the fields through `setField`. A number the user entered or picked
 * stands: the kilometrage is read off that line instead, and its name is filled
 * in unless the user wrote one of their own. Emptying the number hands the
 * choice back.
 */
export default function useLineStation(fields, geometry, setField) {
  const active = fields.type === 'line_track' && fields.owner === 'DB' && geometry != null
  const current = String(fields.lineNumber ?? '')
  const geometryKey = active ? `${geometry.epsg}|${geometry.path.join(';')}` : null

  // The number this hook filled in last; any other number is the user's.
  const [filledNumber, setFilledNumber] = useState(null)
  const [result, setResult] = useState(null)
  const chosen = current !== '' && current !== filledNumber ? current : null

  // Dropped once the track is gone (committed, cancelled), so the next one does
  // not start out with the name of the last.
  const [wasActive, setWasActive] = useState(active)
  if (wasActive !== active) {
    setWasActive(active)
    if (!active) setResult(null)
  }

  // Read when a lookup returns, which is renders after the one it started in.
  const geometryRef = useRef(geometry)
  const lineNameRef = useRef(fields.lineName)
  const filledNameRef = useRef(null)
  useEffect(() => {
    geometryRef.current = geometry
    lineNameRef.current = fields.lineName
  })

  useEffect(() => {
    if (!geometryKey) return
    let live = true
    const timer = setTimeout(() => {
      identifyTrackLine(geometryRef.current, chosen)
        .then((hit) => {
          if (!live) return
          if (setField) {
            // Nothing near: a number filled in for an earlier position is no
            // longer true, so it goes — a number of the user's stays.
            if (!chosen) {
              setFilledNumber(hit ? String(hit.lineNumber) : null)
              setField('lineNumber', hit ? String(hit.lineNumber) : '')
            }
            const shown = lineNameRef.current ?? ''
            if (shown === '' || shown === filledNameRef.current) {
              filledNameRef.current = hit?.lineName ?? ''
              setField('lineName', filledNameRef.current)
            }
          }
          setResult(hit ? { lineNumber: String(hit.lineNumber), lineName: hit.lineName, km: hit.km } : null)
        })
        .catch((err) => console.warn('[useLineStation]', err))
    }, SETTLE_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [geometryKey, chosen, setField])

  return active && result && result.km != null && result.lineNumber === current ? result : null
}
