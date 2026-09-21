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
import crossingFixture from '../test/fixtures/mdb_kreuzungsweiche.json'
import { buildAllTracksFromMdb } from './mdbImport'
import { switchPorts, isModelledSwitch } from './switchModel'
import { parseProjectsPayload, hydrateProjects, dehydrateProjects } from './persistenceUtils'
import { SCHEMA_VERSION } from './persistenceUtils'

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
  it('finds the form by radius and slope, across all four tables', () => {
    expect(switchTypeFor({ radius: 190, slope: 9 })?.label).toBe('190 – 1:9')
    expect(switchTypeFor({ radius: 500, slope: 14 })?.label).toBe('500 – 1:14')     // ALT1
    expect(switchTypeFor({ radius: 760, slope: 18.5 })?.label).toBe('760 – 1:18.5') // ALT2
    // The inventory table: forms the network carries that no connection builds.
    expect(switchTypeFor({ radius: 190, slope: 6.3 })?.label).toBe('190 – 1:6.3')
    expect(switchTypeFor({ radius: 215, slope: 4.8 })?.label).toBe('215 – 1:4.8')
  })

  it('has none for a form the table does not carry', () => {
    expect(switchTypeFor({ radius: 300, slope: 14 })).toBeNull()
    expect(switchTypeFor({ radius: null, slope: 9 })).toBeNull()
  })
})

