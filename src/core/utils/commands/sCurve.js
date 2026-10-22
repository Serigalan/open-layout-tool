import {
  generateId, switchDesignation, nextSwitchNumber, nextTrackName, rebuildCoords, trackLabel,
  newSwitchFields, switchElementMark, splitElementAt, splitTrackAtJoint, carveSwitchRoute,
} from '../track'
import { cantEnds, nodeUtm, wgs84ToUTM, utmToWgs84, transformGridBearing } from '../geometry'
import {
  switchElementRoute, switchRouteVaries, computeSwitchGeometryUtm, solveSwitchConnection,
  buildConnectionElements, orientStemToward, uniqueStations, turnoutRunsOn,
} from '../switch'
import { minElementLength, runBeside } from '../rules'

// The S-curve between two line tracks (SCurveForm): solving the connection
// for a shift, the range of shifts it stands over, and the commit.

// ── Commit helpers (split lines + build junction switches) ──────────────────

// Build a switch record at a junction. The symbol is derived from
// computeSwitchGeometry (same as connect switch), on the side the construction
// laid the form to — not read off where the branch ends: an outer-bent turnout
// whose stem radius is the form's own has a straight branch, which ends on the
// tangent and so on neither side of it.
//
// That turnout is built as what it is, the plain form with its routes swapped
// (switchModel.turnoutLinePort): the running track is its branch, the
// connection its through route. `branchStraight` says the construction's
// branch came out straight all along — the symbol, laid on the stem radius at
// the toe alone, cannot tell a straight branch from one that bends on later.
//
// What comes back says which route each track carries and where the one in
// the running track ends, where that track has to be parted so the route is
// its own element. `behind`, `ahead` and `conn` are the ports as
// { trackId, endpoint }: the running track behind and ahead of the toe, and
// the connection's end.
function buildJunctionSwitch({ jWgs, jNode, zone, tangentBearing, side, sw, speed, switchNumber,
                               identity, stemR = null, branchStraight = false, behind, ahead, conn }) {
  const jUtm = { easting: jNode[0], northing: jNode[1], zone }
  // `stemR` bends the turnout into the track it is laid in: both of its routes
  // take that curvature on top of their own, so in a curve the symbol follows
  // the track instead of standing beside it.
  const geom = computeSwitchGeometryUtm(jUtm, tangentBearing, sw, side, false, jWgs, stemR)
  const swapped = branchStraight ? geom.swapped : null
  const shown = swapped ?? geom
  const [b1, b2] = swapped ? [ahead, conn] : [conn, ahead]
  return {
    lineRoute:  swapped ? 'branch' : 'main',
    connRoute:  swapped ? 'main' : 'branch',
    lineEnd:    swapped ? swapped.curvedUtm : geom.straightUtm,
    lineLength: swapped ? swapped.arcLen : geom.straightLen,
    record: {
      ...identity,
      number: switchNumber, trailing: false, speed,
      // The stem radius at the toe, so a reload can rebuild a bent symbol even
      // where the marked elements cannot be read back.
      ...(swapped ? { swapped: true } : geom.stemAtToe ? { mainRadius: geom.stemAtToe } : {}),
      ports: {
        A: { trackId: behind.trackId, endpoint: behind.endpoint },
        B1: { trackId: b1.trackId, endpoint: b1.endpoint },
        B2: { trackId: b2.trackId, endpoint: b2.endpoint },
      },
      fillCoords: shown.fillCoords, lcsCoords: shown.lcsCoords,
      labelCoords: shown.labelCoords, bauform: shown.bauform,
    },
  }
}

/**
 * How far beyond the element picked the stem reaches [m] — past the through
 * length of every form: a turnout whose toe stands on the element may run on
 * over that much of the track.
 */
const STEM_REACH = 200

/**
 * A pick as the dialog takes one: element `elIdx` of `track`, clicked
 * `along` metres from its start — where it lies, the route the turnout is laid
 * on, the cant that runs over it, its design speed (for LP.EL.01) and which of
 * its nodes are the track's open ends.
 *
 * The toe stands on that element; the turnout may run on over its nodes into
 * the elements beyond (Entscheidung 366), as far as a turnout may lie on them
 * (turnoutRunsOn) and STEM_REACH reaches. `pieces` are all of them, the one
 * picked among them, each stationed by `s0` from the picked element's start and
 * with what the element states: speed, runs beside it, open track ends.
 */
