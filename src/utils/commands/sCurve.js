import { generateId, switchDesignation, nextSwitchNumber } from '../identifierUtils'
import { nextTrackName, rebuildCoords, recalcAbsLengths } from '../trackModel'
import { computeSwitchGeometryUtm } from '../switch/symbol'
import { wgs84ToUTM, utmToWgs84, transformGridBearing } from '../coordinateUtils'
import { newSwitchFields, switchElementMark } from '../switchModel'
import { splitElementAt, carveSwitchRoute } from '../trackSplitUtils'
import { solveSwitchConnection, buildConnectionElements, orientStemToward } from '../switchConnectionUtils'

// The S-curve between two line tracks (SCurveForm): solving the connection
// for a shift, the range of shifts it stands over, and the commit.

const DEG2RAD = Math.PI / 180

// ── Commit helpers (split lines + build junction switches) ──────────────────

// Build a switch record at a junction. The symbol is derived from
// computeSwitchGeometry (same as connect switch); the curve side is chosen so the
// symbol's branch overlays the real connection arc (toward `branchUtm`).
// `throughEnd` comes back with it: the switch end on the running track, where
// that track has to be parted so the turnout's through route is its own element.
function buildJunctionSwitch({ jWgs, jNode, zone, tangentBearing, branchUtm, sw, speed, switchNumber,
                               identity, stemR = null,
                               behindTrackId, behindEndpoint, aheadTrackId, aheadEndpoint,
                               branchTrackId, branchEndpoint }) {
  const tE = Math.sin(tangentBearing * DEG2RAD), tN = Math.cos(tangentBearing * DEG2RAD)
  const crossSign = (p) => Math.sign(tE * (p.northing - jNode[1]) - tN * (p.easting - jNode[0]))
  const target = crossSign(branchUtm)
  const jUtm = { easting: jNode[0], northing: jNode[1], zone }
  // `stemR` bends the turnout into the track it is laid in: both of its routes
  // take that curvature on top of their own, so in a curve the symbol follows
  // the track instead of standing beside it.
  let geom = computeSwitchGeometryUtm(jUtm, tangentBearing, sw, 'left', false, jWgs, stemR)
  for (const side of ['left', 'right']) {
    const g  = computeSwitchGeometryUtm(jUtm, tangentBearing, sw, side, false, jWgs, stemR)
    if (crossSign(g.curvedUtm) === target) { geom = g; break }
  }
  return {
    throughEnd: geom.straightUtm,
    throughLength: geom.straightLen,
    record: {
      ...identity,
      number: switchNumber, trailing: false, speed,
      // The stem radius at the toe, so a reload can rebuild a bent symbol even
      // where the marked elements cannot be read back.
      ...(geom.stemAtToe ? { mainRadius: geom.stemAtToe } : {}),
      portA_trackId:  behindTrackId,  portA_endpoint:  behindEndpoint,
      portB1_trackId: branchTrackId,  portB1_endpoint: branchEndpoint,
      portB2_trackId: aheadTrackId,   portB2_endpoint: aheadEndpoint,
      fillCoords: geom.fillCoords, lcsCoords: geom.lcsCoords,
      labelCoords: geom.labelCoords, bauform: geom.bauform,
    },
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

// A plane point expressed in another CRS plane (as it is when already there).
function toPlane(p, crs) {
  if (Number(p.zone) === Number(crs)) return p
  return wgs84ToUTM(utmToWgs84(p.easting, p.northing, p.zone), crs)
}

// Pick 2 expressed in pick 1's native plane. All solver math runs in line 1's
// CRS; a second track in another CRS gets its point and its grid bearing
// converted. The radius is carried across as it stands — the two grids differ in
// scale by parts in ten thousand, which over a turnout is microns.
function stemInPlane(g, crs) {
  const { startUtm, bearing, route, along, cantStart, cantEnd } = g
  if (Number(g.zone) === Number(crs)) return { startUtm, bearing, route, along, cantStart, cantEnd }
  return {
    startUtm: toPlane(startUtm, crs),
    bearing: transformGridBearing(startUtm.easting, startUtm.northing, bearing, g.zone, crs),
    route, along, cantStart, cantEnd,
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
export function solveConnection({ picks, speed, shift }) {
  const [g1, g2] = picks
  if (!g1 || !g2 || !speed) return null
  const { g1: a, g2: b } = stems(picks)
  return solveSwitchConnection(a, b, speed, shift)
}

// Why a shift has no connection, in the words the panel shows.
export const REASON_MSG = {
  no_solution:      'scurve_no_solution',
  too_short:        'scurve_too_short',
  too_sharp:        'scurve_too_sharp',
  branch_too_sharp: 'scurve_branch_too_sharp',
  cant_mismatch:    'scurve_cant_mismatch',
  cant_over:        'scurve_cant_over',
}

/** Below this a turnout still counts as lying on its element [m]. */
const FIT_TOL = 1e-6

/**
 * Does the turnout fit inside the element it was picked on? Its stem has to be
 * one element's worth of geometry — that is what makes the branch a single arc
 * and lets the through route be carved out of one element — so the whole of its
 * through route has to lie between that element's two nodes.
 *
 * `toe` is the toe's station along the element, `dir` which way the connection
 * runs along it (+1 with the element, −1 against), and `opening` which way the
 * turnout opens from its toe: with the connection for the first one, against it
 * for the second, whose toe is the far end of the crossover.
 */
function turnoutOnElement(pick, toe, dir, opening, throughLength) {
  const far = toe + dir * opening * throughLength
  return Math.min(toe, far) >= -FIT_TOL && Math.max(toe, far) <= pick.route.length + FIT_TOL
}

/** Which way the connection runs along the first picked element (+1 with it, −1 against). */
const direction1 = (picks) => stems(picks).g1.dir ?? 1

/**
 * Shift range [min, max] (metres) over which the connection stands: the first
 * turnout on its element, the second one — wherever the solver puts it — on
 * its own, and the geometry valid throughout. The first is analytic, the second
 * follows the construction, so the solver is walked outward from shift 0 until
 * one of them gives. The valid region is a single interval around 0.
 */
export function computeShiftBounds({ picks, speed }) {
  const [p1, p2] = picks
  const dir1 = direction1(picks)
  // The shifts that put the first toe on either end of its element.
  const sA = -dir1 * p1.along
  const sB = dir1 * (p1.elLength - p1.along)
  const lo1 = Math.min(sA, sB), hi1 = Math.max(sA, sB)
  const span = hi1 - lo1
  if (!(span > 0)) return { min: 0, max: 0 }
  const step = Math.max(0.5, span / 400)

  const probe = (s) => {
    const res = solveConnection({ picks, speed, shift: s })
    if (!res?.valid || res.s2 == null) return false
    const dir2 = (res.flipped2 ? -1 : 1)
    return turnoutOnElement(p1, p1.along + dir1 * s, dir1, 1, res.throughLength)
        && turnoutOnElement(p2, p2.along + dir2 * res.s2, dir2, -1, res.throughLength)
  }

  const c = Math.min(hi1, Math.max(lo1, 0))
  let hi = c
  for (let s = c; s <= hi1 + 1e-9; s += step) { if (!probe(s)) break; hi = s }
  let lo = c
  for (let s = c; s >= lo1 - 1e-9; s -= step) { if (!probe(s)) break; lo = s }
  const min = Math.ceil(lo), max = Math.floor(hi)
  if (min > max) { const m = Math.round(c); return { min: m, max: m } }
  return { min, max }
}


/**
 * The commit of the S-curve dialog (R4.2): the two picked line tracks parted
 * at the turnouts, their through routes carved, the connection track between
 * them and the two switch records — the argument for commitSwitchConnection.
 * Null where `result` is no valid connection of two distinct tracks;
 * { carveError } where a through route finds no room on its track.
 *
 * `result` is the solved connection (solveConnection at the chosen shift),
 * `picks` the two picked elements, `tracks`/`switches` the project's.
 */
export function buildSCurve({ result, picks, tracks, switches, speed }) {
  const res = result
  if (!res || !res.valid) return null

  const [g1, g2] = picks
  const t1 = tracks.find(tr => tr.id === g1?.trackId)
  const t2 = tracks.find(tr => tr.id === g2?.trackId)
  if (!t1 || !t2 || t1.id === t2.id) return null   // needs two distinct line tracks

  const zone   = res.zone
  const swType = res.switchType   // the form the solver settled on (primary or fallback)

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
  const s1 = splitElementAt(t1, g1.elIdx, toPlane(res.TP1, t1.epsg), b1, existingNames)
  const s2 = splitElementAt(t2, g2.elIdx, toPlane(res.TP2, t2.epsg), b2Track, existingNames)

  // Two junction switches at S1 and S2.
  const existing = switches
  const no1 = nextSwitchNumber(existing)
  const no2 = nextSwitchNumber(existing, [no1])
  // The identity each record shares with the elements of its two routes: the
  // id ties them together, and it has to exist before the first element is
  // marked — which here is before either record is built.
  const id1 = { ...newSwitchFields(), name: switchDesignation(no1), label: swType.label }
  const id2 = { ...newSwitchFields(), name: switchDesignation(no2), label: swType.label }

  // Connection track (S1 → S2): branch + middle element + branch. The two
  // branches are the turnouts' own — fixed length, marked as such — while the
  // element between them is ordinary track. A branch is more than one element
  // where the form ends in a straight piece or the turnout lies across
  // several elements of its host track.
  const { branch1, midEl, branch2 } = buildConnectionElements(res, speed)
  const connElements = recalcAbsLengths([
    ...branch1.map(el => ({ ...el, ...switchElementMark(id1, 'branch') })),
    midEl,
    ...branch2.map(el => ({ ...el, ...switchElementMark(id2, 'branch') })),
  ])
  const connTrack = {
    id:          generateId(),
    name:        nextTrackName('connection', existingNames),
    epsg:     zone,
    coordinates: rebuildCoords(connElements),
    elements:    connElements,
  }

  // The connection track runs S1 → S2, so it begins at switch 1 and ends at switch 2.
  const j1 = buildJunctionSwitch({
    jWgs: res.tp1Wgs, jNode: [res.TP1.easting, res.TP1.northing], zone,
    tangentBearing: b1, branchUtm: res.B1E, sw: swType, speed, switchNumber: no1, identity: id1,
    stemR: res.stemR1,
    behindTrackId: s1.behind.id, behindEndpoint: s1.behindEndpoint,
    aheadTrackId:  s1.ahead.id,  aheadEndpoint:  s1.aheadEndpoint,
    branchTrackId: connTrack.id, branchEndpoint: 'BEGIN',
  })
  const j2 = buildJunctionSwitch({
    jWgs: res.tp2Wgs, jNode: [res.TP2.easting, res.TP2.northing], zone,
    tangentBearing: res.bearing2, branchUtm: res.B2A, sw: swType, speed, switchNumber: no2, identity: id2,
    // Turnout 2 opens against the direction the connection runs, so its stem
    // turns the other way under it.
    stemR: res.stemR2 == null ? null : -res.stemR2,
    behindTrackId: s2.behind.id, behindEndpoint: s2.behindEndpoint,
    aheadTrackId:  s2.ahead.id,  aheadEndpoint:  s2.aheadEndpoint,
    branchTrackId: connTrack.id, branchEndpoint: 'END',
  })

  // Each running track gets the turnout's through route as its own element —
  // the element boundary at the switch end both turnouts are built on.
  const s1Tracks = carveThrough(s1, toPlane(j1.throughEnd, t1.epsg), switchElementMark(id1, 'main'), j1.throughLength)
  const s2Tracks = carveThrough(s2, toPlane(j2.throughEnd, t2.epsg), switchElementMark(id2, 'main'), j2.throughLength)
  if (!s1Tracks || !s2Tracks) return { carveError: Math.max(j1.throughLength, j2.throughLength) }

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
