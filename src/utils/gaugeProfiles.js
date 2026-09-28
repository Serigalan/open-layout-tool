/**
 * Clearance contours, as the regelwerk states them: DB Ril 800.0130A01, read
 * from src/constraints/db-ril-800-0130.json. Each is a half outline in the
 * track's own frame — [y, z] in millimetres, y from the track centre outwards,
 * z over the running plane. The other half is the mirror image and is built
 * where a closed outline is needed (gaugeProfileRing), so a contour is stated
 * once and cannot become asymmetric by a typing slip.
 *
 * Beside the outline, a profile states the areas inside it that parts of the
 * structure may reach into (`einragungen`) — closed outlines of their own,
 * stated on one side and mirrored the same way.
 *
 * A profile is chosen per project (`project.gaugeProfile`). Everything that
 * reads one knows only "an outline and its areas", so a further profile is a
 * further entry in the catalogue and nothing else.
 */

import QUERSCHNITT_KATALOG from '../constraints/db-ril-800-0130.json'

export { QUERSCHNITT_KATALOG }

const A01 = QUERSCHNITT_KATALOG.sources.find(s => s.id === QUERSCHNITT_KATALOG.lichtraum.source.ref)
// "DB Ril 800.0130A01 — Lichtraum" → "DB Ril 800.0130A01": a reference, not a
// name to translate — the same way a Ril's number is stated everywhere else.
export const LICHTRAUM_SOURCE = A01.title.split(' — ')[0]

export const GAUGE_PROFILES = Object.fromEntries(
  QUERSCHNITT_KATALOG.lichtraum.profile.map(p => [p.id, {
    id: p.id,
    points: p.umriss,
    einragungen: p.einragungen ?? [],
  }]))

// A project saved before the Ril's profiles came in names 'en15273_gc', which
// is gone; it falls back to this one, the profile that one approximated.
export const DEFAULT_GAUGE_PROFILE = 'hauptgleis'

/** The chosen profile, or the default where a project names one that is gone. */
export const gaugeProfile = (key) => GAUGE_PROFILES[key] ?? GAUGE_PROFILES[DEFAULT_GAUGE_PROFILE]

/**
 * Locale key naming a profile — "Hauptgleise"/"Nebengleise" are the Ril's own
 * words for what the profile is for, so the app speaks them, the way it
 * speaks every other name a catalogue states about itself (see
 * switchKindLabelKey). Paired with LICHTRAUM_SOURCE where a reader needs to
 * know which regelwerk a profile is from.
 */
export const gaugeProfileLabelKey = (id) => `constraints_querschnitt_profil_${id}`

const onAxis = ([y]) => y === 0
// Mirroring the centre line itself must give 0, not the −0 the negation would.
const mirror = ([y, z]) => [onAxis([y]) ? 0 : -y, z]

const closed = (points) => {
  const first = points[0], last = points[points.length - 1]
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first]
}

/**
 * The closed outline of a profile: the stated half, then its mirror image back
 * to the start. A point on the centre line is its own mirror image and is kept
 * once, so the ring has no doubled vertex where the halves meet.
 */
export function gaugeProfileRing(points) {
  if (!points?.length) return []
  const back = [...points].reverse().map(mirror)
  return closed([...points, ...(onAxis(points[points.length - 1]) ? back.slice(1) : back)])
}

/**
 * The areas of a profile that may be reached into, each closed and each once
 * as stated and once mirrored — they lie on both sides of the track, like the
 * outline they are cut out of. An area lying on the centre line would be its
 * own mirror image and is kept once.
 */
export function gaugeProfileAreas(areas) {
  const out = []
  for (const area of areas ?? []) {
    if (!area.length) continue
    out.push(closed(area))
    if (!area.every(onAxis)) out.push(closed(area.map(mirror)))
  }
  return out
}