export function connectionPick(track, elIdx, along) {
  const piece = (i, s0) => {
    const el = track.elements[i]
    const coords = el.geometry?.coordinates ?? []
    // The cant at the element's ends: a transition's ramp, or an arc's or a
    // straight's own (cantEnds).
    const ramp = cantEnds(track.elements, i)
    return {
      elIdx: i, s0,
      startUtm: nodeUtm(el.startNode, coords[0], track.epsg),
      endUtm: nodeUtm(el.endNode, coords[coords.length - 1], track.epsg),
      bearing: el.bearing,
      route: switchElementRoute(el),
      cantStart: ramp.start,
      cantEnd:   ramp.end,
      speed: el.speed || null,
      trackEnds: [i === 0, i === track.elements.length - 1],
      // The runs of the element's curvature beside it, at its start and its end (Entscheidung 363).
      runs: ['before', 'after'].map(side => runBeside(track.elements, i, side)?.length ?? 0),
    }
  }
  const own = piece(elIdx, 0)
  const pieces = [own]
  for (let i = elIdx, s0 = 0; s0 > -STEM_REACH && turnoutRunsOn(track.elements, i, 'before', track.epsg); i--) {
    s0 -= track.elements[i - 1].length
    pieces.unshift(piece(i - 1, s0))
  }
  for (let i = elIdx, s0 = own.route.length; s0 < own.route.length + STEM_REACH
       && turnoutRunsOn(track.elements, i, 'after', track.epsg); i++) {
    pieces.push(piece(i + 1, s0))
    s0 += track.elements[i + 1].length
  }
  const { elIdx: _i, s0: _s, ...ownFields } = own
  return {
    trackId: track.id, elIdx, along, ...ownFields,
    zone: track.epsg, name: track.name || trackLabel(track),
    pieces,
  }
}

// A turnout of the connection is laid into one element of its track. Straight,
// curved or a transition curve — the construction lays the form on whatever
// route the element is (AP 2.1, AP 2.2), and over a transition the branch comes
// out a clothoid of the stem's own parameter. A Bloss curve is the exception:
// its pieces are no Bloss curves, so neither the branch nor the carve can be
// taken from it.
export const isUsableStem = (el) => el.elementType !== 2
  || (el.transitionType !== 'bloss' && el.r1 !== undefined)

// Put the switch's through route into its own elements in the half-track it runs
// into, and hand back the split's tracks with that one replaced — same id, so
// the remap is untouched.
//
// Null where the half-track cannot carry it: too little straight ahead of the
// junction, or a curve where the route would have to lie. That is not a
// cosmetic miss. The through route would then exist only as a port on the
// record, with no element boundary at the switch end and nothing marked, so the
// symbol would fall back on the stem radii and the delete rules would find a
// route with no elements. The caller refuses the connection instead.
function carveThrough(split, cutUtm, mark, length) {
  const carved = carveSwitchRoute(split.ahead, split.aheadEndpoint, cutUtm, mark, length, { accepts: isUsableStem })
  return carved ? split.tracks.map(tr => (tr.id === carved.id ? carved : tr)) : null
}

/** Below this a toe sits on its element's end node [m] — switchPlacement's JOINT_TOL. */
const JOINT_TOL = 1e-3

// Part a track at a toe `station` along its element `elIdx`. On one of the
// element's nodes that is the joint itself — cut there, the element would
// leave a piece of no length behind. A transition is cut at the station, as
// the clothoid it is: its pieces run from its radii to the one at the toe.
function splitAtToe(track, elIdx, station, junction, bearing, existingNames) {
  const n = track.elements.length
  const j = station <= JOINT_TOL ? elIdx
    : station >= track.elements[elIdx].length - JOINT_TOL ? elIdx + 1 : null
  const cut = track.elements[elIdx].elementType === 2 ? { ...junction, station } : junction
  return j != null && j > 0 && j < n
    ? splitTrackAtJoint(track, j, bearing, existingNames)
    : splitElementAt(track, elIdx, cut, bearing, existingNames)
}

// What a turnout is bent onto: the radius at its toe, or where the track
// under its through route changes — a transition, an element change — that
// stretch as a chain from the toe, so its switch end and its symbol lie on
// the track.
const bentOnto = (chain, atToe) => (chain?.length > 1 || (chain?.length && switchRouteVaries(chain[0])) ? chain : atToe)

// A plane point expressed in another CRS plane (as it is when already there).
function toPlane(p, crs) {
  if (Number(p.zone) === Number(crs)) return p
  return wgs84ToUTM(utmToWgs84(p.easting, p.northing, p.zone), crs)
}

