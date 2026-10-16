import { describe, it, expect, vi } from 'vitest'
import {
  crsChoices, epsgDeviates, moveTracksToPlane, newTrackEpsg, ownLineCategory, planeGroup,
  previewTracksToPlane, projectEpsg, projectEpsgSetting, withLineCategory,
} from './projectSettings'
import { trackOf } from './commands/tracks'
import { straightFrom } from './elementFactory'
import { transformPlanePoint } from './coordinateUtils'
import { trackLength } from './heightUtils'

const UTM32 = 25832, UTM33 = 25833, GK3 = 5683

const track = (id, epsg = UTM32, extra = {}) => {
  const start = { easting: 690000, northing: 5700000, zone: epsg }
  const a = straightFrom(start, 90, 200)
  const b = straightFrom({ easting: a.endNode[0], northing: a.endNode[1], zone: epsg }, 90, 300)
  return { ...trackOf([a, b], epsg, {}, id), ...extra }
}

describe('the project coordinate system', () => {
  it('is the one the project names', () => {
    expect(projectEpsg({ epsg: UTM33, tracks: [track('a'), track('b')] })).toBe(UTM33)
    expect(projectEpsgSetting({ epsg: UTM33 })).toBe(UTM33)
  })

  it('is the plane most tracks lie in where it names none', () => {
    const project = { tracks: [track('a', UTM33), track('b'), track('c')] }
    expect(projectEpsgSetting(project)).toBeNull()
    expect(projectEpsg(project)).toBe(UTM32)
  })

  it('ignores a code the tool has no plane for', () => {
    expect(projectEpsg({ epsg: 4326, tracks: [track('a')] })).toBe(UTM32)
  })

  it('is what a new track is laid out in, the zone of the click without one', () => {
    expect(newTrackEpsg({ epsg: GK3, tracks: [] }, [13.4, 52.5])).toBe(GK3)
    expect(newTrackEpsg({ tracks: [] }, [13.4, 52.5])).toBe(UTM33)
    expect(newTrackEpsg(null, [9.0, 50.0])).toBe(UTM32)
  })

  it('marks a track in another plane as deviating', () => {
    const project = { epsg: UTM32, tracks: [track('a'), track('b', UTM33)] }
    expect(epsgDeviates(project.tracks[0], project)).toBe(false)
    expect(epsgDeviates(project.tracks[1], project)).toBe(true)
    expect(epsgDeviates(track('x'), { tracks: [] })).toBe(false)
  })

  it('offers the planes of a new track and the ones in use, once each', () => {
    const codes = crsChoices(UTM32, 5678, 4326).map(c => c.code)
    expect(codes).toContain(UTM33)
    expect(codes).toContain(5678)
    expect(codes).not.toContain(4326)
    expect(codes.filter(c => c === UTM32)).toHaveLength(1)
    expect(crsChoices().find(c => c.code === UTM33).label).toBe('EPSG 25833 – ETRS89 / UTM Zone 33N')
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
    { switchId: 's1', kind: 'turnout', portA_trackId: 'a', portA_endpoint: 'END', portB1_trackId: 'b', portB1_endpoint: 'BEGIN', portB2_trackId: 'c', portB2_endpoint: 'BEGIN' },
    { switchId: 's2', kind: 'turnout', portA_trackId: 'c', portA_endpoint: 'END', portB1_trackId: 'd', portB1_endpoint: 'BEGIN', portB2_trackId: 'e', portB2_endpoint: 'BEGIN' },
    { switchId: 'l1', kind: 'link', portA_trackId: 'e', portA_endpoint: 'END', portB_trackId: 'f', portB_endpoint: 'BEGIN' },
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
