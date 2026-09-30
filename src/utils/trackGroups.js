import { TYPE_CODES } from './identifierUtils'

/**
 * Tracks by what they belong to — the line (Strecke) a line track runs on,
 * the station (Bahnhof) a station track lies in — for the lists that show a
 * project's tracks, and for the choice of what to assign a track to.
 */

const LINE    = Number(TYPE_CODES.line_track)
const STATION = Number(TYPE_CODES.station_track)

const text = (v) => (v != null ? String(v).trim() : '')

/**
 * 'line', 'station' or null. The type a track states decides; tracks written
 * before the type was stored say it only through the fields they carry — a
 * station name makes a station track, a line number a line track.
 */
export function trackKind(track) {
  if (track?.trackType === LINE) return 'line'
  if (track?.trackType === STATION) return 'station'
  if (text(track?.stationName) || text(track?.uicStation)) return 'station'
  if (text(track?.lineNumber)) return 'line'
  return null
}

/**
 * The type a form shows for a track, `line_track` or `station_track` — as it
 * states it or its fields tell (see trackKind), else `fallback`.
 */
export function trackTypeName(track, fallback) {
  const kind = trackKind(track)
  return kind ? `${kind}_track` : fallback
}

/**
 * The group a track falls in: `line:6340`, `station:halle (saale) hbf`, or
 * null where its kind names nothing to group it under. A station is known by
 * its name rather than its UIC number — the number is often missing on some
 * of its tracks, the name never is on a station track that says anything.
 */
export function trackGroupKey(track) {
  const kind = trackKind(track)
  if (kind === 'line') {
    const number = text(track.lineNumber)
    return number ? `line:${number}` : null
  }
  if (kind === 'station') {
    const name = text(track.stationName).toLowerCase()
    const uic = text(track.uicStation)
    if (name) return `station:${name}`
    return uic ? `station:#${uic}` : null
  }
  return null
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const byName = (a, b) => collator.compare(a.name || a.id, b.name || b.id)

/**
 * The tracks in groups: lines by number, then stations by name, then the
 * tracks that belong to neither. Each group is
 * `{ key, kind, lineNumber, lineName, stationName, uicStation, tracks }`, its
 * name and number taken from the first track that states them; the tracks
 * in it are sorted by name. The unassigned group has key 'none' and kind
 * null, and is left out where it would be empty.
 */
export function groupTracks(tracks) {
  const groups = new Map()
  const none = []
  for (const track of tracks ?? []) {
    const key = trackGroupKey(track)
    if (!key) { none.push(track); continue }
    let group = groups.get(key)
    if (!group) {
      group = {
        key, kind: trackKind(track),
        lineNumber: null, lineName: null, stationName: null, uicStation: null,
        tracks: [],
      }
      groups.set(key, group)
    }
    if (group.kind === 'line') {
      group.lineNumber ??= text(track.lineNumber) || null
      group.lineName ??= text(track.lineName) || null
    } else {
      group.stationName ??= text(track.stationName) || null
      group.uicStation ??= text(track.uicStation) || null
    }
    group.tracks.push(track)
  }

  const sorted = [...groups.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'line' ? -1 : 1
    return a.kind === 'line'
      ? collator.compare(a.lineNumber, b.lineNumber)
      : collator.compare(a.stationName ?? a.uicStation, b.stationName ?? b.uicStation)
  })
  if (none.length) {
    sorted.push({
      key: 'none', kind: null,
      lineNumber: null, lineName: null, stationName: null, uicStation: null,
      tracks: none,
    })
  }
  for (const group of sorted) group.tracks.sort(byName)
  return sorted
}

/**
 * What a group is called: `6340 · Halle–Könnern`, `Halle (Saale) Hbf`. The
 * caller puts the word for the kind in front, or the word for none.
 */
export function groupTitle(group) {
  if (group.kind === 'line') return [group.lineNumber, group.lineName].map(text).filter(Boolean).join(' · ')
  if (group.kind === 'station') return text(group.stationName) || text(group.uicStation)
  return ''
}

/** What a group's header says: `Strecke 6340 · Halle–Könnern`, `Bahnhof Halle (Saale) Hbf`, `Nicht zugeordnet`. */
export function groupHeading(t, group) {
  if (!group.kind) return t('track_group_none')
  return `${t(group.kind === 'line' ? 'track_group_line' : 'track_group_station')} ${groupTitle(group)}`
}

/** The label a track carries in a list of tracks. */
export const trackListLabel = (track) => track.name || track.id.slice(0, 8)

/**
 * The fields that put a track on a line or into a station, to be spread over
 * it: `{ kind: 'line', lineNumber, lineName }` or
 * `{ kind: 'station', stationName, uicStation }`. Only the fields of the kind
 * assigned are written — a station track keeps the line number its
 * kilometrage is read off. `kind: null` takes the track out of whatever it
 * was in: its type and the fields that named the group go.
 */
export function assignmentFields(target) {
  const str = (v) => text(v) || null
  if (target?.kind === 'line') {
    return { trackType: LINE, lineNumber: Number(text(target.lineNumber)), lineName: str(target.lineName) }
  }
  if (target?.kind === 'station') {
    return { trackType: STATION, stationName: str(target.stationName), uicStation: str(target.uicStation) }
  }
  return { trackType: undefined, lineNumber: null, lineName: null, stationName: null, uicStation: null }
}

/** `tracks` with those whose id is in `ids` assigned to `target` (see assignmentFields). */
export function assignTracks(tracks, ids, target) {
  const wanted = new Set(ids)
  const fields = assignmentFields(target)
  return tracks.map(track => (wanted.has(track.id) ? { ...track, ...fields } : track))
}