// Pick 2 expressed in pick 1's native plane. All solver math runs in line 1's
// CRS; a second track in another CRS gets its points and its grid bearings
// converted. The radius is carried across as it stands — the two grids differ in
// scale by parts in ten thousand, which over a turnout is microns.
function stemInPlane(g, crs) {
  const { startUtm, bearing, route, along, cantStart, cantEnd } = g
  const pieces = (g.pieces ?? []).map(({ startUtm: p, bearing: b, route: r, cantStart: a, cantEnd: e, s0 }) => ({
    startUtm: p, bearing: b, route: r, cantStart: a, cantEnd: e, s0,
  }))
  if (Number(g.zone) === Number(crs)) return { startUtm, bearing, route, along, cantStart, cantEnd, pieces }
  const inPlane = (p, b) => ({
    startUtm: toPlane(p, crs), bearing: transformGridBearing(p.easting, p.northing, b, g.zone, crs),
  })
  return {
    ...inPlane(startUtm, bearing), route, along, cantStart, cantEnd,
    pieces: pieces.map(p => ({ ...p, ...inPlane(p.startUtm, p.bearing) })),
  }
}

// The two picks as the solver takes them: both in line 1's plane, line 1 turned
// towards the pick on line 2 (which turns its curvature and its cant with it).
export function stems(picks) {
  const [g1, g2] = picks
  const zone = g1.zone
  const s2 = stemInPlane(g2, zone)
  return { g1: orientStemToward(stemInPlane(g1, zone), s2), g2: s2 }
}

// Solve the connection geometry for a given shift (pure — no React state).
// A construction that closes but puts a turnout's toe off the element it was
// picked on, or its through route off the stem it may run on over, is no
// connection either — not even one to commit anyway (Entscheidung 361): the
// commit parts that element, and a turnout beyond the stem would be cut into a
// track it does not lie on.
export function solveConnection({ picks, speed, shift, mids = null, seed = null, form = null }) {
  const [g1, g2] = picks
  if (!g1 || !g2 || !speed) return null
  const { g1: a, g2: b } = stems(picks)
  const res = solveSwitchConnection(a, b, speed, shift, mids, seed, form)
  if (!stands(res, true) || turnoutsOnElements(picks, a.dir ?? 1, shift, res)) return res
  return { ...res, valid: false, overridable: false, reason: 'off_element' }
}

// Why a shift has no connection, in the words the panel shows.
export const REASON_MSG = {
  no_solution:      'scurve_no_solution',
  too_short:        'scurve_too_short',
  too_sharp:        'scurve_too_sharp',
  branch_too_sharp: 'scurve_branch_too_sharp',
  cant_mismatch:    'scurve_cant_mismatch',
  cant_over:        'scurve_cant_over',
  off_element:      'scurve_off_element',
  min_element_length: 'scurve_min_element_length',
  mid_unknowns:     'scurve_mid_unknowns',
  mid_no_solution:  'scurve_mid_no_solution',
  mid_element_short: 'scurve_mid_element_short',
  mid_jump:         'scurve_mid_jump',
}

/**
 * Does the connection `res` stand: valid — or, `lenient`, refused by the
 * rulebook alone, which may be committed anyway (Entscheidung 361)?
 */
const stands = (res, lenient = false) => !!res && (res.valid || (lenient && !!res.overridable))

/** Below this a turnout still counts as lying on its element [m]. */
const FIT_TOL = 1e-6

/** The pieces of a pick's stem: the elements its turnout may lie on (connectionPick). */
const pickPieces = (pick) => (pick.pieces?.length ? pick.pieces
  : [{ s0: 0, route: pick.route, speed: pick.speed, runs: pick.runs, trackEnds: pick.trackEnds }])

/** Stations along the element picked where its stem begins and ends. */
function pickExtent(pick) {
  const pieces = pickPieces(pick)
  const last = pieces[pieces.length - 1]
  return [pieces[0].s0, last.s0 + last.route.length]
}

/**
 * Does the turnout lie where it may? Its toe on the element it was picked on,
 * its through route on that element and the ones it runs on over (Entscheidung
 * 366) — the stem the construction laid it on, which the commit carves the
 * route from.
 *
 * `toe` is the toe's station along the element, `dir` which way the connection
 * runs along it (+1 with the element, −1 against), and `opening` which way the
 * turnout opens from its toe: with the connection for the first one, against it
 * for the second, whose toe is the far end of the crossover.
 */
function turnoutOnElement(pick, toe, dir, opening, throughLength) {
  const far = toe + dir * opening * throughLength
  const [from, to] = pickExtent(pick)
  return toe >= -FIT_TOL && toe <= pick.route.length + FIT_TOL
    && far >= from - FIT_TOL && far <= to + FIT_TOL
}

/** Both turnouts of a solved connection on the elements they were picked on. */
function turnoutsOnElements([p1, p2], dir1, shift, res) {
  if (res.s2 == null) return false
  const dir2 = res.flipped2 ? -1 : 1
  return turnoutOnElement(p1, p1.along + dir1 * shift, dir1, 1, res.throughLength)
      && turnoutOnElement(p2, p2.along + dir2 * res.s2, dir2, -1, res.throughLength)
}

