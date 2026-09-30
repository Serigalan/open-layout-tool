import { TYPE_CODES } from './identifierUtils'
import { kmTrackName } from './lineLookup'
import { nextTrackName } from '../storage'

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

/**
 * `tracks` with those whose id is in `ids` assigned to `target` (see
 * assignmentFields). `names` (id → name) renames them as it goes, and
 * `trackNumbers` (id → number, '' for none) states their track numbers — what
 * a station track's name is built from.
 */
export function assignTracks(tracks, ids, target, { names = null, trackNumbers = null } = {}) {
  const wanted = new Set(ids)
  const fields = assignmentFields(target)
  return tracks.map((track) => {
    if (!wanted.has(track.id)) return track
    const out = { ...track, ...fields }
    if (names?.has(track.id)) out.name = names.get(track.id)
    if (trackNumbers && track.id in trackNumbers) {
      const number = text(trackNumbers[track.id])
      // `3a` stays as written; a plain number is stored as one, as the forms do.
      out.trackNumber = /^\d+$/.test(number) ? Number(number) : number || null
    }
    return out
  })
}

/**
 * The names the tracks `ids` take on `target`, as `{ names, fallback,
 * clashes }`: `names` maps id → name, `fallback` holds the ids named without
 * what the name should be built from, `clashes` those whose name another
 * track already has.
 *
 * On a line the name is the line number and the kilometrage of the track's
 * middle, `6344.02912` (see kmTrackName) — `kmById` says where each lies, null
 * where the line does not reach it; those are numbered on, `6344.001`. In a
 * station it is the station and the track number, `Könnern.3`, from
 * `numberById`; a track without one is numbered on, `Könnern.001`.
 *
 * The names of the other tracks are taken; the ones renamed give theirs up.
 * On a line a taken name moves on by ten metres, so none clash; in a station
 * a number given twice, or a name some other track has, does.
 */
export function plannedNames(tracks, ids, target, { kmById = {}, numberById = {} } = {}) {
  const wanted = new Set(ids)
  const taken = new Set(tracks.filter(tr => !wanted.has(tr.id)).map(tr => tr.name).filter(Boolean))
  const names = new Map()
  const fallback = new Set()
  const clashes = new Set()

  if (target?.kind === 'line') {
    const number = text(target.lineNumber)
    // Nearest the start of the line first, so the steps a clash takes run the
    // same way as the kilometrage.
    const order = [...ids].sort((a, b) => (kmById[a] ?? Infinity) - (kmById[b] ?? Infinity))
    for (const id of order) {
      const km = kmById[id]
      const name = km != null ? kmTrackName(number, km, taken) : nextTrackName(number, [...taken])
      if (km == null) fallback.add(id)
      names.set(id, name)
      taken.add(name)
    }
  } else if (target?.kind === 'station') {
    const prefix = text(target.stationName) || text(target.uicStation)
    const numbered = ids.filter(id => text(numberById[id]))
    const seen = new Map()
    for (const id of numbered) {
      const name = `${prefix}.${text(numberById[id])}`
      if (taken.has(name)) clashes.add(id)
      if (seen.has(name)) { clashes.add(id); clashes.add(seen.get(name)) }
      seen.set(name, id)
      names.set(id, name)
    }
    for (const name of seen.keys()) taken.add(name)
    for (const id of ids.filter(id => !text(numberById[id]))) {
      const name = nextTrackName(prefix, [...taken])
      fallback.add(id)
      names.set(id, name)
      taken.add(name)
    }
  }
  return { names, fallback, clashes }
}
