import { DEFAULT_SWITCH_KIND, portsOf } from './switchModel'

/**
 * What a planning drawing says about each object: it stays (Bestand), it is
 * built (Neubau) or it goes (Rückbau). A plan draws the three in black, red
 * and yellow — the colours a DB drawing reads them by.
 */
export const STATUSES = ['existing', 'new', 'removal']
export const STATUS_COLOR = { existing: '#000000', new: '#ff0000', removal: '#e6b400' }

const valid = (s) => (STATUSES.includes(s) ? s : null)

export const trackStatus = (track) => valid(track?.status) ?? 'existing'

/**
 * A switch's own status, or — where it states none — the one its tracks give
 * it: a turnout is built or taken out with its branch, a crossing with any of
 * its roads. New wins over removal, which is what a renewal on an otherwise
 * standing track looks like.
 */
export function switchStatus(sw, trackById) {
  const own = valid(sw?.status)
  if (own) return own
  const turnout = (sw.kind ?? DEFAULT_SWITCH_KIND) === 'turnout'
  const ports = portsOf(sw).filter(p => !turnout || p.port === 'B1')
  const found = ports.map(p => trackStatus(trackById.get(sw[p.trackKey])))
  if (found.includes('new')) return 'new'
  if (found.includes('removal')) return 'removal'
  return 'existing'
}