// ── Minimum element length (LP.EL.01) ────────────────────────────────────────

/** Shorter than this a piece is none: the turnout sits on the node [m] (switchPlacement's JOINT_TOL). */
const NODE_TOL = 1e-3

/**
 * Where turnout `k` (0 or 1) of a solved connection lies on the element it was
 * picked on, as stations along that element: its toe (WA), its switch end (WE)
 * and the node behind its toe — the end of the element on the side away from
 * the turnout.
 */
function turnoutSpan(picks, k, shift, res) {
  const p = picks[k]
  const dir = k === 0 ? (stems(picks).g1.dir ?? 1) : (res.flipped2 ? -1 : 1)
  const toe = k === 0 ? p.along + dir * shift : p.along + dir * res.s2
  // The first turnout opens with the connection, the second against it.
  const far = toe + dir * (k === 0 ? 1 : -1) * res.throughLength
  const len = p.route.length
  return { toe, far, len, node: far > toe ? 0 : len }
}

/**
 * The pieces a connection leaves of the two elements it is laid into: on
 * either track the piece before WA and the piece behind WE. Each has to be
 * none at all (the turnout on the node) or at least l_min of LP.EL.01: before
 * WA at the speed of the diverging track — the connection's `speed`
 * (Entscheidung 219) —, behind WE at the element's own (`pick.speed`); `short`
 * marks the ones that are neither, `v` is the speed each was read at. A piece
 * runs on into the neighbours of its element's curvature beyond the node it
 * ends in (`pick.runs`, Entscheidung 363): `run` is what LP.EL.01 reads.
 * `pick.trackEnds` says whether the element's start and end node are its
 * track's open ends ([start, end]).
 *
 * Returns [{ track: 0|1, side: 'before'|'after', length, run, v, lMin, short }].
 */
export function connectionRemnants(picks, shift, res, speed) {
  const out = []
  for (const k of [0, 1]) {
    const { toe, far, len } = turnoutSpan(picks, k, shift, res)
    const forward = far > toe
    const before = forward ? toe : len - toe
    // The runs beside the element at its start and at its end.
    const [atStart, atEnd] = picks[k].runs ?? [0, 0]
    // Behind WE: the piece of the element the switch end falls in, which may
    // be one the turnout runs on into (Entscheidung 366).
    const end = weElement(picks[k], far, forward)
    for (const [side, length, v, beyond] of [
      ['before', before, speed || null, forward ? atStart : atEnd],
      ['after', end.length, end.speed, end.beyond],
    ]) {
      const l = Math.max(0, length)
      const run = l > NODE_TOL ? l + beyond : l
      const lMin = minElementLength(v)
      out.push({ track: k, side, length: l, run, v, lMin, short: lMin != null && l > NODE_TOL && run < lMin - NODE_TOL })
    }
  }
  return out
}

/**
 * The element of a pick's stem the switch end falls in, at station `far`
 * along the element picked: what is left of it beyond WE, the speed it states
 * and the run of its curvature beyond its node there. A switch end on a node
 * leaves nothing of the element it ends.
 */
function weElement(pick, far, forward) {
  const pieces = pickPieces(pick)
  const p = forward
    ? pieces.find(q => far <= q.s0 + q.route.length + NODE_TOL) ?? pieces[pieces.length - 1]
    : [...pieces].reverse().find(q => far >= q.s0 - NODE_TOL) ?? pieces[0]
  const [atStart, atEnd] = p.runs ?? [0, 0]
  return {
    length: forward ? p.s0 + p.route.length - far : far - p.s0,
    speed: p.speed || null,
    beyond: forward ? atEnd : atStart,
  }
}

/**
 * The shift that puts the toe of the second turnout on station `target` of its
 * element, searched over [lo, hi] for the crossing nearest to `from` — or null.
 * The second toe goes wherever the construction puts it, so it is found, not
 * computed.
 */
function shiftForSecondToe({ picks, speed, mids, seed, form = null, lenient = false }, target, from, lo, hi) {
  const off = (s) => {
    const res = solveConnection({ picks, speed, shift: s, mids, seed, form })
    return stands(res, lenient) ? turnoutSpan(picks, 1, s, res).toe - target : null
  }
  const span = hi - lo
  if (!(span > 0)) return null
  const n = Math.ceil(span / Math.max(0.5, span / 400))
  let best = null
  let prevS = null, prevF = null
  for (let i = 0; i <= n; i++) {
    const s = lo + span * i / n
    const f = off(s)
    if (f != null && prevF != null && (prevF <= 0) !== (f <= 0)) {
      let a = prevS, b = s, fa = prevF
      for (let it = 0; it < 60 && b - a > 1e-7; it++) {
        const m = (a + b) / 2, fm = off(m)
        if (fm == null) break
        if ((fa <= 0) === (fm <= 0)) { a = m; fa = fm } else b = m
      }
      const root = (a + b) / 2
      if (best == null || Math.abs(root - from) < Math.abs(best - from)) best = root
    }
    prevS = s
    prevF = f
  }
  return best
}

