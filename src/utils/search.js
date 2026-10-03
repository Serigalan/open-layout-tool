import { trackKind } from './trackGroups'

// Finding tracks and switches by what a user would type (R10.6): any part of
// a name, a line number, a station, a track or switch number — case and
// surrounding spaces do not matter, and every word typed has to be found.

const norm = (v) => String(v ?? '').toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '')
const words = (query) => norm(query).split(/\s+/).filter(Boolean)
const matchesAll = (haystack, query) => {
  const hay = norm(haystack.filter(Boolean).join(' '))
  return words(query).every(w => hay.includes(w))
}

/** Whether `track` answers `query` and is of `kind` ('line', 'station', or '' for any). */
export function trackMatches(track, query, kind = '') {
  if (kind && trackKind(track) !== kind) return false
  return matchesAll([track.name, track.lineNumber, track.lineName, track.stationName, track.uicStation, track.trackNumber], query)
}

/** Whether `sw` answers `query`: its name, its form, its number. */
export function switchMatches(sw, query) {
  return matchesAll([sw.name, sw.label, sw.number, sw.switchId?.slice(0, 8)], query)
}
