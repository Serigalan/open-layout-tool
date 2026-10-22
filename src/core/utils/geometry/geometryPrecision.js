// How finely the alignment is sampled into coordinates.

/** Sagitta (max deviation) constants for arc coordinate generation */
export const SAGITTA_ELEMENT = 0.05  // element.geometry.coordinates — fine precision
export const SAGITTA_TRACK   = 0.2   // track.coordinates (via renderCoords) — rendering precision

/**
 * Sagitta [m] of the polyline an arc or transition is drawn with on the map
 * (see displayCoords). The map can be zoomed to 22, where a pixel is ~2.4 cm at
 * 50° N: the 5 cm of SAGITTA_ELEMENT are two pixels there, and a turnout's
 * 500 m branch is one kink in the middle. 5 mm stays under a quarter pixel.
 * The GeoJSON source thins the line again for every lower zoom (Douglas–Peucker
 * per tile), so only the tiles of a close view draw the extra vertices.
 */
export const SAGITTA_DISPLAY = 0.005

/**
 * Step [m] a switch route's polyline is drawn with. A turnout is only tens of
 * metres long and is always looked at from close up, so its routes are stepped
 * at a fixed distance rather than by a sagitta: at a 500 m radius 5 cm give a
 * 42 m branch two segments, and the body then reads as a kink instead of a
 * curve. The switch body and the track's element of the same route are both
 * stepped by it (switchRouteSegments, displayCoords), so they share vertices.
 */
export const SWITCH_ROUTE_STEP = 2

/**
 * Max spacing [m] of the intermediate vertices a straight gets for display
 * (see displayCoords). A straight is stored as its two end points, and the Web
 * Mercator map draws that chord as a straight line — which the true straight is
 * not: at 50° N an east–west 1 km straight bends 23 mm away from its chord,
 * growing with the square of the length. 100 m keeps it under 0.3 mm.
 */
export const STRAIGHT_VERTEX_SPACING = 100

/**
 * Tiling zoom of the map's GeoJSON sources. MapLibre quantises vertices to the
 * tile grid of this zoom (4096 units per tile): the default 18 is a ~2.4 cm
 * grid at 50° N, 22 is ~1.5 mm.
 */
export const GEOJSON_MAXZOOM = 22