/**
 * The connection at the slider's `shift`, held to the minimum element length:
 * where a turnout would leave a piece of its element before WA shorter than
 * l_min, it is pushed back onto the element's node (Entscheidung 166) — the
 * first by moving the shift, the second by finding the shift that puts it
 * there. Whatever is still too short then, before WA or behind WE on either
 * track, makes it no connection (reason `min_element_length`, the piece as
 * `short`).
 *
 * Returns { shift, result, moved: [k…], remnants } — `shift` the one the
 * connection is built at, `moved` the turnouts pushed onto their nodes.
 */
export function settleConnection({ picks, speed, shift, mids = null, seed = null, form = null }) {
  let res = solveConnection({ picks, speed, shift, mids, seed, form })
  if (!res?.valid) return { shift, result: res, moved: [], remnants: [] }
  const moved = []
  const shortBefore = (k, r, s) => connectionRemnants(picks, s, r, speed).find(x => x.track === k && x.side === 'before' && x.short)
  const fail = (s, r, piece) => ({
    shift: s, moved, remnants: connectionRemnants(picks, s, r, speed),
    result: { ...r, valid: false, overridable: true, reason: 'min_element_length', short: piece },
  })

  // The first turnout: its toe onto the node behind it.
  // A node that is the track's open end has nothing behind it to part from:
  // a turnout is not pushed there.
  const openEnd = (k, node) => !!picks[k].trackEnds?.[node === 0 ? 0 : 1]

  const first = shortBefore(0, res, shift)
  if (first) {
    const { node } = turnoutSpan(picks, 0, shift, res)
    if (openEnd(0, node)) return fail(shift, res, first)
    const s = (node - picks[0].along) * (stems(picks).g1.dir ?? 1)
    const r = solveConnection({ picks, speed, shift: s, mids, seed, form })
    if (!r?.valid) return fail(shift, res, first)
    shift = s
    res = r
    moved.push(0)
  }

  // The second turnout likewise, found by searching the shift — over the
  // whole of the first element, as computeShiftBounds does.
  const second = shortBefore(1, res, shift)
  if (second) {
    const { node } = turnoutSpan(picks, 1, shift, res)
    if (openEnd(1, node)) return fail(shift, res, second)
    const dir1 = stems(picks).g1.dir ?? 1
    const sA = -dir1 * picks[0].along
    const sB = dir1 * (picks[0].route.length - picks[0].along)
    const s = shiftForSecondToe({ picks, speed, mids, seed, form }, node, shift, Math.min(sA, sB), Math.max(sA, sB))
    const r = s == null ? null : solveConnection({ picks, speed, shift: s, mids, seed, form })
    if (!r?.valid) return fail(shift, res, second)
    shift = s
    res = r
    moved.push(1)
  }

  const remnants = connectionRemnants(picks, shift, res, speed)
  const still = remnants.find(x => x.short)
  if (still) return fail(shift, res, still)
  return { shift, result: res, moved, remnants }
}

/**
 * Shift range [min, max] (metres) over which the connection stands: both
 * turnouts on their elements and the geometry valid throughout. The second
 * turnout goes wherever the construction puts it, so the solver is asked over
 * the whole of the first element. The pick need not be where it stands — a
 * click near an element's end leaves no room for the turnout there — so the
 * stretch that holds is the one nearest to the pick.
 *
 * The ends are exact: an element end where the stretch runs up to it, else
 * the edge of what holds, found to a micron — so a toe can be
 * put right onto its element's node.
 *
 * Where `around` holds, the stretch is the one around it, however narrow —
 * the shift an answer of the Python solver was adopted at (Entscheidung 357),
 * which the scan may step over.
 *
 * `lenient` counts a connection only the rulebook refuses as standing too: the
 * range the slider gets where no valid one stands, to commit one anyway
 * (Entscheidung 361). shiftSnaps and preferredShift take it alike.
 */
