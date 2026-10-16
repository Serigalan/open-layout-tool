import { describe, it, expect, vi } from 'vitest'
import {
  crsChoices, dominantSystem, moveTracksToPlane, newTrackEpsg, ownLineCategory, planeGroup, planeInSystem,
  previewTracksToPlane, projectSystem, projectSystemSetting, systemChoices, systemDeviates, withImportSystem,
  withLineCategory, zoneChoices,
} from './projectSettings'
import { trackOf } from '../commands/tracks'
import { straightFrom } from '../geometry/elementFactory'
import { crsCentre, crsSystem, crsZone, systemCodeAt, systemZones, transformPlanePoint } from '../geometry/coordinateUtils'
import { trackLength } from '../track/heightUtils'

const UTM32 = 25832, UTM33 = 25833, GK3 = 5683, GK4 = 5684

const track = (id, epsg = UTM32, extra = {}) => {
  const start = { easting: 690000, northing: 5700000, zone: epsg }
  const a = straightFrom(start, 90, 200)
  const b = straightFrom({ easting: a.endNode[0], northing: a.endNode[1], zone: epsg }, 90, 300)
  return { ...trackOf([a, b], epsg, {}, id), ...extra }
}

describe('coordinate systems and their meridian strips', () => {
  it('name the system and the strip of a plane', () => {
    expect(crsSystem(UTM32)).toBe('ETRS89_UTM')
    expect(crsZone(UTM32)).toBe(32)
    expect(crsSystem(GK4)).toBe('DBREF_GK')
    expect(crsZone(GK4)).toBe(4)
    expect([crsSystem(5680), crsZone(5680)]).toEqual(['DHDN_GK', 1])
    expect([crsSystem(5678), crsZone(5678)]).toEqual(['DHDN_GK', 4])
    expect([crsSystem(3068), crsZone(3068)]).toEqual(['DHDN_SOLDNER', null])
    expect(crsSystem(4326)).toBeNull()
  })

  it('know the central meridian of a strip', () => {
    expect(crsCentre(GK4)).toBe(12)
    expect(crsCentre(UTM33)).toBe(15)
  })

  it('give the strip nearest to a longitude, the nearest one a system has', () => {
    expect(systemCodeAt('ETRS89_UTM', 11.9)).toBe(UTM32)
    expect(systemCodeAt('ETRS89_UTM', 12.1)).toBe(UTM33)
    expect(systemCodeAt('DBREF_GK', 10.4)).toBe(GK3)
    expect(systemCodeAt('DBREF_GK', 10.6)).toBe(GK4)
    expect(systemCodeAt('RD83_GK', 6)).toBe(3398)   // RD/83 has only zones 4 and 5
    expect(systemCodeAt('DHDN_SOLDNER', 13)).toBe(3068)
  })

  it('list every plane a system has, once', () => {
    expect(systemZones('DHDN_GK').map(z => z.code)).toEqual([5680, 5676, 5677, 5678, 5679])
  })
})

describe('the project coordinate system', () => {
  it('is the system the project names', () => {
    expect(projectSystem({ crsSystem: 'DBREF_GK', tracks: [track('a'), track('b')] })).toBe('DBREF_GK')
    expect(projectSystemSetting({ crsSystem: 'DBREF_GK' })).toBe('DBREF_GK')
  })

  it('is the system of a plane a project named before there were systems', () => {
    expect(projectSystemSetting({ epsg: GK3 })).toBe('DBREF_GK')
  })

  it('is the system most tracks lie in where it names none — strips counting as one', () => {
    const project = { tracks: [track('a', GK3), track('b', GK4), track('c', UTM32)] }
    expect(projectSystemSetting(project)).toBeNull()
    expect(dominantSystem(project.tracks)).toBe('DBREF_GK')
    expect(projectSystem(project)).toBe('DBREF_GK')
  })

  it('ignores a system it does not know', () => {
    expect(projectSystem({ crsSystem: 'nonsense', tracks: [track('a')] })).toBe('ETRS89_UTM')
  })

  it('lays a new track out in its system, in the strip of the click', () => {
    expect(newTrackEpsg({ crsSystem: 'DBREF_GK', tracks: [] }, [13.4, 52.5])).toBe(GK4)
    expect(newTrackEpsg({ crsSystem: 'DBREF_GK', tracks: [] }, [9.2, 50.0])).toBe(GK3)
    expect(newTrackEpsg({ tracks: [] }, [13.4, 52.5])).toBe(UTM33)
    expect(newTrackEpsg(null, [9.0, 50.0])).toBe(UTM32)
  })

  it('marks a track in another system as deviating, not one in another strip', () => {
    const project = { crsSystem: 'DBREF_GK', tracks: [track('a', GK3), track('b', GK4), track('c', UTM32)] }
    expect(systemDeviates(project.tracks[0], project)).toBe(false)
    expect(systemDeviates(project.tracks[1], project)).toBe(false)
    expect(systemDeviates(project.tracks[2], project)).toBe(true)
    expect(systemDeviates(track('x'), { tracks: [] })).toBe(false)
  })

  it('is named by an import where the project names none', () => {
    const tracks = [track('a', GK3), track('b', GK4), track('c', UTM32)]
    expect(withImportSystem({ tracks }).crsSystem).toBe('DBREF_GK')
    const set = { crsSystem: 'ETRS89_UTM', tracks }
    expect(withImportSystem(set)).toBe(set)
    const empty = { tracks: [] }
    expect(withImportSystem(empty)).toBe(empty)
  })

  it('carries a track into another system on the same central meridian where there is one', () => {
    expect(planeInSystem(track('a', 5678), 'DBREF_GK')).toBe(GK4)
    // UTM 33 (15°) has no GK strip of its own: the one nearest to where the track lies.
    const t = track('b', UTM33)
    expect(planeInSystem(t, 'DBREF_GK')).toBe(systemCodeAt('DBREF_GK', t.coordinates[1][0]))
  })

  it('offers the strips around a track\'s own', () => {
    expect(zoneChoices(track('a', GK4)).map(z => z.zone)).toEqual([2, 3, 4, 5])
    expect(zoneChoices(track('b', 32632)).map(z => z.zone)).toEqual([30, 31, 32, 33, 34])
  })

  it('offers ETRS89 / UTM, DB_REF / Gauß-Krüger and the systems in use, once each', () => {
    expect(systemChoices(UTM32, 5678, 4326)).toEqual(['ETRS89_UTM', 'DBREF_GK', 'DHDN_GK'])
  })

  it('still offers the planes of a new track in the drawing dialogs', () => {
    expect(crsChoices(5678).map(c => c.code)).toContain(5678)
  })
})

