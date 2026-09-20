import { describe, it, expect } from 'vitest'
import { parseMdbPayload, buildTracksFromMdb, mdbSwitchInventory } from './mdbImport'
import { placeMdbSwitches, locateMdbSwitches, switchTypeFor } from './mdbSwitchPlacement'
import { switchRoutesFromTracks, rebuildSwitchSymbol } from './switchUtils'
import { elementBelongsToSwitch } from './switchModel'
import {
  expectEpsgThroughout, expectNodesJoin, expectAbsLengthsRunning,
  expectLengthsTrue, expectRenderCoordsConsistent, expectSwitchRoutesCarved,
} from '../test/chainInvariants'
import { resolveEndBearing } from './elementUtils'
import { recalcAbsLengths } from '../storage'
import fixture from '../test/fixtures/mdb_weiche.json'

/**
 * AP 6.3 — the inventory put onto the tracks the same import built.
 *
 * The fixture is one line of the delivered database, cut to the stretch that
 * carries a single turnout: a track running through the switch point and the
 * branch beginning there. Nothing here generates switch geometry — the test is
 * that the record marks the surveyed elements and that the symbol can be
 * derived from them afterwards.
 */

const payload = parseMdbPayload(fixture)
const STRECKE = fixture.tracks[0].strecke
const { units } = mdbSwitchInventory(payload)
const built = buildTracksFromMdb(payload, STRECKE)
const placed = placeMdbSwitches(payload, built.tracks, units)

describe('switchTypeFor', () => {
  it('finds the form by radius and slope, across all three tables', () => {
    expect(switchTypeFor({ radius: 190, slope: 9 })?.label).toBe('190 – 1:9')
    expect(switchTypeFor({ radius: 500, slope: 14 })?.label).toBe('500 – 1:14')   // ALT1
    expect(switchTypeFor({ radius: 760, slope: 18.5 })?.label).toBe('760 – 1:18.5') // ALT2
  })

  it('has none for a form the table does not carry', () => {
    expect(switchTypeFor({ radius: 190, slope: 6.3 })).toBeNull()
    expect(switchTypeFor({ radius: null, slope: 9 })).toBeNull()
  })
})

describe('locateMdbSwitches', () => {
  it('finds the track running through the point and the one beginning there', () => {
    const found = locateMdbSwitches(payload, built.tracks)(units[0])
    expect(found.host).toBeTruthy()
    expect(found.branch).toBeTruthy()
    expect(found.host.track.name).not.toBe(found.branch.track.name)
    expect(found.host.station).toBeGreaterThan(0)
  })

  it('says what it found instead when no track carries the point', () => {
    const found = locateMdbSwitches(payload, [])({ ...units[0] })
    expect(found.host).toBeUndefined()
    expect(found.reason).toMatch(/kein Gleis/)
  })
})

describe('placeMdbSwitches', () => {
  it('places the turnout the fixture carries', () => {
    expect(placed.switches).toHaveLength(1)
    expect(placed.switches[0].kind).toBe('turnout')
    expect(placed.switches[0].label).toBe('190 – 1:7.5')
  })

  it('parts the host, so one more track comes back than went in', () => {
    expect(placed.tracks).toHaveLength(built.tracks.length + 1)
  })

  it('gives every port a track that is actually there', () => {
    const ids = new Set(placed.tracks.map(t => t.id))
    const sw = placed.switches[0]
    for (const key of ['portA_trackId', 'portB1_trackId', 'portB2_trackId']) {
      expect(ids.has(sw[key]), `${key} → ${sw[key]}`).toBe(true)
    }
  })

  it('keeps the point address as the identity the re-import can match on', () => {
    expect(placed.switches[0].pad).toBe(units[0].pad)
  })

  it('marks elements of both routes, on the branch and on the through track', () => {
    const sw = placed.switches[0]
    const marked = placed.tracks.flatMap(t => t.elements.filter(el => elementBelongsToSwitch(el, sw)))
    expect(marked.length).toBeGreaterThan(0)
    expect(new Set(marked.map(el => el.switchRoute))).toEqual(new Set(['main', 'branch']))
  })

  it('leaves every track a valid chain after the carve', () => {
    // Everything `expectValidTrack` checks except tangent continuity: surveyed
    // stock is not design geometry. Its bearings are rounded to 1e-6 gon, which
    // is the model's own tolerance, and the source carries real kinks besides
    // (4.3° at the worst joint of the delivered file). The claim below is the
    // one that belongs to this module instead.
    for (const t of placed.tracks) {
      const elements = recalcAbsLengths(t.elements)
      expectEpsgThroughout({ ...t, elements })
      expectNodesJoin(elements)
      expectAbsLengthsRunning(elements)
      expectLengthsTrue(elements)
      expectRenderCoordsConsistent(elements, t.epsg)
    }
  })

  it('does not bend anything the import had straight', () => {
    const worst = (tracks) => Math.max(0, ...tracks.flatMap(t => t.elements.slice(0, -1)
      .map((el, i) => Math.abs(((resolveEndBearing(el, t.epsg) - t.elements[i + 1].bearing + 540) % 360) - 180))))
    // Not identical — parting an element recomputes both halves, which can
    // shave a fraction off. The claim is that nothing gets worse.
    expect(worst(placed.tracks)).toBeLessThanOrEqual(worst(built.tracks) + 1e-9)
  })

  it('carves the routes the way the model checks them', () => {
    expectSwitchRoutesCarved(placed.switches[0], placed.tracks)
  })

  it('yields a switch the symbol can be derived from', () => {
    const byId = Object.fromEntries(placed.tracks.map(t => [t.id, t]))
    const routes = switchRoutesFromTracks(placed.switches[0], byId)
    expect(routes).toBeTruthy()
    expect(routes.branchStartWgs).toBeTruthy()
    const symbol = rebuildSwitchSymbol(placed.switches[0], byId)
    expect(Array.isArray(symbol.fillCoords)).toBe(true)
  })

  it('reports the kinds it does not set rather than setting them wrong', () => {
    const crossing = { ...units[0], kind: 'crossing', label: 'Kr 54-1:9' }
    const res = placeMdbSwitches(payload, built.tracks, [crossing])
    expect(res.switches).toHaveLength(0)
    expect(res.errors.join(' ')).toMatch(/nur Weichen/)
  })

  it('reports a form the table does not carry rather than rounding to the nearest', () => {
    const odd = { ...units[0], radius: 190, slope: 6.3, label: 'EW 54-190-1:6.3' }
    const res = placeMdbSwitches(payload, built.tracks, [odd])
    expect(res.switches).toHaveLength(0)
    expect(res.errors.join(' ')).toMatch(/keine Form in der Tabelle/)
  })
})