export function computeShiftBounds({ picks, speed, mids = null, seed = null, form = null, around = null, lenient = false }) {
  const [p1] = picks
  const dir1 = stems(picks).g1.dir ?? 1
  // The shifts that put the first toe on either end of its element.
  const sA = -dir1 * p1.along
  const sB = dir1 * (p1.route.length - p1.along)
  const lo1 = Math.min(sA, sB), hi1 = Math.max(sA, sB)
  const span = hi1 - lo1
  if (!(span > 0)) return { min: 0, max: 0 }
  const n = Math.ceil(span / Math.max(1, span / 200))

  const probe = (s) => stands(solveConnection({ picks, speed, shift: s, mids, seed, form }), lenient)
  // The edge between an invalid shift `bad` and a valid one `good`, on the valid side.
  const edge = (bad, good) => {
    while (Math.abs(good - bad) > 1e-6) {
      const m = (bad + good) / 2
      if (probe(m)) good = m; else bad = m
    }
    return good
  }

  if (around != null && around >= lo1 && around <= hi1 && probe(around)) {
    const step = span / n
    const reach = (dir, end) => {
      let good = around
      for (;;) {
        const next = dir > 0 ? Math.min(end, good + step) : Math.max(end, good - step)
        if (next === good) return good
        if (!probe(next)) return edge(next, good)
        good = next
      }
    }
    return { min: reach(-1, lo1), max: reach(1, hi1) }
  }

  const c = Math.min(hi1, Math.max(lo1, 0))
  const miss = (run) => Math.max(0, run.lo - c, c - run.hi)
  let best = null, run = null
  const close = (bad) => {
    if (run && bad != null) run.hi = edge(bad, run.hi)
    if (run && (!best || miss(run) < miss(best))) best = run
    run = null
  }
  let prev = null
  for (let i = 0; i <= n; i++) {
    const s = lo1 + span * i / n
    if (probe(s)) run = run ? { lo: run.lo, hi: s } : { lo: prev == null ? s : edge(prev, s), hi: s }
    else close(s)
    prev = s
  }
  close(null)
  if (!best) return { min: c, max: c }
  return { min: best.lo, max: best.hi }
}

/**
 * How far the first toe stands from the element change behind it at shift 0:
 * the click's distance from that node. The slider shows the toe's distance
 * from the element change, `shift + waOffset(picks)`.
 */
export function waOffset(picks) {
  const dir1 = stems(picks).g1.dir ?? 1
  return dir1 > 0 ? picks[0].along : picks[0].route.length - picks[0].along
}

/**
 * The shift that puts the second toe onto the element change behind it, within
 * `bounds` — or null where that node is its track's open end or no connection
 * stands there.
 */
function secondToeOnNode({ picks, speed, mids, seed, form = null, lenient = false }, bounds) {
  if (bounds.max <= bounds.min) return null
  const res = solveConnection({ picks, speed, shift: bounds.min, mids, seed, form })
    ?? solveConnection({ picks, speed, shift: bounds.max, mids, seed, form })
  if (!stands(res, lenient)) return null
  const { node } = turnoutSpan(picks, 1, bounds.min, res)
  if (picks[1].trackEnds?.[node === 0 ? 0 : 1]) return null
  // Often the node is what ends the range: beyond it the turnout leaves its element.
  for (const s of [bounds.min, bounds.max]) {
    const r = solveConnection({ picks, speed, shift: s, mids, seed, form })
    if (stands(r, lenient) && Math.abs(turnoutSpan(picks, 1, s, r).toe - node) < NODE_TOL) return s
  }
  return shiftForSecondToe({ picks, speed, mids, seed, form, lenient }, node, 0, bounds.min, bounds.max)
}

/**
 * The shifts the second toe crosses each station of `targets` at, within
 * [lo, hi]: one pass over the range, each crossing then halved down — the
 * second toe goes wherever the construction puts it, so it is found, not
 * computed.
 */
function secondToeCrossings({ picks, speed, mids, seed, form = null, lenient = false }, targets, lo, hi) {
  const toe = (s) => {
    const res = solveConnection({ picks, speed, shift: s, mids, seed, form })
    return stands(res, lenient) ? turnoutSpan(picks, 1, s, res).toe : null
  }
  const span = hi - lo
  if (!(span > 0)) return []
  const n = Math.ceil(span / Math.max(0.5, span / 200))
  const out = []
  let prevS = null, prevT = null
  for (let i = 0; i <= n; i++) {
    const s = lo + span * i / n
    const t = toe(s)
    if (t != null && prevT != null) {
      for (const target of targets) {
        if ((prevT - target <= 0) === (t - target <= 0)) continue
        let a = prevS, b = s, fa = prevT - target
        for (let it = 0; it < 60 && b - a > 1e-7; it++) {
          const m = (a + b) / 2, tm = toe(m)
          if (tm == null) break
          if ((fa <= 0) === (tm - target <= 0)) { a = m; fa = tm - target } else b = m
        }
        out.push((a + b) / 2)
      }
    }
    prevS = s
    prevT = t
  }
  return out
}

/**
 * The shifts the position slider snaps to (Entscheidung 310), within
 * `bounds`, ascending: where the toe (WA) or the switch end (WE) of either
 * turnout falls on a node of the element it is laid into.
 */
