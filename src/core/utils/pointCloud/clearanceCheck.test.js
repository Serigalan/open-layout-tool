import { describe, it, expect } from 'vitest'
import { checkClearance, INSIDE, ALLOWED } from './clearanceCheck'
import { gaugeProfile, gaugeProfileRing, gaugeProfileAreas } from '../gaugeProfiles'
import { crossSection } from '../crossSectionUtils'

const profile = gaugeProfile('hauptgleis')
const ring = gaugeProfileRing(profile.points)
const areas = gaugeProfileAreas(profile.einragungen)

/** Points given in the drawing's frame [mm over the top of rail] as a slice has them [m, absolute]. */
const slice = (zTrack, rows) => ({
  count: rows.length,
  y: Float32Array.from(rows.map(([y]) => y / 1000)),
  z: Float64Array.from(rows.map(([, z]) => zTrack + z / 1000)),
})

describe('checkClearance', () => {
  it('finds the points inside the outline and the nearest one outside', () => {
    const pts = slice(531.5, [
      [0, 2000],        // inside, 2.5 m from the side
      [2600, 1000],     // outside, 100 mm beside it
      [1650, 500],      // inside, between track and platform area
      [2000, 500],      // in the platform area — allowed
      [700, 20],        // rail head height — not checked
      [9000, 1000],     // far away — not measured
    ])
    const r = checkClearance(pts, { zTrack: 531.5, cant: 0, ring, areas })
    expect(Array.from(r.flags)).toEqual([INSIDE, 0, INSIDE, ALLOWED, 0, 0])
    expect(r.inside).toBe(2)
    expect(r.deepest.index).toBe(0)
    expect(r.deepest.distance).toBeCloseTo(2500, 0)
    expect(r.nearest.index).toBe(1)
    expect(r.nearest.distance).toBeCloseTo(100, 3)
  })

  it('turns the points with the cant, as the outline is turned in the drawing', () => {
    const cant = 150
    // Two points stated in the track's own frame either side of the slanted
    // top corner, carried into the drawing by the same rotation crossSection
    // gives the outline.
    const own = [[1900, 4000], [2300, 4000]]
    const drawn = crossSection({ cant, gaugeRing: own }).gauge
    const pts = slice(100, drawn)
    const r = checkClearance(pts, { zTrack: 100, cant, ring, areas })
    expect(Array.from(r.flags)).toEqual([INSIDE, 0])
    // 128.6 mm beside the slanted edge, across it 121.5 mm.
    expect(r.nearest.distance).toBeCloseTo(121.5, 0)
    // Without the cant the right one would read as inside: the outline leans.
    const flat = checkClearance(pts, { zTrack: 100, cant: 0, ring, areas })
    expect(flat.nearest?.index).not.toBe(1)
  })

  it('reports nothing for an empty slice', () => {
    const r = checkClearance(slice(0, []), { zTrack: 0, ring, areas })
    expect(r).toMatchObject({ inside: 0, deepest: null, nearest: null })
  })
})

describe('stretchesOf', () => {
  it('joins neighbouring steps with intrusions into one stretch', async () => {
    const { stretchesOf } = await import('./clearanceScan')
    const hits = [
      { station: 10.25, inside: 3, depth: 40 },
      { station: 10.75, inside: 5, depth: 120 },
      { station: 11.25, inside: 1, depth: 10 },
      { station: 20.25, inside: 2, depth: 30 },
    ]
    expect(stretchesOf(hits, 0.5)).toEqual([
      { from: 10.25, to: 11.25, inside: 9, depth: 120, deepestAt: 10.75 },
      { from: 20.25, to: 20.25, inside: 2, depth: 30, deepestAt: 20.25 },
    ])
  })
})
