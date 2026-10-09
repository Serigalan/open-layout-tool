import { DEFAULT_HEIGHT_EPSG } from './heightDatums'

/** A new random id for a track, switch, platform, mark … */
export function generateId() {
  return crypto.randomUUID()
}

export const TYPE_CODES    = { line_track: 1n, station_track: 2n }
export const SIDE_CODES    = { sorting: 1n, non_sorting: 2n }

export const TYPE_NAMES    = { 1: 'line_track', 2: 'station_track' }
export const SIDE_NAMES    = { 1: 'sorting', 2: 'non_sorting' }

/** The line categories the rulebook tells apart (gradientCheck), in the order a form offers them. */
export const LINE_CATEGORIES = ['main', 'secondary', 's_bahn']
/** Main track or siding; a track is a main track unless it says otherwise. */
export const TRACK_USES = ['main', 'siding']

/**
 * Returns the type and the metadata fields relevant to it, plus the height
 * datum and the use (main track or siding) every track has. Fields of the
 * other type are left as they are — a station track keeps the line number its
 * kilometrage is read off. Empty strings are stored as null.
 *
 * The line category and the use are only written where they say something: a
 * line track without a category of its own runs on the project's, and a track
 * is a main track unless it is a siding. Left undefined they clear what the
 * track carried, and a store that never had them stays without.
 */
export function buildTypeFields(fields) {
  const str = v => (v != null && String(v).trim() !== '' ? String(v).trim() : null)
  const num = v => (v != null && String(v).trim() !== '' ? Number(v) : null)
  const heightEpsg = num(fields.heightEpsg) || DEFAULT_HEIGHT_EPSG
  const trackUse = fields.trackUse === 'siding' ? 'siding' : undefined

  if (fields.type === 'line_track') {
    return {
      trackType:  Number(TYPE_CODES.line_track),
      lineNumber: num(fields.lineNumber),
      lineName:   str(fields.lineName),
      side:       fields.side ? Number(SIDE_CODES[fields.side]) : null,
      lineCategory: LINE_CATEGORIES.includes(fields.lineCategory) ? fields.lineCategory : undefined,
      trackUse,
      heightEpsg,
    }
  }
  return {
    trackType:   Number(TYPE_CODES.station_track),
    stationName: str(fields.stationName),
    uicStation:  str(fields.uicStation),
    trackNumber: num(fields.trackNumber),
    trackUse,
    heightEpsg,
  }
}


// ── Switch numbering ────────────────────────────────────────────────────────

/**
 * Designations are composed from the number: 8 → `switch.008`. A crossing is
 * no switch — its kinds carry the crossing prefix, so the plan and the OSRD
 * label name it for what it is.
 */
const SWITCH_PREFIX   = 'switch'
const CROSSING_PREFIX = 'crossing'

/** The prefix a kind's designation carries. */
const switchPrefix = (kind) =>
  (kind && kind !== 'turnout' ? CROSSING_PREFIX : SWITCH_PREFIX)

export const switchDesignation = (number, kind = null) =>
  `${switchPrefix(kind)}.${String(number).padStart(3, '0')}`

/**
 * The number a switch carries. Records written before numbering existed have
 * only their designation, so the number is read back out of that.
 */
export function switchNumberOf(sw) {
  if (Number.isFinite(sw?.number)) return sw.number
  const match = /^(?:switch|crossing)\.(\d+)$/.exec(sw?.name ?? '')
  return match ? Number(match[1]) : null
}

/** The numbers a project has already given out. */
export const switchNumbersInUse = (switches) =>
  new Set((switches ?? []).map(switchNumberOf).filter(n => n != null))

/** The lowest number no switch of the project holds yet. */
export function nextSwitchNumber(switches, alsoTaken = []) {
  const used = switchNumbersInUse(switches)
  for (const n of alsoTaken) used.add(n)
  for (let i = 1; i <= 999; i++) if (!used.has(i)) return i
  return used.size + 1
}