export function shiftSnaps({ picks, speed, mids = null, seed = null, form = null, lenient = false }, bounds) {
  if (!(bounds.max > bounds.min)) return []
  const atMin = solveConnection({ picks, speed, shift: bounds.min, mids, seed, form })
  const res = stands(atMin, lenient) ? atMin : solveConnection({ picks, speed, shift: bounds.max, mids, seed, form })
  if (!stands(res, lenient)) return []
  const through = res.throughLength
  const [p1, p2] = picks
  const dir1 = stems(picks).g1.dir ?? 1
  const dir2 = res.flipped2 ? -1 : 1
  const out = []
  // The nodes a switch end may fall on: those of the elements the turnout may
  // run on over too (Entscheidung 366).
  const nodes = (p) => [...pickPieces(p).map(q => q.s0), pickExtent(p)[1]]
  // Turnout 1 opens with the connection: WE lies the through length ahead of WA.
  for (const node of [0, p1.route.length]) out.push((node - p1.along) * dir1)
  for (const node of nodes(p1)) out.push((node - dir1 * through - p1.along) * dir1)
  // Turnout 2 opens against it: its WE lies the through length behind its WA.
  const targets = [0, p2.route.length, ...nodes(p2).map(node => node + dir2 * through)]
  out.push(...secondToeCrossings({ picks, speed, mids, seed, form, lenient }, targets, bounds.min, bounds.max))
  return uniqueStations(out).filter(s => s >= bounds.min - 1e-9 && s <= bounds.max + 1e-9)
}

/**
 * Where the dialog lays the connection first: the toe (WA) on the element
 * change behind it (Entscheidung 170) — the first turnout's, else the second
 * one's, whichever stands nearer to the click where both do; a node that is
 * its track's open end is no element change. Where neither stands, the shift
 * nearest to the click.
 */
export function preferredShift({ picks, speed, mids = null, seed = null, form = null, lenient = false }, bounds) {
  const ok = (s) => s != null && stands(settleConnection({ picks, speed, shift: s, mids, seed, form }).result, lenient)
  const candidates = []
  const d0 = waOffset(picks)
  const node1 = (stems(picks).g1.dir ?? 1) > 0 ? 0 : 1
  if (!picks[0].trackEnds?.[node1] && -d0 >= bounds.min - 1e-6) candidates.push(-d0)
  const s2 = secondToeOnNode({ picks, speed, mids, seed, form, lenient }, bounds)
  if (s2 != null) candidates.push(s2)
  const fit = candidates.filter(ok).sort((a, b) => Math.abs(a) - Math.abs(b))
  return fit.length ? fit[0] : Math.min(bounds.max, Math.max(bounds.min, 0))
}

/**
 * The commit of the S-curve dialog (R4.2): the two picked line tracks parted
 * at the turnouts, their through routes carved, the connection track between
 * them and the two switch records — the argument for commitSwitchConnection.
 * Null where `result` is no valid connection of two distinct tracks — with
 * `force`, one only the rulebook refuses is built all the same (Entscheidung 361);
 * { carveError } where a through route finds no room on its track.
 *
 * `result` is the solved connection (solveConnection at the chosen shift),
 * `picks` the two picked elements, `tracks`/`switches` the project's. An
 * edited connection (Entscheidung 364) keeps its turnouts' `identities`
 * ([first, second] records: id, name, number) and its connecting track
 * (`connTrack`, the old one: id, name and data).
 */
