// The map's pens: line widths and markers by zoom.

/**
 * Line width by zoom, [zoom, px, …]. The project's tracks are drawn with the
 * same pen as the kilometrage lines — kmLineLayer uses it too — thin while
 * zoomed out and 2.4 px from z17 on; z11 → z12 is where the overlay hands over
 * from whole chains to its 100 m pieces.
 */
const LINE_WIDTH_STOPS = [5, 0.6, 11, 1.4, 12, 1.4, 17, 2.4]
const lineWidthTimes = (factor) =>
  ['interpolate', ['linear'], ['zoom'], ...LINE_WIDTH_STOPS.map((v, i) => (i % 2 ? v * factor : v))]

/** The line width (px) at `zoom`, as ZOOM_LINE_WIDTH draws it. */
export function lineWidthAt(zoom) {
  const s = LINE_WIDTH_STOPS
  if (zoom <= s[0]) return s[1]
  for (let i = 2; i < s.length; i += 2) {
    if (zoom <= s[i]) return s[i - 1] + ((zoom - s[i - 2]) / (s[i] - s[i - 2])) * (s[i + 1] - s[i - 1])
  }
  return s[s.length - 1]
}

export const ZOOM_LINE_WIDTH          = lineWidthTimes(1)
export const ZOOM_LINE_WIDTH_HOVER    = lineWidthTimes(2)
export const ZOOM_LINE_WIDTH_SELECTED = lineWidthTimes(1.5)
/** A buffer stop's body and face — the track pen, drawn heavier so the stop reads at a glance. */
export const ZOOM_LINE_WIDTH_BUFFER_STOP = lineWidthTimes(2.5)

/** Stroke of the element-end markers at icon-size 1: the widest track line (see markerImages). */
export const MARKER_STROKE = LINE_WIDTH_STOPS[LINE_WIDTH_STOPS.length - 1]
/** Marker size by zoom — scaled with the line, so a marker's stroke is always the line's width. */
export const ZOOM_ICON_SIZE = lineWidthTimes(1 / MARKER_STROKE)
/**
 * From this zoom on the element-end markers are drawn, below it not at all.
 * Zoomed out further they say nothing: the ticks and arrows of a whole
 * station run into one another and cover the alignment they mark — an
 * imported Strecke brings thousands of them.
 */
export const MARKER_MIN_ZOOM = 16
