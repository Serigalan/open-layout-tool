import { PALETTE } from '../styles/palette'

// The colours of the map's highlights against the project's own (R10.10).
// The tracks are drawn in the project colour a user picks; a hover, a
// selection or a preview in a colour close to it would vanish on them. Each
// role has its colour and two to fall back on, and takes the first that
// stands far enough from the project colour.

/** The highlight colours by role, the first the one the app is designed with. */
const CANDIDATES = {
  hover:    [PALETTE.mapHover, '#00acc1', '#e91e63'],
  selected: [PALETTE.mapSelected, '#d500f9', '#00897b'],
  flash:    [PALETTE.mapFlash, '#ff6f00', '#8e24aa'],
}

/** Below this colour distance (CIE76 ΔE) two colours read as one on a thin line. */
const MIN_DELTA_E = 32

const channel = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
function lab(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6).padEnd(6, '0'), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(channel)
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722)
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const f = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/** How far apart two colours look (CIE76 ΔE). */
export function deltaE(a, b) {
  const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** The highlight colours for tracks drawn in `projectColor`: { hover, selected, flash }. */
export function highlightColors(projectColor = PALETTE.primaryDefault) {
  const pick = (list) => list.find(c => deltaE(c, projectColor) >= MIN_DELTA_E)
    ?? list.reduce((best, c) => (deltaE(c, projectColor) > deltaE(best, projectColor) ? c : best))
  return Object.fromEntries(Object.entries(CANDIDATES).map(([role, list]) => [role, pick(list)]))
}

/** A paint value with the designed highlight colours put to the ones `colors` chose. */
export function resolveHighlight(value, colors) {
  if (typeof value === 'string') {
    if (value === PALETTE.mapHover) return colors.hover
    if (value === PALETTE.mapSelected) return colors.selected
    if (value === PALETTE.mapFlash) return colors.flash
    return value
  }
  return Array.isArray(value) ? value.map(v => resolveHighlight(v, colors)) : value
}
