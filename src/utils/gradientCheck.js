/**
 * The rule catalogue applied to a track's vertical alignment — the Höhenplan
 * half of DB Ril 800.0110 (HP.*), as trassierungCheck.js is the Lageplan half.
 *
 * The catalogue speaks about two kinds of object here, and so does this:
 *
 * - the **stretch** between two height points (scope `gradient`): its
 *   gradient, measured on the tangent polygon the points span — the rounded
 *   gradient only departs from it inside a vertical curve, and there it is the
 *   curve that is judged;
 * - the **gradient change** at an inner height point (scope `vertical_curve`):
 *   whether it is rounded at all, and the length and radius of the curve.
 *
 * What a rule needs that is not in the heights comes from the track: whether
 * it is a line or a station track, a main track or a siding, the line
 * category it runs on (its own or the project's), and from the elements under
 * a curve their design speed and whether it lies in a switch, a track
 * connection or a cant ramp.
 */

import { evaluateRules, rulesForScope, severityRank, worstSeverity } from './regelkatalog'
import { tangentLength, trackLength } from './heightUtils'
import { trackKind } from './trackGroups'
import { portsOf } from './switchModel'
import { transitionCantEnds } from './clothoidUtils'
import { LINE_CATEGORIES } from './identifierUtils'
import { switchBodySpans } from './switchGradient'

const DEFAULT_LINE_CATEGORY = 'main'

// The catalogue's context for each category.
const CONTEXT_OF_CATEGORY = { main: 'main_line', secondary: 'secondary_line', s_bahn: 's_bahn' }

const known = (category) => (LINE_CATEGORIES.includes(category) ? category : null)

/** The line category a track is judged by: its own, else the project's, else a main line. */
export const lineCategoryOf = (track, project) =>
  known(track?.lineCategory) ?? known(project?.lineCategory) ?? DEFAULT_LINE_CATEGORY

/** The project's own line category, which a track without one of its own takes. */
export const projectLineCategory = (project) => known(project?.lineCategory) ?? DEFAULT_LINE_CATEGORY

/** Main track or siding — every track is a main track unless it says otherwise. */
const trackUseOf = (track) => (track?.trackUse === 'siding' ? 'siding' : 'main')

// A gradient and a gradient change are judged to 0.01 ‰, a curve length to the
// centimetre (the catalogue's derived_inputs say so): what is left beyond that
// is floating point, and a stretch drawn at exactly 12.5 ‰ must not warn.
const round2 = (x) => Math.round(x * 100) / 100

const STATION_EPS = 1e-6

/** The signed gradient [‰] of every stretch: from point i−1 to point i, by i. */
function stretchGrades(heights) {
  const grades = []
  for (let i = 1; i < heights.length; i++) {
    const a = heights[i - 1], b = heights[i]
    const run = b.station - a.station
    grades[i] = run > 0 ? 1000 * (b.z - a.z) / run : null
  }
  return grades
}

/**
 * Where each element begins and ends along the track, with its design speed
 * and whether it is a cant ramp — a transition
 * the cant changes over (the app ramps the cant on the transition and nowhere
 * else, see trassierungCheck's rampScope).
 */
function elementSpans(elements) {
  let start = 0
  return (elements ?? []).map((el, i) => {
    const ends = el.elementType === 2 ? transitionCantEnds(elements, i) : null
    const span = {
      from: start,
      to: start + (el.length ?? 0),
      speed: el.speed ?? 0,
      ramp: !!ends && Math.abs((ends.end ?? 0) - (ends.start ?? 0)) > 0,
    }
    start = span.to
    return span
  })
}

/**
 * The elements a curve from `from` to `to` lies on, by the catalogue's rule
 * for areas: a curve of some length lies in what it overlaps on a length
 * > 0, a gradient change without one (a point) in what it touches — an
 * element boundary included.
 */
const overlapping = (spans, from, to) => (to - from > STATION_EPS
  ? spans.filter(s => s.to > from + STATION_EPS && s.from < to - STATION_EPS)
  : spans.filter(s => s.to >= from - STATION_EPS && s.from <= to + STATION_EPS))

// The longest track between two switches that still makes them one connection.
const MAX_CONNECTION_LENGTH = 20

/**
 * Is the track a track connection of its own — running into a switch at both
 * its ends, and no longer than 20 m between them? A longer track between two
 * switches is a track like any other.
 */
function isConnectionTrack(track, switches) {
  const at = (end) => (switches ?? []).some(sw =>
    portsOf(sw).some(p => sw[p.trackKey] === track.id && sw[p.endKey] === end))
  return at('BEGIN') && at('END') && trackLength(track) <= MAX_CONNECTION_LENGTH + STATION_EPS
}

/** A rule that needs the design speed — not to be applied where it is unknown. */
const readsSpeed = (rule) => Object.values(rule.inputs ?? {}).some(input => input.from === 'point.design_speed')

