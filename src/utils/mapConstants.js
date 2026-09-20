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

/**
 * Height points of the vertical alignment: an element up to HEIGHT_SPLIT_MIN
 * long carries one at each end, a longer one evenly spaced points at most
 * HEIGHT_POINT_SPACING apart in between (see heightUtils).
 */
export const HEIGHT_SPLIT_MIN     = 200   // m
export const HEIGHT_POINT_SPACING = 100   // m
// Vertical datum the heights are stated in unless the track says otherwise:
// DHHN2016 (EPSG 7837), what the BKG's DGM5 delivers.
export const DEFAULT_HEIGHT_EPSG = 7837

/** Vertical datums the heights may be stated in (EPSG codes of the height CRS). */
export const HEIGHT_DATUMS = [
  { epsg: 7837, label: 'DHHN2016' },
  { epsg: 5783, label: 'DHHN92' },
  { epsg: 5773, label: 'EGM96' },
  { epsg: 3855, label: 'EGM2008' },
]

/**
 * Whether `m` is still the map the ref holds — what an effect cleanup has to
 * ask before it touches the map it captured when it ran.
 *
 * Going back to the start page unmounts the map and the open panel in one
 * commit, and React detaches the container ref (which calls map.remove())
 * before the panels' effect cleanups run. A removed map has no style left —
 * MapLibre's remove() drops it — so every call that goes through it
 * (setFilter, getLayer, removeSource, …) throws, and a throw in a cleanup
 * takes the whole React root down with it. Once the map is gone there is also
 * nothing left to reset, so the cleanup simply stops here.
 */
export const mapIsLive = (map, m) => !!m && map?.current === m

/** Filter that matches no feature – used to "clear" a MapLibre layer filter */
export const FILTER_NONE = ['all', ['==', ['get', 'trackId'], ''], ['==', ['get', 'elementIndex'], -1]]

/** Filter that matches a specific track element */
export const filterForElement = (trackId, elementIndex) =>
  ['all', ['==', ['get', 'trackId'], trackId], ['==', ['get', 'elementIndex'], elementIndex]]

/** Filter that matches a set of elements of one track */
export const filterForElements = (trackId, elementIndexes) =>
  ['all', ['==', ['get', 'trackId'], trackId], ['in', ['get', 'elementIndex'], ['literal', elementIndexes]]]

/** Filter that matches every element of one track */
export const filterForTrack = (trackId) => ['==', ['get', 'trackId'], trackId]

/**
 * Filter that matches every element a switch owns, wherever it lies: its branch
 * and the through route carved into the track it was laid into are on two
 * tracks, so the id on the element is what picks them out, not the track.
 */
export const filterForSwitch = (switchId) => ['==', ['get', 'switchId'], switchId ?? '']

/** Pixel tolerance for click/hover hit detection */
export const HIT_TOLERANCE = 10

/** The layer the project's own tracks are drawn on — what a click asks. */
export const TRACKS_LAYER = 'tracks-layer'

/**
 * The track element under a point on the map — { trackId, elementIndex } — or
 * null where nothing of the project is drawn within HIT_TOLERANCE of it.
 *
 * `prefer` settles an overlap: where two tracks lie over each other — a
 * turnout's branch across the route it was laid into — that one is the one
 * meant, whichever order the renderer happens to return them in.
 */
export function elementUnderPoint(map, point, prefer = null) {
  if (!map?.getLayer?.(TRACKS_LAYER)) return null
  const hits = map.queryRenderedFeatures([
    [point.x - HIT_TOLERANCE, point.y - HIT_TOLERANCE],
    [point.x + HIT_TOLERANCE, point.y + HIT_TOLERANCE],
  ], { layers: [TRACKS_LAYER] })
  const hit = hits.find(f => f.properties.trackId === prefer) ?? hits[0]
  return hit
    ? { trackId: hit.properties.trackId, elementIndex: Number(hit.properties.elementIndex) }
    : null
}

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

/** Stroke of the element-end markers at icon-size 1: the widest track line (see markerImages). */
export const MARKER_STROKE = LINE_WIDTH_STOPS[LINE_WIDTH_STOPS.length - 1]
/** Marker size by zoom — scaled with the line, so a marker's stroke is always the line's width. */
export const ZOOM_ICON_SIZE = lineWidthTimes(1 / MARKER_STROKE)

/** Cant physics constants (same as Leaflet prototype) */
export const MAX_CANT      = 170   // maximum cant (mm)
export const MAX_CANT_DEF  = 150   // maximum cant deficiency (mm)
export const CANT_STEP     = 5     // cant is designed in 5 mm steps

