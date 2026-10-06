import { describe, it, expect } from 'vitest'
import { utmEndRoute } from '../utils/switch/route'
import { bearingAfterUtm } from '../utils/elementUtils'
import { utmToWgs84 } from '../utils/coordinateUtils'
import { SWITCH_TYPES, switchBranchLength, switchStraightLength } from '../utils/switch/catalogue'
import { computeSwitchGeometryUtm, switchRoutesFromTracks } from '../utils/switch/symbol'
import { switchChainPointUtm } from '../utils/switch/route'
import { hydrateProjects, dehydrateProjects } from '../utils/persistenceUtils'
import { switchOnTrackPlacement, buildSwitchOnTrack, buildSwitchAtTrackEnd } from '../utils/commands/switches'
import { solveConnection, computeShiftBounds, buildSCurve } from '../utils/commands/sCurve'
import { switchElementRoute } from '../utils/switch/route'
import { planSwitchDeletion } from '../utils/switchDelete'
import { findCrossovers, crossoverFrame } from '../utils/crossoverGradient'
import { ldsFromToe } from '../utils/switchGradient'
import { recalcAbsLengths } from '../utils/trackModel'
import { expectValidTrack } from './chainInvariants'

/**
 * An outer-bent turnout whose stem radius is its form's own has a straight
 * branch. That is the plain form with its routes swapped, and every dialog
 * builds it as one: the curved line is its branch (B1), the straight its
 * through route (B2), and the record says `swapped` so the line is followed
 * over B1.
 */

const EPSG = 25832
const FORM = SWITCH_TYPES.find(form => form.label === '500 – 1:12')
const START = { easting: 500000, northing: 5600000, zone: EPSG }

/** One element of a track, as a file stores it — geometry comes with the load. */
function element(start, bearing, length, radius = null, cant = 0) {
  const end = utmEndRoute(start, bearing, length, radius)
  return {
    elementType: radius ? 1 : 0,
    startNode: [start.easting, start.northing], endNode: [end.easting, end.northing],
    bearing, length, absLength: length, speed: 60,
    ...(radius ? { radius, endBearing: bearingAfterUtm(bearing, length, radius), cant } : {}),
  }
}

/** A straight running into a right-hand R 500, heading east. */
function curvedLine(id = 't1', start = START, radius = FORM.R, name = 'line.001') {
  const a = element({ ...start, easting: start.easting - 100 }, 90, 100)
  const b = element(start, 90, 300, radius)
  return { id, name, epsg: EPSG, elements: [a, b] }
}

const load = (project) => hydrateProjects(JSON.parse(JSON.stringify(dehydrateProjects([project]))))[0]
const byIdOf = (tracks) => Object.fromEntries(tracks.map(t => [t.id, t]))

describe('the geometry', () => {
  it('lays the plain form from the toe where the branch comes out straight', () => {
    const g = computeSwitchGeometryUtm(START, 90, FORM, 'left', false, null, FORM.R)
    expect(g.bauform).toBe('abw_straight')
    expect(g.swapped).not.toBeNull()
    expect(g.swapped.bauform).toBe('plain')
    // Its branch is the stem: it ends on the curved track, the form's branch length along it.
    const onStem = switchChainPointUtm(START, 90, [{ length: 1000, r1: FORM.R, r2: FORM.R }], switchBranchLength(FORM))
    expect(Math.hypot(g.swapped.curvedUtm.easting - onStem.easting, g.swapped.curvedUtm.northing - onStem.northing)).toBeLessThan(1e-6)
    expect(g.swapped.straightLen).toBeCloseTo(switchStraightLength(FORM), 9)
  })

  it('leaves every other bent turnout as it is', () => {
    expect(computeSwitchGeometryUtm(START, 90, FORM, 'right', false, null, FORM.R).swapped).toBeNull()
    expect(computeSwitchGeometryUtm(START, 90, FORM, 'left', false, null, 600).swapped).toBeNull()
    expect(computeSwitchGeometryUtm(START, 90, FORM, 'left', false, null, null).swapped).toBeNull()
  })
})

describe('a turnout laid into the curve', () => {
  const project = load({ id: 'p', tracks: [curvedLine()], switches: [] })
  const track = project.tracks[0]
  const straightLen = switchStraightLength(FORM)
  const toeStation = 150
  const placement = switchOnTrackPlacement({ track, toeStation, reversed: false, sw: FORM, side: 'left', straightLen })
  const commit = buildSwitchOnTrack({
    track, tracks: project.tracks, place: placement.place, g: placement.geom, plain: placement.plain,
    sw: FORM, straightLen, cant: 0, cantReason: '', speed: 60,
    switchName: 'W1', switchNumber: 1, name: 'leaving', fields: {},
  })
  const rec = commit.addSwitches[0]
  const tracks = [...commit.addTracks]
  const after = load({ id: 'p', tracks, switches: commit.addSwitches })
  const byId = byIdOf(after.tracks)

  it('makes the curved line its branch and the new straight its through route', () => {
    expect(rec.swapped).toBe(true)
    expect(byId[rec.portB2_trackId].name).toBe('leaving')
    expect(byId[rec.portB1_trackId].name).not.toBe('leaving')
    after.tracks.forEach(t => expectValidTrack(t))
  })

  it('reads back as the plain form', () => {
    const sw = after.switches[0]
    expect(sw.bauform).toBe('plain')
    const routes = switchRoutesFromTracks(sw, byId)
    expect(routes.stem.every(p => p.r1 == null)).toBe(true)
    expect(routes.branch[0].r1).toBeCloseTo(FORM.R, 6)
    expect(routes.branch.reduce((s, p) => s + p.length, 0)).toBeCloseTo(switchBranchLength(FORM), 6)
  })

  it('keeps the line when it goes, and takes the straight with it', () => {
    const plan = planSwitchDeletion(after.switches[0], after.tracks)
    expect(plan.reason).toBe('branch')
    expect(plan.removedTracks).toEqual(['leaving'])
    expect(plan.joined).toBe(true)
  })

  it('leads the gradient along the line', () => {
    expect(ldsFromToe(after.tracks, after.switches[0])).toBeGreaterThan(switchBranchLength(FORM))
  })
})