describe('the line category of a track', () => {
  it('is its own only where it names a known one', () => {
    expect(ownLineCategory({ lineCategory: 'secondary' })).toBe('secondary')
    expect(ownLineCategory({ lineCategory: 'nonsense' })).toBeNull()
    expect(ownLineCategory({})).toBeNull()
  })

  it('is set and taken away without leaving the key behind', () => {
    const t = withLineCategory({ id: 'a' }, 's_bahn')
    expect(t.lineCategory).toBe('s_bahn')
    expect('lineCategory' in withLineCategory(t, null)).toBe(false)
  })
})

describe('the tracks that share a plane', () => {
  const switches = [
    { switchId: 's1', kind: 'turnout', ports: { A: { trackId: 'a', endpoint: 'END' }, B1: { trackId: 'b', endpoint: 'BEGIN' }, B2: { trackId: 'c', endpoint: 'BEGIN' } }},
    { switchId: 's2', kind: 'turnout', ports: { A: { trackId: 'c', endpoint: 'END' }, B1: { trackId: 'd', endpoint: 'BEGIN' }, B2: { trackId: 'e', endpoint: 'BEGIN' } }},
    { switchId: 'l1', kind: 'link', ports: { A: { trackId: 'e', endpoint: 'END' }, B: { trackId: 'f', endpoint: 'BEGIN' } }},
  ]

  it('are the ones a turnout joins, transitively', () => {
    expect(new Set(planeGroup({ switches }, 'b'))).toEqual(new Set(['a', 'b', 'c', 'd', 'e']))
    expect(planeGroup({ switches }, 'b')[0]).toBe('b')
  })

  it('do not reach across a link', () => {
    expect(planeGroup({ switches }, 'f')).toEqual(['f'])
  })
})

describe('carrying tracks into another plane', () => {
  const project = () => ({
    tracks: [
      track('a', UTM32, { heights: [{ station: 0, z: 100 }, { station: 500, z: 101 }] }),
      track('b'),
    ],
    switches: [],
    platforms: [{ id: 'p', trackId: 'a', startStation: 100, endStation: 300 }, { id: 'q', trackId: 'b', startStation: 10, endStation: 20 }],
  })

  it('keeps every node on the ground and moves only the tracks named', () => {
    const before = project()
    const { project: after, report } = moveTracksToPlane(before, ['a'], UTM33)
    expect(report.moved).toBe(1)
    expect(report.refused).toBe(0)
    const [a, b] = after.tracks
    expect(a.epsg).toBe(UTM33)
    expect(b).toBe(before.tracks[1])
    a.elements.forEach((el, i) => {
      const src = before.tracks[0].elements[i]
      const [e, n] = transformPlanePoint(src.startNode[0], src.startNode[1], UTM32, UTM33)
      expect(Math.hypot(el.startNode[0] - e, el.startNode[1] - n)).toBeLessThan(1e-6)
    })
    expect(a.coordinates.length).toBeGreaterThanOrEqual(3)
  })

  it('restations the platforms and heights on a moved track by its change of length', () => {
    const before = project()
    const { project: after } = moveTracksToPlane(before, ['a'], UTM33)
    const k = trackLength(after.tracks[0]) / trackLength(before.tracks[0])
    expect(k).not.toBe(1)
    expect(after.platforms[0].startStation).toBeCloseTo(100 * k, 9)
    expect(after.platforms[0].endStation).toBeCloseTo(300 * k, 9)
    expect(after.platforms[1]).toBe(before.platforms[1])
    expect(after.tracks[0].heights.at(-1).station).toBeCloseTo(500 * k, 9)
  })

  it('refuses where an element has no nodes to carry over', () => {
    const before = project()
    before.tracks[0].elements.push({ elementType: 0, length: 10 })
    const res = moveTracksToPlane(before, ['a'], UTM33)
    expect(res.project).toBeNull()
    expect(res.report.refused).toBe(1)
  })

  it('does nothing for a track already in the plane or an unknown plane', () => {
    expect(moveTracksToPlane(project(), ['a'], UTM32).project).toBeNull()
    expect(moveTracksToPlane(project(), ['a'], 4326).project).toBeNull()
  })

  it('loads the grids of the datums involved before it previews', async () => {
    const loadGrids = vi.fn(async () => [])
    const res = await previewTracksToPlane(project(), ['a'], 5683, { loadGrids })
    expect(loadGrids).toHaveBeenCalledOnce()
    expect(loadGrids.mock.calls[0][1]).toEqual(['DBREF'])
    expect(res.report.moved).toBe(1)
  })
})
