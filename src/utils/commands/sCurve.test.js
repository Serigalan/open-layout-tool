import { describe, it, expect } from 'vitest'
import { SWITCH_TYPES } from '../switchConnectionUtils'
import { stems, solveConnection, computeShiftBounds, settleConnection, connectionRemnants, minElementLength, connectionPick, buildSCurve } from './sCurve'
import { hasPekBestand, loadPekBestand } from '../../test/pekFixture'
import { hydrateProjects } from '../persistenceUtils'
import { expectNodesJoin, expectSwitchRoutesCarved } from '../../test/chainInvariants'

const EPSG  = 25832
const P     = (e, n) => ({ easting: e, northing: n, zone: EPSG })
const SPEED = SWITCH_TYPES.find(f => f.label === '500 – 1:12').speed

/** A pick as the dialog makes one: the element it lies on and the station of the click. */
const pick = (startUtm, bearing, length, along, radius = null) => ({
  zone: EPSG, startUtm, bearing, along, elLength: length,
  route: { length, r1: radius, r2: radius },
  cantStart: 0, cantEnd: 0,
})

describe('which way the connection runs', () => {
  // Two parallel tracks running north. Track 2's element starts well behind
  // the first click, so its start node lies on the other side of it from the
  // second click.
  const p1 = pick(P(500000, 5600000), 0, 1000, 500)
  const p2 = pick(P(499995.5, 5599700), 0, 2000, 860)   // clicked at northing 5600560

  it('runs from the first click towards the second, not towards the element start of track 2', () => {
    expect(stems([p1, p2]).g1.dir ?? 1).toBe(1)
    const res = solveConnection({ picks: [p1, p2], speed: SPEED, shift: 0 })
    expect(res.valid).toBe(true)
    expect(res.TP2.northing).toBeGreaterThan(res.TP1.northing)
  })

  it('runs the other way when the second click lies behind the first', () => {
    const back = pick(P(499995.5, 5599700), 0, 2000, 740)   // northing 5600440
    expect(stems([p1, back]).g1.dir).toBe(-1)
    const res = solveConnection({ picks: [p1, back], speed: SPEED, shift: 0 })
    expect(res.valid).toBe(true)
    expect(res.TP2.northing).toBeLessThan(res.TP1.northing)
  })

  it('takes the second click on its own curve, not on the chord from the element start', () => {
    // Track 2 an arc bending away from track 1; its start node again behind the first click.
    const arc = pick(P(499995.5, 5599700), 0, 2000, 860, -3000)
    expect(stems([p1, arc]).g1.dir ?? 1).toBe(1)
  })
})

describe('where the slider may stand', () => {
  // A pick as the dialog makes one: no element length beside its route.
  const bare = (startUtm, bearing, length, along, radius = null) => {
    const { elLength: _l, ...p } = pick(startUtm, bearing, length, along, radius)
    return p
  }
  const SPEED_60 = SWITCH_TYPES.find(f => f.label === '500 – 1:12').speed

  it('opens a range over the element, not a single shift', () => {
    const picks = [bare(P(500000, 5600000), 0, 400, 100), bare(P(499995.5, 5599700), 0, 2000, 460)]
    const { min, max } = computeShiftBounds({ picks, speed: SPEED_60 })
    expect(max - min).toBeGreaterThan(50)
  })

  it('finds the stretch that holds when the pick itself leaves no room', () => {
    // Clicked 10 m before the element's end: the turnout reaches past it.
    const picks = [bare(P(500000, 5600000), 0, 200, 190), bare(P(499995.5, 5599700), 0, 2000, 560)]
    const at0 = solveConnection({ picks, speed: SPEED_60, shift: 0 })
    expect(at0.valid).toBe(false)
    expect(at0.reason).toBe('off_element')
    const { min, max } = computeShiftBounds({ picks, speed: SPEED_60 })
    expect(max).toBeLessThan(0)
    expect(min).toBeLessThan(max)
    expect(solveConnection({ picks, speed: SPEED_60, shift: max }).valid).toBe(true)
    expect(solveConnection({ picks, speed: SPEED_60, shift: min }).valid).toBe(true)
  })
})