export function buildSCurve({ result, picks, tracks, switches, speed, force = false, identities = null, connTrack: oldConn = null }) {
  const res = result
  if (!stands(res, force)) return null

  const [g1, g2] = picks
  const t1 = tracks.find(tr => tr.id === g1?.trackId)
  const t2 = tracks.find(tr => tr.id === g2?.trackId)
  if (!t1 || !t2 || t1.id === t2.id) return null   // needs two distinct line tracks

  const zone   = res.zone
  const swType = res.switchType   // the form the solver settled on (primary or fallback)
  // The side the form is laid to, the same for both turnouts: track 2 lies to
  // the left of track 1 where track 1 lies to the left of track 2 run backwards,
  // which is the way the second turnout opens.
  const side = res.side > 0 ? 'left' : 'right'

  // The tangent each turnout opens on, as the construction settled them: at S1
  // the direction the connection leaves track 1 in, at S2 the direction back
  // towards the connection, which is the way the second turnout opens.
  const b1 = res.bearing1
  const b2Track = Number(t2.epsg) !== Number(g1.zone)
    ? transformGridBearing(res.TP2.easting, res.TP2.northing, res.bearing2, g1.zone, t2.epsg)
    : res.bearing2

  const existingNames = new Set(tracks.map(tr => tr.name))

  // Four split half-tracks (S1 on line 1, S2 on line 2). The junctions go in
  // as plane points in each track's own CRS.
  const station1 = g1.along + (stems(picks).g1.dir ?? 1) * res.s1
  const station2 = g2.along + (res.flipped2 ? -1 : 1) * res.s2
  const s1 = splitAtToe(t1, g1.elIdx, station1, toPlane(res.TP1, t1.epsg), b1, existingNames)
  const s2 = splitAtToe(t2, g2.elIdx, station2, toPlane(res.TP2, t2.epsg), b2Track, existingNames)

  // Two junction switches at S1 and S2.
  const existing = switches
  const no1 = identities?.[0]?.number ?? nextSwitchNumber(existing)
  const no2 = identities?.[1]?.number ?? nextSwitchNumber(existing, [no1])
  // The identity each record shares with the elements of its two routes: the
  // id ties them together, and it has to exist before the first element is
  // marked — which here is before either record is built.
  const identity = (old, no) => ({
    ...newSwitchFields(), name: switchDesignation(no), label: swType.label,
    ...(old ? { switchId: old.switchId, name: old.name } : {}),
  })
  const id1 = identity(identities?.[0], no1)
  const id2 = identity(identities?.[1], no2)

  // The connection track runs S1 → S2, so it begins at switch 1 and ends at switch 2.
  const connId = oldConn?.id ?? generateId()
  const straight = (chain) => chain.every(p => p.r1 == null && p.r2 == null)
  const j1 = buildJunctionSwitch({
    jWgs: res.tp1Wgs, jNode: [res.TP1.easting, res.TP1.northing], zone,
    tangentBearing: b1, side, sw: swType, speed, switchNumber: no1, identity: id1,
    stemR: bentOnto(res.stemRoute1, res.stemR1), branchStraight: straight(res.chain1),
    behind: { trackId: s1.behind.id, endpoint: s1.behindEndpoint },
    ahead:  { trackId: s1.ahead.id,  endpoint: s1.aheadEndpoint },
    conn:   { trackId: connId, endpoint: 'BEGIN' },
  })
  const j2 = buildJunctionSwitch({
    jWgs: res.tp2Wgs, jNode: [res.TP2.easting, res.TP2.northing], zone,
    tangentBearing: res.bearing2, side, sw: swType, speed, switchNumber: no2, identity: id2,
    // Turnout 2 opens against the direction the connection runs, so its stem
    // turns the other way under it.
    stemR: bentOnto(res.stemRoute2, res.stemR2 == null ? null : -res.stemR2), branchStraight: straight(res.chain2),
    behind: { trackId: s2.behind.id, endpoint: s2.behindEndpoint },
    ahead:  { trackId: s2.ahead.id,  endpoint: s2.aheadEndpoint },
    conn:   { trackId: connId, endpoint: 'END' },
  })

  // Connection track (S1 → S2): branch + middle element + branch. The two
  // branches are the turnouts' own — fixed length, marked as such — while the
  // element between them is ordinary track. A branch is more than one element
  // where the form ends in a straight piece or the turnout lies across
  // several elements of its host track. A swapped turnout's piece here is its
  // through route.
  const { branch1, midEls, branch2 } = buildConnectionElements(res, speed)
  const connElements = [
    ...branch1.map(el => ({ ...el, ...switchElementMark(id1, j1.connRoute) })),
    ...midEls,
    ...branch2.map(el => ({ ...el, ...switchElementMark(id2, j2.connRoute) })),
  ]
  // An edited connection keeps its track's data; its heights belonged to the
  // old geometry.
  const { heights: _heights, ...kept } = oldConn ?? {}
  const connTrack = {
    ...kept,
    id:          connId,
    name:        oldConn?.name ?? nextTrackName('connection', existingNames),
    epsg:     zone,
    coordinates: rebuildCoords(connElements),
    elements:    connElements,
  }

  // Each running track gets the turnout's route on it as its own elements —
  // the element boundary at the switch end both turnouts are built on.
  const s1Tracks = carveThrough(s1, toPlane(j1.lineEnd, t1.epsg), switchElementMark(id1, j1.lineRoute), j1.lineLength)
  const s2Tracks = carveThrough(s2, toPlane(j2.lineEnd, t2.epsg), switchElementMark(id2, j2.lineRoute), j2.lineLength)
  if (!s1Tracks || !s2Tracks) return { carveError: Math.max(j1.lineLength, j2.lineLength) }

  return {
    removeTrackIds: [t1.id, t2.id],
    addTracks:      [...s1Tracks, ...s2Tracks, connTrack],
    addSwitches:    [j1.record, j2.record],
    remap: [
      { oldId: t1.id, newId: s1Tracks.map(tr => tr.id) },
      { oldId: t2.id, newId: s2Tracks.map(tr => tr.id) },
    ],
  }
}
