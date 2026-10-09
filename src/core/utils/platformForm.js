import { PLATFORM_FRONT_OFFSET, PLATFORM_WIDTH, PLATFORM_HEIGHTS, DEFAULT_PLATFORM_HEIGHT } from './platformUtils'
import { trackLength } from './heightUtils'

// The platform dialog's fields, apart from the dialog (R5.5): what a new one
// starts with, what an existing record fills in, and the record they make.

/** Shortest platform that is worth drawing [m]. */
const MIN_LENGTH = 1

const stationText = (v) => String(Math.round(v * 1000) / 1000)

/** A new platform's fields: no track, no stations, right of the track, the standard height and edge. */
export const EMPTY_PLATFORM_FORM = Object.freeze({
  trackId: null, start: '', end: '', side: 'right',
  height: DEFAULT_PLATFORM_HEIGHT,     // mm over top of rail
  freeHeight: false,                   // a height outside the standard ones
  stationName: '', code: '',
  // The edge distance is proposed, not fixed: one value for every height and
  // cant at this design stage, and overridable where the site demands it.
  frontOffset: PLATFORM_FRONT_OFFSET,
})

/**
 * The fields of a stored platform. A record from before the height was
 * modelled has none; it is shown the default rather than an empty field.
 */
export function platformForm(platform) {
  const h = Number(platform.height)
  const height = Number.isFinite(h) ? h : DEFAULT_PLATFORM_HEIGHT
  const offset = Number(platform.frontOffset)
  return {
    trackId: platform.trackId,
    start: stationText(platform.startStation), end: stationText(platform.endStation),
    side: platform.side ?? 'right',
    height, freeHeight: !PLATFORM_HEIGHTS.includes(height),
    stationName: platform.stationName ?? '', code: platform.code ?? '',
    frontOffset: Number.isFinite(offset) ? offset : PLATFORM_FRONT_OFFSET,
  }
}

/** A station picked on the map, as the field shows it. */
export const pickedStation = stationText

/** The record the fields make — stations in order, the back edge a platform width behind the front. */
export function platformDraft(f) {
  const s1 = Number(f.start), s2 = Number(f.end), front = Number(f.frontOffset)
  return {
    trackId: f.trackId,
    startStation: Math.min(s1, s2), endStation: Math.max(s1, s2),
    side: f.side, frontOffset: front, backOffset: front + PLATFORM_WIDTH,
    height: f.height, stationName: f.stationName, code: f.code,
  }
}

/** Whether the fields make a platform on `track`: both stations on it, long enough, an edge and a height. */
export function platformFormValid(f, track) {
  if (!track) return false
  const total = trackLength(track)
  const s = [Number(f.start), Number(f.end)]
  return s.every(v => Number.isFinite(v) && v >= 0 && v <= total + 1e-6)
    && Math.abs(s[1] - s[0]) >= MIN_LENGTH
    && Number(f.frontOffset) > 0
    && f.height !== '' && Number(f.height) >= 0
}
