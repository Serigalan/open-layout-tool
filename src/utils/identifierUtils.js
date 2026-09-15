import { DEFAULT_HEIGHT_EPSG } from './mapConstants'

export const TYPE_CODES    = { line_track: 1n, station_track: 2n }
export const SIDE_CODES    = { sorting: 1n, non_sorting: 2n }

export const TYPE_NAMES    = { 1: 'line_track', 2: 'station_track' }
export const SIDE_NAMES    = { 1: 'sorting', 2: 'non_sorting' }

/**
 * Returns the metadata fields relevant to the selected track type, plus the
 * height datum every track has. Fields from the other type are explicitly set
 * to null. Empty strings are stored as null.
 */
export function buildTypeFields(fields) {
  const str = v => (v != null && String(v).trim() !== '' ? String(v).trim() : null)
  const num = v => (v != null && String(v).trim() !== '' ? Number(v) : null)
  const heightEpsg = num(fields.heightEpsg) || DEFAULT_HEIGHT_EPSG

  if (fields.type === 'line_track') {
    return {
      lineNumber: num(fields.lineNumber),
      lineName:   str(fields.lineName),
      side:       fields.side ? Number(SIDE_CODES[fields.side]) : null,
      heightEpsg,
    }
  }
  return {
    stationName: str(fields.stationName),
    uicStation:  str(fields.uicStation),
    trackNumber: num(fields.trackNumber),
    heightEpsg,
  }
}


// ── Switch numbering ────────────────────────────────────────────────────────

/** Designations are composed from the number: 8 → `switch.008`. */
const SWITCH_PREFIX = 'switch'

export const switchDesignation = (number) =>
  `${SWITCH_PREFIX}.${String(number).padStart(3, '0')}`

/**
 * The number a switch carries. Records written before numbering existed have
 * only their designation, so the number is read back out of that.
 */
export function switchNumberOf(sw) {
  if (Number.isFinite(sw?.number)) return sw.number
  const match = /^switch\.(\d+)$/.exec(sw?.name ?? '')
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
