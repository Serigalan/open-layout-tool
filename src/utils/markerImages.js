import { MARKER_STROKE, lineWidthAt } from './mapConstants'

/**
 * The markers at element ends — a tick at the start, an arrow at the end, a dot
 * where a switch route ends — as signed distance fields.
 *
 * A plain icon is a picture with a fixed number of pixels: drawn larger it turns
 * blocky, drawn smaller or rotated it smears. An SDF icon holds for every pixel
 * how far it lies from the outline of the shape instead, and the edge is cut
 * out of that on the GPU at whatever size and angle the icon is drawn — so a
 * marker stays a clean, thin stroke at every zoom. It takes its colour from the
 * layer's `icon-color`, too, so recolouring is a paint property, not new images.
 *
 * The fields are computed exactly from the shapes (segments with round ends, a
 * disc) rather than traced from a raster, in the encoding MapLibre reads SDF
 * icons in: the outline at alpha 0.75, and alpha falling by 1 over 8 px of
 * distance. Those are CSS pixels, not image pixels — the shader sizes its
 * anti-aliasing by the icon's size alone and knows nothing of `pixelRatio`, so
 * only a ramp that is 8 px wide as drawn gives an edge about one device pixel
 * soft.
 *
 * Drawn at icon-size 1 the stroke is MARKER_STROKE, the track line's own width;
 * ZOOM_ICON_SIZE scales the markers with the line, so the two always match. An
 * SDF icon cannot grow without its stroke growing along, so where tick and arrow
 * are to get larger when zoomed in (MARKER_STEPS) they are swapped for larger
 * images instead, each drawn with the same stroke.
 */

/** Image pixels per CSS pixel. Detail enough for the stroke's round ends; the edge itself needs none. */
const PIXEL_RATIO = 4
/** Distance (CSS px) over which alpha falls by 1, and where the outline sits on that ramp. */
const SDF_PX = 8
const CUTOFF = 0.25
/** How far past the outline the field still has something to say, in CSS px. */
const RAMP_OUTSIDE = SDF_PX * (1 - CUTOFF)

/** Arrow arm length below the first step, CSS px at icon-size 1. */
const BASE_ARM = 10
/** Half the start tick's length per arm length of the arrow — the two grow together. */
const TICK_PER_ARM = 0.8
const DOT_RADIUS = 3.2

/**
 * From `zoom` on, the arrow's arm is `size` px long as drawn, and the start
 * tick in proportion. Below z17 icon-size is still under 1 (the stroke follows
 * the thinner line there), so that image is made larger by the same factor: the
 * size holds exactly at the step and grows with the line up to the next.
 */
const MARKER_STEPS = [
  { zoom: 15, size: 14 },
  { zoom: 17, size: 18 },
  { zoom: 19, size: 22 },
  { zoom: 21, size: 25 },
]
/** Arm length per level, CSS px at icon-size 1: level 0 below the first step, level i from step i on. */
const ARMS = [BASE_ARM, ...MARKER_STEPS.map(({ zoom, size }) => (size * MARKER_STROKE) / lineWidthAt(zoom))]

const startImage = (level) => `track-marker-start-${level}`
const endImage = (level) => `track-marker-end-${level}`
const DOT_IMAGE = 'track-marker-switch-end'

/** `icon-image` by zoom: `imageAt(level)` for level 0 below the first step, level i from step i on. */
const byMarkerStep = (imageAt) =>
  ['step', ['zoom'], imageAt(0), ...MARKER_STEPS.flatMap(({ zoom }, i) => [zoom, imageAt(i + 1)])]

/** `icon-image` of an arrow on its own. */
export const ARROW_ICON_IMAGE = byMarkerStep(endImage)

/**
 * `icon-image` of the track markers, by `markerType`. The zoom step has to be
 * the outermost expression — MapLibre allows zoom nowhere else — so the choice
 * by type sits inside each step.
 */
export const TRACK_MARKER_ICON_IMAGE = byMarkerStep((level) => ['match', ['get', 'markerType'],
  'end', endImage(level), 'switch-end', DOT_IMAGE, startImage(level)])

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Signed distance to strokes of MARKER_STROKE along `segments` ([ax, ay, bx, by]), negative inside. */
const strokes = (segments) => (x, y) => {
  let nearest = Infinity
  for (const [ax, ay, bx, by] of segments) nearest = Math.min(nearest, distanceToSegment(x, y, ax, ay, bx, by))
  return nearest - MARKER_STROKE / 2
}

// Shapes around their point at (0, 0), in CSS px, with how far they reach from
// it. Image y runs downwards, so "up" — the direction of travel, which
// icon-rotate turns onto the bearing — is negative y; the arrow's tip is the point.
const arrow = (arm) => {
  const a = arm * Math.SQRT1_2
  return { reach: arm, distance: strokes([[-a, a, 0, 0], [0, 0, a, a]]) }
}
const tick = (half) => ({ reach: half, distance: strokes([[-half, 0, half, 0]]) })

const SHAPES = {
  [DOT_IMAGE]: { reach: DOT_RADIUS, distance: (x, y) => Math.hypot(x, y) - DOT_RADIUS },
  ...Object.fromEntries(ARMS.flatMap((arm, level) => [
    [startImage(level), tick(arm * TICK_PER_ARM)],
    [endImage(level), arrow(arm)],
  ])),
}

/** The SDF image of one shape, as the `{ width, height, data }` addImage takes. */
export function sdfImage({ reach, distance }) {
  // Square, centred on the point, with room for the stroke and the ramp around it.
  const box = 2 * Math.ceil(reach + MARKER_STROKE / 2 + RAMP_OUTSIDE)
  const size = box * PIXEL_RATIO
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = distance((x + 0.5) / PIXEL_RATIO - box / 2, (y + 0.5) / PIXEL_RATIO - box / 2)
      data[(y * size + x) * 4 + 3] = 255 * (1 - CUTOFF - d / SDF_PX)   // the array rounds and clamps
    }
  }
  return { width: size, height: size, data }
}

let images = null

/** Add the marker images to `map` where it does not have them yet (a new style drops them). */
export function ensureMarkerImages(map) {
  images ??= Object.fromEntries(Object.entries(SHAPES).map(([id, shape]) => [id, sdfImage(shape)]))
  for (const [id, image] of Object.entries(images)) {
    if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: PIXEL_RATIO, sdf: true })
  }
}
