import {
  MAX_SWITCH_CANT as RW_MAX_SWITCH_CANT,
  MAX_SWITCH_CANT_DEF as RW_MAX_SWITCH_CANT_DEF,
  CANT_DEFICIENCY_COEFF as RW_CANT_DEFICIENCY_COEFF,
} from './regelwerkDefaults'
import { catalogLimit, catalogSpeedRange, IN_SWITCH_AREA } from './regelkatalog'

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
/**
 * From this zoom on the element-end markers are drawn, below it not at all.
 * Zoomed out further they say nothing: the ticks and arrows of a whole
 * station run into one another and cover the alignment they mark — an
 * imported Strecke brings thousands of them.
 */
export const MARKER_MIN_ZOOM = 16

/**
 * The cant a curve may carry (mm) — LP.KB.01, read out of DB Ril 800.0110
 * rather than restated here (see regelkatalog.js `catalogLimit`). It used to
 * be 170 and is now the Ril's 160: since AP R.8 the dialogs create to the
 * rulebook, not merely beside it.
 */
export const MAX_CANT = catalogLimit('LP.KB.01', 'max', { 'element.cant': 0 })

export const CANT_STEP = 5     // cant is designed in 5 mm steps — LP.KB.03

/**
 * The cant deficiency a line element may reach at `speed` (mm) — LP.KB.02.
 * It is a **step**, not one number: 130 mm up to 150 km/h, 150 above it. The
 * app used to read those two as "what a design aims at" and "what a dialog
 * still accepts"; they are nothing of the kind, and since AP R.8 there is one
 * limit per speed and no reserve between them.
 */
export const cantDefLimit = (speed) =>
  catalogLimit('LP.KB.02', 'max', { 'element.design_speed': speed ?? 0, 'physics.u_f': 0 })

/**
 * Where that step stands, found by asking rather than by reading 150 out of
 * the rule's text: [{ from, limit }, …], one entry per stretch of speed the
 * Ril gives its own limit. A Ril that later has three steps needs no change
 * here.
 */
const CANT_DEF_STEPS = (() => {
  const steps = []
  for (let v = catalogSpeedRange.min; v <= catalogSpeedRange.max; v++) {
    const limit = cantDefLimit(v)
    if (!steps.length || steps[steps.length - 1].limit !== limit) steps.push({ from: v, limit })
  }
  return steps
})()

/** The deficiency this element may be built with — what the dialogs refuse past. */
export const limitCantDef = (el) =>
  (el?.switchBranch ? MAX_SWITCH_CANT_DEF : cantDefLimit(el?.speed))

/**
 * What a cant deficiency says about the element carrying it: `'over'` — past
 * the limit it may be built with, so it is not buildable as it stands; null —
 * ordinary.
 *
 * Only a deficiency counts. A negative value is cant in excess of what the
 * speed needs, which has its own rules and is not judged here.
 */
export const cantDefLevel = (el, cantDef) => (cantDef > limitCantDef(el) ? 'over' : null)

const CANT_COEFF    = 6.5   // C = k·v²/R — LP.KB.04's Regelüberhöhung
const CANT_DEF_COEFF = RW_CANT_DEFICIENCY_COEFF // D = k·v²/R − C

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
 * The cant at which the deficiency is nil — the **ausgleichende Überhöhung**
 * u_0 of physics.json (D_EQ in EN 13803): u_0 = k · v² / R, on the design step
 * and signed like the curve.
 *
 * It is not what `computeAutoC` proposes. That one is drawn to 6.5 · v²/R,
 * roughly half of this, because a line is laid out for a speed its slower
 * traffic does not run — cant that exactly balances one speed leaves every
 * slower train leaning into the curve. u_0 is what a designer reaches for when
 * this curve really is to be run at this one speed, so it is offered rather
 * than proposed.
 */
export function equilibriumCant(speed, radius) {
  const R = Math.abs(radius)
  if (!(R > 0)) return 0
  return cantSign(radius) * roundCant((CANT_DEF_COEFF * speed * speed) / R)
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
export const MAX_SWITCH_CANT           = RW_MAX_SWITCH_CANT      // LP.KB.05 reg
// …raised to this by a written justification — LP.KB.05's Ermessensgrenze,
// which is exactly what a written justification is for.
export const MAX_SWITCH_CANT_EXCEPTION = catalogLimit('LP.KB.05', 'discretion', { 'element.cant': 0 }, IN_SWITCH_AREA)
export const MAX_SWITCH_CANT_DEF       = RW_MAX_SWITCH_CANT_DEF  // LP.KB.06

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

/**
 * What a cant typed into a field becomes when the field is left: rounded onto
 * the design step and held inside the limits — or null where there is nothing
 * to take from it. An empty field and a half-typed "-" are not values, and
 * must leave what stood there rather than become a zero nobody asked for.
 *
 * Kept apart from the typing on purpose: a field that rounds every keystroke
 * cannot reach a value whose leading digits are not themselves on the step —
 * typing 65 went 6 → 5, and the 5 that was left is what the next keystroke
 * built on.
 */
export function cantFromInput(draft, min, max) {
  const typed = Number(draft)
  if (String(draft).trim() === '' || !Number.isFinite(typed)) return null
  return roundCant(Math.max(min, Math.min(max, typed)))
}

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

/**
 * Highest speed this element's geometry allows under the deficiency limit that
 * really holds there — the switch route's own, or the Ril's step.
 *
 * The step is why this is not one call to computeMaxSpeed: the limit rises
 * above 150 km/h, so a curve can be *too slow* for the higher limit and yet
 * fast enough once it is past the step. Each stretch of speed is therefore
 * solved with its own limit and clipped to its own stretch, and the fastest
 * answer that lands inside the stretch it was computed for wins.
 */
export function maxSpeedFor(el, radius, cant) {
  if (!(Math.abs(radius) > 0)) return null
  // Never past the fastest speed the Ril speaks about (LP.ALL.01): a column
  // that proposed 324 km/h would be proposing something the rulebook has no
  // limits for, and the button beside it would write it into every element.
  const ceiling = catalogSpeedRange.max
  if (el?.switchBranch) {
    return Math.min(computeMaxSpeed(radius, cant, MAX_SWITCH_CANT_DEF), ceiling)
  }
  let best = 0
  CANT_DEF_STEPS.forEach((step, i) => {
    const until = CANT_DEF_STEPS[i + 1] ? CANT_DEF_STEPS[i + 1].from - 1 : ceiling
    const reached = Math.min(computeMaxSpeed(radius, cant, step.limit), until)
    if (reached >= step.from) best = Math.max(best, reached)
  })
  return best
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
export function computeMaxSpeed(radius, cant, limit) {
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
