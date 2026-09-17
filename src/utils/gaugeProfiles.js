/**
 * Clearance contours, as half outlines in the track's own frame: [y, z] in
 * millimetres, y from the track centre outwards, z over the running plane,
 * stated from the centre line outwards. The other half is the mirror image and
 * is built where a closed outline is needed (gaugeProfileRing), so a contour is
 * stated once and cannot become asymmetric by a typing slip.
 *
 * A profile is chosen per project (`project.gaugeProfile`). Everything that
 * reads one knows only "an outline", so a further profile is a further entry
 * here and nothing else — which is the point of keeping them in their own file.
 */

export const GAUGE_PROFILES = {
  en15273_gc: {
    label: 'EN 15273-1 · GC',
    points: [[0, 0], [1275, 0], [1680, 380], [1680, 760], [2500, 760], [2500, 3050],
      [1860, 4900], [0, 4900]],
    // Reference lines the profile is read against — drawn dashed, stated the
    // same way as the contour and mirrored with it.
    guides: [
      [[1275, 0], [2500, 0], [2500, 760]],
      [[2200, 760], [2200, 3900]],
    ],
  },
}

export const DEFAULT_GAUGE_PROFILE = 'en15273_gc'

/** The chosen profile, or the default where a project names one that is gone. */
export const gaugeProfile = (key) => GAUGE_PROFILES[key] ?? GAUGE_PROFILES[DEFAULT_GAUGE_PROFILE]

const onAxis = ([y]) => y === 0
// Mirroring the centre line itself must give 0, not the −0 the negation would.
const mirror = ([y, z]) => [onAxis([y]) ? 0 : -y, z]

/**
 * The closed outline of a profile: the stated half, then its mirror image back
 * to the start. A point on the centre line is its own mirror image and is kept
 * once, so the ring has no doubled vertex where the halves meet.
 */
/**
 * The reference lines of a profile, each polyline once as stated and once
 * mirrored — they belong to both halves, like the contour they are read against.
 * A line lying on the centre line would be its own mirror image and is kept once.
 */
export function gaugeProfileGuides(guides) {
  const out = []
  for (const line of guides ?? []) {
    out.push(line)
    const flipped = line.map(mirror)
    if (!line.every(onAxis)) out.push(flipped)
  }
  return out
}

export function gaugeProfileRing(points) {
  if (!points?.length) return []
  const back = [...points].reverse().map(mirror)
  const ring = [...points, ...(onAxis(points[points.length - 1]) ? back.slice(1) : back)]
  const first = ring[0], last = ring[ring.length - 1]
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first]
}