/**
 * The cant deficiency a speed is designed against (mm) — what the element
 * table's V_max column reads, and what its button sets every speed to.
 *
 * It is not MAX_CANT_DEF: 150 mm is the most an element may be built with
 * before the dialogs refuse it, the ceiling. The layout is drawn to 130, so
 * the design keeps the margin between the two instead of spending it and
 * leaving every curve at its limit. A switch route is designed to its own,
 * lower MAX_SWITCH_CANT_DEF — the stricter of the two always governs.
 */
export const VMAX_CANT_DEF = 130

/** The deficiency this element's speed is designed against. */
export const designCantDef = (el) => (el?.switchBranch ? MAX_SWITCH_CANT_DEF : VMAX_CANT_DEF)

/** The deficiency it may be built with at all — what the dialogs refuse past. */
export const limitCantDef = (el) => (el?.switchBranch ? MAX_SWITCH_CANT_DEF : MAX_CANT_DEF)

/**
 * What a cant deficiency says about the element carrying it: `'over'` — past
 * the limit it may be built with, so it is not buildable as it stands;
 * `'design'` — inside that, but past what its speed should have been laid out
 * against, so it is on the reserve the design is meant to keep; null —
 * ordinary. A switch route knows only the one limit: its 110 mm is both.
 *
 * Only a deficiency counts. A negative value is cant in excess of what the
 * speed needs, which has its own rules and is not judged here.
 */
export const cantDefLevel = (el, cantDef) => (
  cantDef > limitCantDef(el) ? 'over'
    : cantDef > designCantDef(el) ? 'design'
      : null)
const CANT_COEFF    = 6.5   // C = k·v²/R
const CANT_DEF_COEFF = 11.8 // D = k·v²/R − C

/**
 * Cant is stored SIGNED, following the curve: positive when the left rail is
 * raised (right-hand curve, radius > 0), negative when the right rail is raised
 * (radius < 0). So sign(cant) === sign(radius) for a normally canted curve; the
 * magnitude is what the physics uses, hence the `Math.abs` on input here.
 */
export const cantSign = (radius) => (radius < 0 ? -1 : 1)

/** Snap a cant to the design step; the magnitude decides, not the sign. */
export const roundCant = (mm) => Math.sign(mm) * Math.round(Math.abs(mm) / CANT_STEP) * CANT_STEP

/** Auto-compute cant from speed (km/h) and signed radius (m); result is signed.
 *  If cant deficiency without any cant < 60 mm, no cant is needed. */
export function computeAutoC(speed, radius) {
  const R = Math.abs(radius)
  if (R <= 0) return 0
  const defWithoutCant = Math.round((CANT_DEF_COEFF * speed * speed) / R)
  if (defWithoutCant < 60) return 0
  return cantSign(radius) * Math.min(MAX_CANT, roundCant((CANT_COEFF * speed * speed) / R))
}

/**
 * What a turnout may be canted to. A switch is built on one set of sleepers and
 * its two routes run over the same rails, so it is held well below the line's
 * own 170 mm: 100 mm, and 120 only where the design states in writing why it has
 * to be. The deficiency ceiling is the same either way.
 *
 * The justification is the text itself (`cantException` on the element), not a
 * flag: an exception nobody had to write down is one that can be clicked away,
 * and then it is no exception at all. It is stated on the plan and warned about
 * in the element table, so it stays visible long after the dialog is gone.
 */
export const MAX_SWITCH_CANT           = 100  // maximum cant on a switch route (mm)
export const MAX_SWITCH_CANT_EXCEPTION = 120  // …raised to this by a written justification
export const MAX_SWITCH_CANT_DEF       = 110  // maximum cant deficiency for switches (mm)

/**
 * How far a single change in the track editor may reach before it is refused
 * (AP 5.1, Entscheidung 3). A geometry edit re-shapes everything hanging off the
 * element's end, across track and project boundaries, and that is the point of
 * it — but past a certain reach nobody can hold in their head what a typed
 * number is about to move. Both limits are exclusive and joined by OR: a change
 * that rebuilds five tracks without touching a switch is as hard to oversee as
 * one that moves two switches.
 */
export const MAX_EDIT_SWITCHES = 1
export const MAX_EDIT_TRACKS   = 3

/** The justification an element carries, trimmed — '' when it carries none. */
export const cantExceptionOf = (el) =>
  (typeof el?.cantException === 'string' ? el.cantException.trim() : '')

/** The cant a switch route may carry, given the justification offered for it. */
export const switchCantLimit = (reason) =>
  (reason?.trim() ? MAX_SWITCH_CANT_EXCEPTION : MAX_SWITCH_CANT)

/** The cant this element may carry: a switch route's limit, or the line's own. */
export const cantLimit = (el) =>
  (el?.switchBranch ? switchCantLimit(cantExceptionOf(el)) : MAX_CANT)