/**
 * Every Höhenplan rule of the catalogue applied to one track.
 *
 * `project` gives the line category a track without one of its own runs on,
 * `switches` say which tracks are connections between two of them and where
 * a turnout's body lies (WA to ldS, switchGradient), for which `tracks` are
 * needed too — the project's unless stated. `formOf` looks a switch form up
 * (the catalogue's, unless a test states one).
 *
 * Returns `stretches` [{ index, from, to, grade, results, severity }] with
 * `index` the point the stretch ends at and `grade` signed in ‰, `curves`
 * [{ index, station, gradeChange, length, radius, crest, speed, unchecked,
 * results, severity }] for every inner point, and the worst severity of all.
 * A curve whose design speed is unknown is `unchecked` for the rules that
 * need one — the same as an element in the element table — and judged by
 * the rest.
 */
export function checkVertical(track, { project = null, switches = [], tracks = project?.tracks ?? [], formOf } = {}) {
  const heights = track?.heights ?? []
  const category = lineCategoryOf(track, project)
  const kind = trackKind(track) === 'station' ? 'station_track' : 'open_line'
  const trackContexts = new Set([kind, CONTEXT_OF_CATEGORY[category], trackUseOf(track) === 'siding' ? 'siding' : 'main_track'])
  const grades = stretchGrades(heights)

  const stretches = []
  const gradientRules = rulesForScope('gradient')
  for (let i = 1; i < heights.length; i++) {
    if (grades[i] == null) continue
    const scope = {
      'physics.gradient': round2(Math.abs(grades[i])),
      // No tunnel can be stated yet (OP.12): HP.LN.03 stays silent.
      'model.tunnel_length': null,
    }
    stretches.push({
      index: i,
      from: heights[i - 1].station,
      to: heights[i].station,
      grade: grades[i],
      ...evaluateRules(gradientRules, scope, { inContext: (id) => trackContexts.has(id) }),
    })
  }

  const spans = elementSpans(track?.elements)
  const connection = isConnectionTrack(track ?? {}, switches)
  const bodies = track ? switchBodySpans(tracks, switches, track, { formOf }) : []
  const curveRules = rulesForScope('vertical_curve')
  const tangent = (i) => tangentLength(heights, i) ?? 0
  const curves = []
  for (let i = 1; i < heights.length - 1; i++) {
    const before = grades[i], after = grades[i + 1]
    if (before == null || after == null) continue
    const p = heights[i]
    const radius = p.rv > 0 ? p.rv : 0
    const t = tangent(i)
    // The curve has to lie between its neighbours, and leave room for theirs.
    const fits = t + tangent(i - 1) <= p.station - heights[i - 1].station + STATION_EPS
      && t + tangent(i + 1) <= heights[i + 1].station - p.station + STATION_EPS
    const under = overlapping(spans, p.station - t, p.station + t)
    // The fastest element under the curve decides; an unknown speed (0) is no speed.
    const speed = Math.max(0, ...under.map(s => s.speed))
    // Between WA and ldS: the point strictly inside, or its curve over a length.
    const inBody = bodies.some(b => (t > STATION_EPS
      ? Math.min(b.to, p.station + t) - Math.max(b.from, p.station - t) > STATION_EPS
      : p.station > b.from + STATION_EPS && p.station < b.to - STATION_EPS))
    const areas = new Set([
      ...(inBody ? ['switch_body'] : []),
      // A connection is a track of its own between two switches; a turnout
      // in a main track does not make that track one.
      ...(connection ? ['track_connection'] : []),
      ...(under.some(s => s.ramp) ? ['cant_ramp'] : []),
    ])
    const scope = {
      'physics.gradient_change': round2(Math.abs(after - before)),
      'physics.vertical_curve_length': round2(radius * Math.abs(after - before) / 1000),
      'point.vertical_radius': radius,
      'point.design_speed': speed,
      'model.crest': after < before,
      'model.vertical_curve_fits': fits,
    }
    const rules = speed > 0 ? curveRules : curveRules.filter(rule => !readsSpeed(rule))
    curves.push({
      index: i,
      station: p.station,
      gradeChange: after - before,
      length: scope['physics.vertical_curve_length'],
      radius,
      crest: after < before,
      speed,
      unchecked: !(speed > 0),
      ...evaluateRules(rules, scope, {
        inContext: (id) => trackContexts.has(id) || areas.has(id),
      }),
    })
  }

  return {
    lineCategory: category,
    stretches,
    curves,
    severity: worstSeverity([...stretches, ...curves].map(entry => entry.severity)),
  }
}

/**
 * The findings of a check gathered per rule and step, with the number of
 * places each was found and the first of them — what a list shows, so a
 * terrain gradient with sixty unrounded changes says so once. A rule that
 * answers with two steps (HP.AR.01: a missing curve, a curve too many) is
 * listed once for each; the worst come first.
 */
export function verticalFindings(check) {
  const found = new Map()
  for (const entry of [...(check?.stretches ?? []), ...(check?.curves ?? [])]) {
    for (const result of entry.results) {
      if (result.severity === 'ok') continue
      const key = `${result.id}|${result.severity}`
      const seen = found.get(key)
      found.set(key, {
        id: result.id,
        severity: result.severity,
        places: (seen?.places ?? 0) + 1,
        first: seen?.first ?? entry,
      })
    }
  }
  return [...found.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
}
