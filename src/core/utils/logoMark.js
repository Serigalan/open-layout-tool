/**
 * The Open Layout Tool mark, in a 64 × 64 box: a line running across the top
 * of a rounded square, and three branches leaving it, each by a switch taken
 * facing from the left, that write O, L and T. The tracks are drawn as a pair
 * of rails — a wide white stroke with a thin one in the square's colour on
 * it — and each switch is marked by a yellow point. public/favicon.svg is
 * the mark drawn small: plain white tracks, no inner rail, no points.
 */

export const MARK_SIZE = 64
const MARK_RADIUS = 14
export const MARK_YELLOW = '#F2B33D'

/** The line along the top; it runs from edge to edge, so its ends are cut square. */
export const MARK_LINE = 'M0 17 H64'
/** The branches: an O open at its top left, an L and a T, ending on one baseline. */
export const MARK_BRANCHES =
  'M14 17 A8 8 0 0 1 22 25 V39 A8 8 0 0 1 14 47 A8 8 0 0 1 6 39 V29 '
  + 'M29 17 A6 6 0 0 1 35 23 V41 A6 6 0 0 0 41 47 '
  + 'M48 17 A6 6 0 0 1 54 23 V47'
/** Where the branches end free — rounded off where the drawing has no round caps. */
export const MARK_ENDS = [[6, 29], [41, 47], [54, 47]]
/** The switches: where each branch leaves the line. */
export const MARK_SWITCHES = [[14, 17], [29, 17], [48, 17]]

/** Stroke width of the white rails, of the inner rail, and the switch points' radius. */
export const MARK_RAIL = 6
export const MARK_INNER = 1.8
export const MARK_POINT = 2.4

/** The rounded square as path data. */
export const MARK_SQUARE = (() => {
  const s = MARK_SIZE
  const r = MARK_RADIUS
  return `M${r} 0 H${s - r} A${r} ${r} 0 0 1 ${s} ${r} V${s - r} A${r} ${r} 0 0 1 ${s - r} ${s} `
    + `H${r} A${r} ${r} 0 0 1 0 ${s - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`
})()

/** A filled circle as path data, for backends that only know paths. */
export const circlePath = ([cx, cy], r) =>
  `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
