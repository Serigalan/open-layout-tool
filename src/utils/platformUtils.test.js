import { describe, it, expect } from 'vitest'
import {
  PLATFORM_FRONT_OFFSET, PLATFORM_BACK_OFFSET, PLATFORM_WIDTH,
  PLATFORM_HEIGHTS, DEFAULT_PLATFORM_HEIGHT,
  edgeOffsets, platformEdgeElevation, platformLength,
} from './platformUtils'
import { platformsToOperationalPoints } from './alignmentCodec'

describe('the platform’s cross section', () => {
  it('states one edge distance for every height and cant — the tables come later', () => {
    expect(PLATFORM_FRONT_OFFSET).toBe(1.68)
    expect(PLATFORM_BACK_OFFSET - PLATFORM_FRONT_OFFSET).toBeCloseTo(PLATFORM_WIDTH, 9)
  })

  it('offers the standard heights over top of rail, and defaults to one of them', () => {
    expect(PLATFORM_HEIGHTS).toEqual([380, 550, 760])
    expect(PLATFORM_HEIGHTS).toContain(DEFAULT_PLATFORM_HEIGHT)
  })

  it('turns the edges to the side the platform lies on', () => {
    const right = edgeOffsets({ side: 'right', frontOffset: 1.68, backOffset: 4.68 })
    const left  = edgeOffsets({ side: 'left',  frontOffset: 1.68, backOffset: 4.68 })
    expect(right).toEqual({ front: 1.68, back: 4.68 })
    expect(left).toEqual({ front: -1.68, back: -4.68 })
  })

  it('moves the back edge with the front one — an override shifts the platform, it does not narrow it', () => {
    expect(edgeOffsets({ side: 'right', frontOffset: 2.5 })).toEqual({ front: 2.5, back: 2.5 + PLATFORM_WIDTH })
  })
})

const track = {
  epsg: 25832,
  heights: [{ station: 0, z: 100 }, { station: 200, z: 102 }],
}

describe('platformEdgeElevation', () => {
  it('puts the edge in the height system: the track’s gradient plus the height over top of rail', () => {
    expect(platformEdgeElevation({ height: 550 }, track, 0)).toBeCloseTo(100.55, 9)
    expect(platformEdgeElevation({ height: 550 }, track, 100)).toBeCloseTo(101.55, 9)
    expect(platformEdgeElevation({ height: 760 }, track, 200)).toBeCloseTo(102.76, 9)
  })

  it('locates nothing where the track has no heights or the platform no height', () => {
    expect(platformEdgeElevation({ height: 550 }, { epsg: 25832 }, 0)).toBe(null)
    expect(platformEdgeElevation({}, track, 0)).toBe(null)
  })

  it('follows the platform along the track, so a gradient shows as two different levels', () => {
    const platform = { height: 550, startStation: 0, endStation: 200 }
    const a = platformEdgeElevation(platform, track, platform.startStation)
    const b = platformEdgeElevation(platform, track, platform.endStation)
    expect(b - a).toBeCloseTo(2, 9)
    expect(platformLength(platform)).toBe(200)
  })
})

describe('the platform in an operational point', () => {
  const platforms = [{
    id: 'p1', trackId: 't1', startStation: 10, endStation: 210,
    side: 'right', frontOffset: 1.68, backOffset: 4.68, height: 550,
    stationName: 'Musterstadt', code: 'MST',
  }]
  const trackMap = { t1: { id: 't1', name: '1', owner: 'DB', uicStation: 8000001 } }

  it('carries the height and the extent the point itself cannot state', () => {
    const [op] = platformsToOperationalPoints(platforms, trackMap)
    expect(op.parts).toHaveLength(1)
    expect(op.parts[0].position).toBe(110)          // the point a train is dispatched against
    expect(op.parts[0].extensions.olt).toEqual({
      start_station_m: 10,
      end_station_m: 210,
      side: 'right',
      front_offset_m: 1.68,
      back_offset_m: 4.68,
      height_mm: 550,
    })
  })

  it('states no height for a platform that carries none, rather than inventing one', () => {
    const [op] = platformsToOperationalPoints([{ ...platforms[0], height: undefined }], trackMap)
    expect(op.parts[0].extensions.olt.height_mm).toBe(null)
  })

  it('leaves a platform whose track is gone out — it has no position', () => {
    expect(platformsToOperationalPoints(platforms, {})).toEqual([])
  })
})
