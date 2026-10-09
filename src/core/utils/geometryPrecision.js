// How finely the alignment is sampled into coordinates.

/** Sagitta (max deviation) constants for arc coordinate generation */
export const SAGITTA_ELEMENT = 0.05  // element.geometry.coordinates — fine precision
export const SAGITTA_TRACK   = 0.2   // track.coordinates (via renderCoords) — rendering precision

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