describe('which side the second track lies on', () => {
  it('reads it abreast of the toe, not at a pick far ahead round a curve', () => {
    // Track 1 a right-hand curve R 500, track 2 concentric 4.7 m outside it.
    // The second pick lies 85 m ahead, where the curve has carried it across
    // the tangent at the first: 85² / 1000 > 4.7.
    const p1 = pick(P(500000, 5600000), 0, 200, 10, 500)
    const p2 = pick(P(499995.3, 5600000), 0, 200, 95, 504.7)
    const res = solveConnection({ picks: [p1, p2], speed: SPEED, shift: 0 })
    expect(res.side).toBe(1)
    expect(res.gap).toBeCloseTo(4.7, 6)
  })
})

describe('minimum element length at the turnouts (LP.EL.01)', () => {
  // Two parallel tracks running north, 4.5 m apart, designed for 160 km/h:
  // l_min = 0.2 · 160 = 32 m.
  const V = 160
  const fast = (startUtm, length, along) => ({ ...pick(startUtm, 0, length, along), speed: V })
  const far2 = fast(P(499995.5, 5599000), 3000, 1400)   // clicked at northing 5600400

  it('reads l_min from the catalogue, and none below its table', () => {
    expect(minElementLength(160)).toBeCloseTo(32)
    expect(minElementLength(80)).toBeCloseTo(12)
    expect(minElementLength(20)).toBeNull()
    expect(minElementLength(undefined)).toBeNull()
  })

  it('leaves a connection with long pieces where the slider put it', () => {
    const picks = [fast(P(500000, 5600000), 1000, 200), far2]
    const out = settleConnection({ picks, speed: SPEED, shift: 0 })
    expect(out.result.valid).toBe(true)
    expect(out.moved).toEqual([])
    expect(out.shift).toBe(0)
    expect(out.remnants.every(r => !r.short)).toBe(true)
  })

  it('pushes the first toe back onto the node where the piece before WA would be short', () => {
    const picks = [fast(P(500000, 5600000), 1000, 10), far2]
    expect(connectionRemnants(picks, 0, solveConnection({ picks, speed: SPEED, shift: 0 }))
      .find(r => r.track === 0 && r.side === 'before')).toMatchObject({ length: 10, short: true })
    const out = settleConnection({ picks, speed: SPEED, shift: 0 })
    expect(out.result.valid).toBe(true)
    expect(out.moved).toEqual([0])
    expect(out.shift).toBeCloseTo(-10)
    expect(out.result.TP1.northing).toBeCloseTo(5600000, 6)
    expect(out.remnants.find(r => r.track === 0 && r.side === 'before').length).toBeCloseTo(0, 6)
  })

  it('finds the shift that puts the second toe onto its node', () => {
    const p1 = fast(P(500000, 5600000), 1000, 200)
    const at0 = solveConnection({ picks: [p1, far2], speed: SPEED, shift: 0 })
    // The connection runs north, the second turnout opens back south: its WA
    // has the piece before it to the north. Track 2 ends 5 m beyond it there.
    const end = at0.TP2.northing + 5
    const len = 1500
    const p2 = fast(P(499995.5, end - len), len, 5600400 - (end - len))
    const picks = [p1, p2]
    const res = solveConnection({ picks, speed: SPEED, shift: 0 })
    expect(connectionRemnants(picks, 0, res).find(r => r.track === 1 && r.side === 'before'))
      .toMatchObject({ short: true })
    const out = settleConnection({ picks, speed: SPEED, shift: 0 })
    expect(out.result.valid).toBe(true)
    expect(out.moved).toEqual([1])
    expect(out.result.TP2.northing).toBeCloseTo(end, 4)
    expect(out.shift).toBeCloseTo(5, 3)
  })

  it('refuses a connection whose piece behind WE stays too short', () => {
    const through = solveConnection({ picks: [fast(P(500000, 5600000), 1000, 200), far2], speed: SPEED, shift: 0 }).throughLength
    // The element ends 10 m behind WE once the toe stands on its start node.
    const picks = [fast(P(500000, 5600000), through + 10, 5), far2]
    const out = settleConnection({ picks, speed: SPEED, shift: 0 })
    expect(out.moved).toEqual([0])
    expect(out.result.valid).toBe(false)
    expect(out.result.reason).toBe('min_element_length')
    expect(out.result.short).toMatchObject({ track: 0, side: 'after', short: true })
    expect(out.result.short.length).toBeCloseTo(10, 4)
  })

  it('does not push a toe onto the open end of its track', () => {
    const picks = [{ ...fast(P(500000, 5600000), 1000, 10), trackEnds: [true, false] }, far2]
    const out = settleConnection({ picks, speed: SPEED, shift: 0 })
    expect(out.moved).toEqual([])
    expect(out.result.valid).toBe(false)
    expect(out.result.short).toMatchObject({ track: 0, side: 'before', length: 10 })
  })

  it('checks nothing on an element without a speed', () => {
    const picks = [{ ...fast(P(500000, 5600000), 1000, 10), speed: undefined }, far2]
    const out = settleConnection({ picks, speed: SPEED, shift: 0 })
    expect(out.result.valid).toBe(true)
    expect(out.moved).toEqual([])
  })
})

