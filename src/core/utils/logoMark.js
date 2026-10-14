/**
 * The Open Layout Tool mark, in a 228 × 158 box: one track that writes O, L
 * and T on a blue ground with rounded corners. It comes in along the
 * baseline, runs round the O and ends inside it, leaves the O's top by a
 * switch into the line along the top, branches off that into the L and runs
 * on as the T's bar, the T's stem branching off it in turn. The track is
 * drawn as a pair of rails — a wide stroke with a thin one in the ground's
 * colour on it — white in the letters, half-transparent white between them,
 * which reads as a lighter shade of whatever the ground is: the app draws the
 * ground in the user's primary colour, the plan and the favicon in the
 * default one. Lines end square (butt caps), as both plan backends draw them.
 * public/favicon.svg is the whole mark on a square ground, drawn simple:
 * every line of it, each a single stroke of the same width without the inner
 * rail, white in the letters and MARK_LINK_BLUE between them.
 */

import { PALETTE } from '../styles/palette'

export const MARK_WIDTH = 228
export const MARK_HEIGHT = 158
const MARK_RADIUS = 24
export const MARK_BLUE = PALETTE.primaryDefault
/** The track between the letters: white at this opacity over the ground… */
export const MARK_LINK_OPACITY = 0.45
/** …which over MARK_BLUE comes to this, for the plan backends, which draw opaque. */
export const MARK_LINK_BLUE = '#8d8fbb'
/** Stroke width of the track, and of the inner rail drawn on it. */
export const MARK_RAIL = 14
export const MARK_INNER = 3.6

/** The letters: the O, open at its lower left, the L and the T. */
export const MARK_LETTERS =
  'M44 116 H66.5 A18.5 18.5 0 0 0 85 97.5 V60.5 A18.5 18.5 0 0 0 66.5 42 H62.5 A18.5 18.5 0 0 0 44 60.5 V99 '
  + 'M125.5 60.5 V97.5 A18.5 18.5 0 0 0 144 116 H156 '
  + 'M147.5 42 H198 M154 42 A18.5 18.5 0 0 1 172.5 60.5 V123'
/** The track between them: in to the O, from the O to the line along the top and into the L, and out past the T. */
export const MARK_LINKS =
  'M17 116 H44 M85 60.5 A18.5 18.5 0 0 1 103.5 42 H147.5 M103.5 42 H107 A18.5 18.5 0 0 1 125.5 60.5 M198 42 H210.5'

/** The ground, a rectangle with rounded corners, as path data. */
export const MARK_GROUND = (() => {
  const w = MARK_WIDTH
  const h = MARK_HEIGHT
  const r = MARK_RADIUS
  return `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w} ${r} V${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} `
    + `H${r} A${r} ${r} 0 0 1 0 ${h - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`
})()
