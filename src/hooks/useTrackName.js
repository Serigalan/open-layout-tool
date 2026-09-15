import { useMemo, useState } from 'react'
import { loadTracks, nextTrackName } from '../storage'
import { kmTrackName } from '../utils/lineLookup'
import useLineStation from './useLineStation'

/** Prefix a new track's name is built from: line number, station name, else 'track'. */
export function trackNamePrefix(fields) {
  if (fields?.type === 'line_track' && fields.lineNumber) return String(fields.lineNumber)
  if (fields?.type === 'station_track' && fields.stationName) return fields.stationName
  return 'track'
}

/**
 * Name for the track a form is about to create: it follows the metadata fields
 * until the user types one of their own, and follows them again after `reset`
 * (which a commit calls, so the next name also skips the track just saved).
 *
 * Given the track's `geometry` ({ epsg, path } in its plane), a DB line track is
 * placed on the line it lies on (see useLineStation) — its number and name go
 * into the fields through `setField` — and named after the kilometrage of its
 * middle, `6340.12393`. Until that is known, or where no line is near, the name
 * is numbered on from the prefix as before. `alsoTaken` are names another track
 * of the same form is about to take.
 *
 * Derived while rendering rather than pushed by an effect, so the field can
 * never show a name built from field values that have already changed.
 */
export default function useTrackName(projectId, fields, { geometry = null, setField = null, alsoTaken = [] } = {}) {
  const prefix = trackNamePrefix(fields)
  const [typed, setTyped] = useState(null)
  // Names already taken in the project — read when the form mounts, and again
  // on reset, which is when a commit has just added one.
  const [taken, setTaken] = useState(() => loadTracks(projectId).map(tr => tr.name))
  const station = useLineStation(fields, geometry, setField)
  const others = alsoTaken.filter(Boolean).join('\n')
  const suggested = useMemo(() => {
    const names = others ? [...taken, ...others.split('\n')] : taken
    return station
      ? kmTrackName(station.lineNumber, station.km, names)
      : nextTrackName(prefix, names)
  }, [prefix, taken, station, others])
  return {
    name: typed ?? suggested,
    setName: setTyped,
    reset: () => { setTyped(null); setTaken(loadTracks(projectId).map(tr => tr.name)) },
  }
}