describe('locateMdbSwitches', () => {
  it('finds the track running through the point and the one beginning there', () => {
    const found = locateMdbSwitches(payload, built.tracks)(units[0])
    expect(found.through).toHaveLength(1)
    expect(found.starting).toHaveLength(1)
    expect(found.through[0].track.name).not.toBe(found.starting[0].track.name)
    expect(found.through[0].station).toBeGreaterThan(0)
  })

  it('says what it found instead when no track carries the point', () => {
    const found = locateMdbSwitches(payload, [])({ ...units[0] })
    expect(found.through).toBeUndefined()
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

  it('will not build a Kreuzung where only one route runs through the point', () => {
    // The turnout fixture has a branch beginning at the point, not a second
    // route crossing it — a crossing needs two, and gets reported instead.
    const crossing = { ...units[0], kind: 'crossing', label: 'Kr 54-1:9', radius: null, slope: 9 }
    const res = placeMdbSwitches(payload, built.tracks, [crossing])
    expect(res.switches).toHaveLength(0)
    expect(res.errors.join(' ')).toMatch(/durch den Kreuzungspunkt/)
  })

  it('reports a form the table does not carry rather than rounding to the nearest', () => {
    const odd = { ...units[0], radius: 300, slope: 14, label: 'EW 54-300-1:14' }
    const res = placeMdbSwitches(payload, built.tracks, [odd])
    expect(res.switches).toHaveLength(0)
    expect(res.errors.join(' ')).toMatch(/keine Form im Weichenkatalog/)
  })

  it('leaves a note on the elements where it could not build the switch', () => {
    const odd = { ...units[0], radius: 300, slope: 14, label: 'EW 54-300-1:14' }
    const res = placeMdbSwitches(payload, built.tracks, [odd])
    const noted = res.tracks.flatMap(t => t.elements.filter(el => el.switchHint))
    expect(noted.length).toBeGreaterThan(0)
    expect(noted[0].switchHint).toMatch(/EW 54-300-1:14/)
    expect(noted[0].switchHint).toMatch(/Weichenkatalog/)
  })

  it('never marks a note as a switch route — that would need a record', () => {
    const odd = { ...units[0], radius: 300, slope: 14, label: 'EW 54-300-1:14' }
    const res = placeMdbSwitches(payload, built.tracks, [odd])
    // `parseProjectsPayload` refuses an element with switchBranch and no id.
    const noted = res.tracks.flatMap(t => t.elements.filter(el => el.switchHint))
    expect(noted.every(el => !el.switchBranch && !el.switchId)).toBe(true)
  })

  it('tells the branch from a plain continuation by its curvature', () => {
    // Both leave the point on the track's own tangent — a turnout is tangential
    // at the toe — so only the radius separates them.
    const found = locateMdbSwitches(payload, built.tracks)(units[0])
    const first = found.starting[0]
    const el = first.endpoint === 'BEGIN'
      ? first.track.elements[0]
      : first.track.elements[first.track.elements.length - 1]
    expect(Math.abs(el.radius ?? 0)).toBeCloseTo(switchTypeFor(units[0]).R, 0)
  })
})

describe('placeMdbSwitches — die Kreuzungsbauarten', () => {
  // A second slice of the file, cut around one doppelte Kreuzungsweiche: the
  // two crossing routes and the two connecting curves all run through the same
  // point, which is what makes this kind different from a turnout.
  const payload2 = parseMdbPayload(crossingFixture)
  const { units: units2 } = mdbSwitchInventory(payload2)
  const built2 = buildAllTracksFromMdb(payload2)
  const placed2 = placeMdbSwitches(payload2, built2.tracks, units2)

  it('builds the Kreuzungsweiche the fixture carries', () => {
    expect(placed2.switches).toHaveLength(1)
    expect(placed2.switches[0].kind).toBe('double_slip')
    expect(placed2.switches[0].label).toBe('DKW 1:9 – 190')
  })

  it('finds the crossing point from the corners, not from a node', () => {
    // All four corners are stated; none of them is the crossing point.
    expect(Object.keys(units2[0].padBySuffix).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('gives it four ports, every one on a track that is there', () => {
    const sw = placed2.switches[0]
    const ids = new Set(placed2.tracks.map(t => t.id))
    const ports = switchPorts(sw.kind)
    expect(ports).toHaveLength(4)
    for (const { trackKey } of ports) expect(ids.has(sw[trackKey]), trackKey).toBe(true)
  })

  it('marks one route main and the other cross', () => {
    const sw = placed2.switches[0]
    const marked = placed2.tracks.flatMap(t => t.elements.filter(el => elementBelongsToSwitch(el, sw)))
    expect(new Set(marked.map(el => el.switchRoute))).toEqual(new Set(['main', 'cross']))
  })

  it('yields a body the symbol can be derived from', () => {
    const byId = Object.fromEntries(placed2.tracks.map(t => [t.id, t]))
    const symbol = rebuildSwitchSymbol(placed2.switches[0], byId)
    expect(Array.isArray(symbol.fillCoords)).toBe(true)
    expect(symbol.fillCoords.length).toBeGreaterThan(0)
  })

  it('leaves the tracks joined after parting both routes', () => {
    for (const t of placed2.tracks) {
      expectNodesJoin(recalcAbsLengths(t.elements))
    }
  })
})

describe('an imported switch is stored like a built one', () => {
  // The claim: a record the import writes carries the same fields a switch
  // dialog commits, survives the store's round trip and comes back drawable.
  const sw = placed.switches[0]

  it('carries the symbol the dialog commits, not just the ports', () => {
    for (const key of ['fillCoords', 'lcsCoords', 'labelCoords', 'bauform']) {
      expect(sw[key], key).toBeTruthy()
    }
  })

  it('is a switch in the model\'s own terms', () => {
    expect(isModelledSwitch(sw)).toBe(true)
    expect(sw.formVersion).toBeTruthy()
    expect(Number.isInteger(sw.number)).toBe(true)
  })

  it('takes its number from the project, not from the file', () => {
    const busy = [{ switchId: 'x', kind: 'turnout', formVersion: 1, number: 1 }]
    const res = placeMdbSwitches(payload, built.tracks, units, { existingSwitches: busy })
    expect(res.switches[0].number).not.toBe(1)
  })

  it('passes the payload gate a saved project has to pass', () => {
    const projects = [{ id: 'p1', name: 'MDB', tracks: placed.tracks, switches: placed.switches }]
    const payloadOut = { version: SCHEMA_VERSION, projects: dehydrateProjects(projects) }
    expect(() => parseProjectsPayload(JSON.parse(JSON.stringify(payloadOut)))).not.toThrow()
  })

  it('comes back drawable after the store has written and read it', () => {
    const projects = [{ id: 'p1', name: 'MDB', tracks: placed.tracks, switches: placed.switches }]
    const round = JSON.parse(JSON.stringify(dehydrateProjects(projects)))
    hydrateProjects(round)
    const back = round[0].switches.find(x => x.switchId === sw.switchId)
    expect(Array.isArray(back.fillCoords)).toBe(true)
    expect(back.fillCoords.length).toBeGreaterThan(0)
  })
})