describe('a turnout at the end of a curved track', () => {
  const build = (trailing, side) => buildSwitchAtTrackEnd({
    start: START, bearing: 90, startWgs: utmToWgs84(START.easting, START.northing, EPSG), sourceTrackId: 'src',
    sw: FORM, side, trailing, stemSigned: FORM.R, cant: 0, cantReason: '', speed: 60,
    switchName: 'W1', switchNumber: 1, name: 'leaving', fields: {}, mainName: 'curve', mainFields: {},
  })
  const source = () => ({ id: 'src', name: 'src', epsg: EPSG, elements: [element({ ...START, easting: START.easting - 100 }, 90, 100)] })
  const reload = (commit) => {
    const src = source()
    src.elements = recalcAbsLengths([...src.elements, ...(commit.append[0]?.elements ?? [])])
    return load({ id: 'p', tracks: [src, ...commit.addTracks], switches: commit.addSwitches })
  }

  it('facing: the arc continuing the line is the branch, the straight the through route', () => {
    const commit = build(false, 'left')
    const rec = commit.addSwitches[0]
    const p = reload(commit)
    const byId = byIdOf(p.tracks)
    expect(rec.swapped).toBe(true)
    expect(byId[rec.portB1_trackId].name).toBe('curve')
    expect(byId[rec.portB2_trackId].name).toBe('leaving')
    expect(p.switches[0].bauform).toBe('plain')
  })

  it('trailing: the arc is appended to the track up to the toe, the straight leaves from there', () => {
    const commit = build(true, 'right')
    const rec = commit.addSwitches[0]
    const p = reload(commit)
    const byId = byIdOf(p.tracks)
    expect(rec.swapped).toBe(true)
    expect(rec.portB1_trackId).toBe('src')
    expect(byId[rec.portB2_trackId].name).toBe('leaving')
    const appended = commit.append[0].elements[0]
    expect(appended.startNode).toEqual([START.easting, START.northing])
    expect(appended.length).toBeCloseTo(switchBranchLength(FORM), 6)
    expect(p.switches[0].bauform).toBe('plain')
    p.tracks.forEach(t => expectValidTrack(t))
  })
})

describe('a crossover out of the curve', () => {
  // Track 1 the R 500, track 2 concentric 4.5 m outside it, both canted as
  // the line is: turnout 1 opens outwards and comes out swapped, turnout 2
  // opens inwards and is bent — tight enough to need that cant.
  const inner = curvedLine('t1')
  inner.elements[1].cant = 100
  const outer = { id: 't2', name: 'line.002', epsg: EPSG,
    elements: [element({ ...START, northing: START.northing + 4.5 }, 90, 400, FORM.R + 4.5, 100)] }
  const project = load({ id: 'p', tracks: [inner, outer], switches: [] })
  const pick = (track, elIdx, along) => {
    const el = track.elements[elIdx]
    return {
      trackId: track.id, elIdx, startUtm: { easting: el.startNode[0], northing: el.startNode[1], zone: EPSG },
      bearing: el.bearing, route: switchElementRoute(el), along, cantStart: el.cant ?? 0, cantEnd: el.cant ?? 0, zone: EPSG,
    }
  }
  const picks = [pick(project.tracks[0], 1, 20), pick(project.tracks[1], 0, 80)]
  const { min } = computeShiftBounds({ picks, speed: FORM.speed })
  const res = solveConnection({ picks, speed: FORM.speed, shift: min })
  const commit = buildSCurve({ result: res, picks, tracks: project.tracks, switches: [], speed: FORM.speed })
  const after = load({ id: 'p', tracks: commit.addTracks, switches: commit.addSwitches })

  it('builds the outward turnout swapped and the inward one bent', () => {
    expect(res.valid).toBe(true)
    const [w1, w2] = after.switches
    expect(w1.swapped).toBe(true)
    expect(w1.bauform).toBe('plain')
    expect(w2.swapped).toBeUndefined()
    expect(w2.bauform).toBe('ibw')
    after.tracks.forEach(t => expectValidTrack(t))
  })

  it('is still found as a crossover, with each line on its own track', () => {
    const found = findCrossovers(after.tracks, after.switches)
    expect(found).toHaveLength(1)
    expect(crossoverFrame(after.tracks, after.switches, found[0])).not.toBeNull()
  })
})