/**
 * The cant magnitudes an element carries. An arc has the one; a transition ramps
 * between two, and a turnout laid into one is built on that ramp — so both ends
 * are read, or a switch element on a ramp would answer for a cant it is not on.
 */
const cantsOf = (el) => (el?.elementType === 2 && (el.cantStart != null || el.cantEnd != null)
  ? [el.cantStart ?? 0, el.cantEnd ?? 0]
  : [el?.cant ?? 0])

/** The greatest cant magnitude anywhere along this element. */
export const worstCantOf = (el) => Math.max(...cantsOf(el).map(Math.abs))

/** Does this element carry more cant than it is allowed to, anywhere along it? */
export const cantExceedsLimit = (el) => worstCantOf(el) > cantLimit(el)

/**
 * The justification field an element built with this cant needs, ready to be
 * spread in. Below the plain limit there is nothing to justify, so nothing is
 * written — a stale reason must not sit on an element that no longer needs one.
 */
export const cantExceptionFields = (cant, reason) =>
  (Math.abs(cant ?? 0) > MAX_SWITCH_CANT && reason?.trim() ? { cantException: reason.trim() } : {})

/** A cant typed into a switch dialog, on the design step and under the ceiling. */
export const clampSwitchCant = (value) =>
  roundCant(Math.max(-MAX_SWITCH_CANT_EXCEPTION, Math.min(MAX_SWITCH_CANT_EXCEPTION, value)))

/**
 * What stands between this cant and being built, as a key the dialogs translate:
 * `'over'` — past even the exception, so there is no reason that would do;
 * `'unjustified'` — past the plain limit with nothing written down; null — fine.
 */
export function switchCantError(cant, reason) {
  const magnitude = Math.abs(cant ?? 0)
  if (magnitude > MAX_SWITCH_CANT_EXCEPTION) return 'over'
  if (magnitude > switchCantLimit(reason)) return 'unjustified'
  return null
}

/**
 * Auto-compute cant for a switch (signed): 0 unless the deficiency would exceed
 * 110, then just enough to bring it back to that — capped at the plain 100 mm,
 * since a value nobody typed carries no justification. Where the cap is not
 * enough the deficiency stays over its limit and the dialog refuses the design,
 * rather than the turnout being over-canted on no one's authority.
 */
export function computeSwitchCant(speed, radius) {
  const R = Math.abs(radius)
  if (R <= 0) return 0
  const defAt0 = Math.round((CANT_DEF_COEFF * speed * speed) / R)
  if (defAt0 <= MAX_SWITCH_CANT_DEF) return 0
  const needed = roundCant((CANT_DEF_COEFF * speed * speed) / R - MAX_SWITCH_CANT_DEF)
  return cantSign(radius) * Math.min(MAX_SWITCH_CANT, Math.max(0, needed))
}

/** Compute cant deficiency from speed (km/h), radius (m), and signed cant (mm). */
export function computeCantDef(speed, radius, cant) {
  const R = Math.abs(radius)
  if (R <= 0) return 0
  return Math.round(((CANT_DEF_COEFF * speed * speed) / R) - Math.abs(cant))
}

/**
 * Cant deficiency of a route whose cant may be applied the wrong way round. A
 * bent switch has one cant on one set of sleepers but two routes: where they
 * bend apart (the outer-bent switch) the cant that serves the stem works
 * against the branch. So the sign is read rather than dropped — `cant` shares
 * the sign of `radius` on a normally canted curve and adds to the deficiency
 * when it does not. Same value as computeCantDef whenever the signs agree.
 */
export function computeCantDefSigned(speed, radius, cant) {
  const R = Math.abs(radius)
  if (R <= 0) return 0
  return Math.round(((CANT_DEF_COEFF * speed * speed) / R) - (cant ?? 0) * Math.sign(radius))
}

/**
 * Highest speed (km/h) radius (m) and signed cant (mm) allow — the inverse of
 * computeCantDef, solved for the speed at which the deficiency reaches `limit`.
 * Returns null for a straight: without curvature the geometry imposes no limit.
 */
export function computeMaxSpeed(radius, cant, limit = MAX_CANT_DEF) {
  const R = Math.abs(radius)
  if (!(R > 0)) return null
  // Cant that follows the curve buys speed; cant applied against it — a bent
  // switch's second route runs on the cant the first one was banked for —
  // spends it, and can leave no admissible speed at all.
  const room = (cant ?? 0) * Math.sign(radius) + limit
  if (room <= 0) return 0
  let v = Math.floor(Math.sqrt((R * room) / CANT_DEF_COEFF))
  // computeCantDefSigned rounds, so the exact root can fall one km/h short of
  // what that rounded check still admits — step up to stay in step with it.
  while (computeCantDefSigned(v + 1, radius, cant) <= limit) v++
  return v
}