describe.skipIf(!hasPekBestand)('minimum element length on the PEK Bestand', () => {
  // The two main tracks of line 6340 run side by side over long straights:
  // 6340.19604 element 5 and 6340.20386 element 4, each 536 m. The Bestand
  // carries no design speeds; here they run at 160 km/h, l_min = 32 m.
  const load = () => {
    const { tracks } = hydrateProjects([loadPekBestand()])[0]
    for (const tr of tracks) tr.elements = tr.elements.map(el => ({ ...el, speed: 160 }))
    return tracks
  }

  it('lays the connection on the joint instead of leaving a 10 m piece before WA', () => {
    const tracks = load()
    const t1 = tracks.find(tr => tr.name === '6340.19604')
    const t2 = tracks.find(tr => tr.name === '6340.20386')
    const p1 = connectionPick(t1, 5, 10)
    // The second pick abreast of the first, 100 m on.
    const near = (tr, idx, utm) => {
      const el = tr.elements[idx]
      const s = connectionPick(tr, idx, 0).startUtm
      const b = el.bearing * Math.PI / 180
      return connectionPick(tr, idx, Math.max(0, Math.min(el.length,
        (utm.easting - s.easting) * Math.sin(b) + (utm.northing - s.northing) * Math.cos(b))))
    }
    const b1 = t1.elements[5].bearing * Math.PI / 180
    const ahead = { easting: p1.startUtm.easting + 110 * Math.sin(b1), northing: p1.startUtm.northing + 110 * Math.cos(b1) }
    const p2 = near(t2, 4, ahead)
    const picks = [p1, p2]
    // 4.0 m apart: 60 km/h is the slowest form that finds its intermediate straight.
    const speed = 60
    const raw = solveConnection({ picks, speed, shift: 0 })
    expect(raw.valid).toBe(true)
    expect(connectionRemnants(picks, 0, raw).find(r => r.track === 0 && r.side === 'before'))
      .toMatchObject({ short: true })

    const out = settleConnection({ picks, speed, shift: 0 })
    expect(out.result.valid).toBe(true)
    expect(out.moved).toContain(0)
    const commit = buildSCurve({ result: out.result, picks, tracks, switches: [], speed })
    expect(commit.carveError).toBeUndefined()
    // What the turnouts leave of the two picked elements — every ordinary
    // element that was not there before — is none below l_min.
    const before = new Set([...t1.elements, ...t2.elements].map(el => el.length.toFixed(3)))
    // (The connection track, last, is new as a whole: its intermediate straight is no piece.)
    const pieces = commit.addTracks.slice(0, -1).flatMap(tr => tr.elements)
      .filter(el => !el.switchId && !before.has(el.length.toFixed(3)))
    expect(pieces.length).toBeGreaterThan(0)
    for (const el of pieces) expect(el.length, `piece of ${el.length} m`).toBeGreaterThanOrEqual(32 - 1e-3)
    // (The Bestand's own straights meet with kinks of up to 0.013°, so the
    // tangents are not held to the invariant here — the nodes are.)
    for (const tr of commit.addTracks) expectNodesJoin(tr.elements)
    for (const sw of commit.addSwitches) expectSwitchRoutesCarved(sw, commit.addTracks)
    // The first track is parted at the joint: its element 4 stays whole.
    expect(commit.addTracks.some(tr => tr.elements.at(-1)?.length === t1.elements[4].length)).toBe(true)
  })
})
