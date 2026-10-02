import { describe, it, expect } from 'vitest'
import { carveSwitchRoute, splitElementAt, splitTrackAtJoint } from './trackSplitUtils'
import { arcFrom, straightFrom, transitionElement } from './elementFactory'
import { recalcAbsLengths, rebuildCoords } from './trackModel'
import { expectValidTrack } from '../test/chainInvariants'

const EPSG = 25832
const O = { easting: 500000, northing: 5700000, zone: EPSG }
const at = (node) => ({ easting: node[0], northing: node[1], zone: EPSG })
const lengths = (track) => track.elements.map(e => Math.round(e.length * 1000) / 1000)

function makeTrack(elements, extra = {}) {
  const els = recalcAbsLengths(elements.map(e => ({ ...e, speed: 80 })))
  return { id: 'src', name: '6340.001', epsg: EPSG, lineNumber: '6340', elements: els, coordinates: rebuildCoords(els), ...extra }
}

// 100 m straight due east, then 100 m of arc R 500 to the right.
function straightAndArc(extra) {
  const s = straightFrom(O, 90, 100)
  const a = arcFrom(at(s.endNode), 90, 100, 500)
  return makeTrack([s, a], extra)
}

// 100 m straight, a 60 m clothoid into R 500, 50 m of that arc with 60 mm cant.
function withTransition() {
  const s = straightFrom(O, 90, 100)
  const t = transitionElement(at(s.endNode), 90, 60, null, 500)
  const a = arcFrom(t.endUtm, t.endBearing, 50, 500, { cant: 60 })
  return makeTrack([s, t.element, a])
}

describe('splitting a track inside an element', () => {
  it('cuts a straight in two, both halves valid, the rest on their side', () => {
    const track = straightAndArc({ heights: [{ station: 0, z: 100 }, { station: 200, z: 120 }] })
    const names = new Set(['6340.001'])
    const r = splitElementAt(track, 0, { easting: O.easting + 40, northing: O.northing }, 90, names)
    const [a, b] = r.tracks
    expect(lengths(a)).toEqual([40])
    expect(lengths(b)).toEqual([60, 100])
    a.elements.concat(b.elements).forEach(e => expect(e.speed).toBe(80))
    expectValidTrack(a)
    expectValidTrack(b)
    // Metadata stays, ids and names are new and taken.
    expect(a).toMatchObject({ lineNumber: '6340', epsg: EPSG })
    expect(a.id).not.toBe('src')
    expect(a.id).not.toBe(b.id)
    expect(names.has(a.name) && names.has(b.name)).toBe(true)
    // The heights part at the cut and meet at the interpolated height.
    expect(a.heights.at(-1)).toEqual({ station: 40, z: 104 })
    expect(b.heights[0]).toEqual({ station: 0, z: 104 })
    expect(r.junctionWgs).toEqual(b.elements[0].geometry.coordinates[0])
  })

  it('says which half lies ahead of the junction for the bearing given', () => {
    const track = straightAndArc()
    const cut = { easting: O.easting + 40, northing: O.northing }
    const east = splitElementAt(track, 0, cut, 90, new Set())
    expect(east.ahead).toBe(east.tracks[1])
    expect([east.aheadEndpoint, east.behindEndpoint]).toEqual(['BEGIN', 'END'])
    const west = splitElementAt(track, 0, cut, 270, new Set())
    expect(west.ahead).toBe(west.tracks[0])
    expect([west.aheadEndpoint, west.behindEndpoint]).toEqual(['END', 'BEGIN'])
  })

  it('cuts an arc into two arcs of its own radius', () => {
    const track = straightAndArc()
    const p = arcFrom(at(track.elements[0].endNode), 90, 30, 500).endNode
    const { tracks: [a, b] } = splitElementAt(track, 1, at(p), 90, new Set())
    expect(lengths(a)).toEqual([100, 30])
    expect(lengths(b)).toEqual([70])
    expect(a.elements[1].radius).toBe(500)
    expect(b.elements[0].radius).toBe(500)
    expectValidTrack(a)
    expectValidTrack(b)
  })

  it('cuts a clothoid at a station, each piece keeping its part of the cant ramp', () => {
    const track = withTransition()
    // On a clothoid from a straight the curvature runs with the station:
    // at 20 of 60 m into R 500 the radius is 1500.
    const p = transitionElement(at(track.elements[0].endNode), 90, 20, null, 1500).endUtm
    const { tracks: [a, b] } = splitElementAt(track, 1, { ...p, station: 20 }, 90, new Set())
    expect(lengths(a)).toEqual([100, 20])
    expect(lengths(b)).toEqual([40, 50])
    expect(a.elements[1]).toMatchObject({ elementType: 2, cantStart: 0, cantEnd: 20 })
    expect(b.elements[0]).toMatchObject({ elementType: 2, cantStart: 20, cantEnd: 60 })
    expect(a.elements[1].r2).toBeCloseTo(1500, 6)
    expect(b.elements[0].r1).toBeCloseTo(1500, 6)
  })
})

describe('splitting a track at a joint', () => {
  it('parts the elements without cutting one, the transition keeping its ramp', () => {
    const track = withTransition()
    const r = splitTrackAtJoint(track, 2, 90, new Set())
    const [a, b] = r.tracks
    expect(lengths(a)).toEqual([100, 60])
    expect(lengths(b)).toEqual([50])
    expect(a.elements[1]).toMatchObject({ cantStart: 0, cantEnd: 60 })
    expect(r.ahead).toBe(b)
    expect(r.junctionWgs).toEqual(b.elements[0].geometry.coordinates[0])
    expectValidTrack(a)
    expectValidTrack(b)
  })
})

describe('carving a switch route', () => {
  const mark = { switchBranch: 'main', switchName: 'W 1' }

  it('cuts the terminal element where the route ends, without a route length', () => {
    const track = straightAndArc()
    const out = carveSwitchRoute(track, 'BEGIN', { easting: O.easting + 30, northing: O.northing }, mark)
    expect(lengths(out)).toEqual([30, 70, 100])
    expect(out.elements[0]).toMatchObject(mark)
    expect(out.elements[1].switchName).toBeUndefined()
    expectValidTrack(out)
  })

  it('reaches over several elements with a route length', () => {
    const track = straightAndArc()
    const cut = at(arcFrom(at(track.elements[0].endNode), 90, 30, 500).endNode)
    const out = carveSwitchRoute(track, 'BEGIN', cut, mark, 130)
    expect(lengths(out)).toEqual([100, 30, 70])
    expect(out.elements.map(e => e.switchName ?? null)).toEqual(['W 1', 'W 1', null])
    expectValidTrack(out)
  })

  it('takes a whole element as it is when the route fills it', () => {
    const track = straightAndArc()
    const out = carveSwitchRoute(track, 'BEGIN', at(track.elements[0].endNode), mark, 100)
    expect(lengths(out)).toEqual([100, 100])
    expect(out.elements[0]).toMatchObject(mark)
  })

  it('carves from the END too', () => {
    const track = straightAndArc()
    const cut = at(arcFrom(at(track.elements[0].endNode), 90, 70, 500).endNode)
    const out = carveSwitchRoute(track, 'END', cut, mark, 30)
    expect(lengths(out)).toEqual([100, 70, 30])
    expect(out.elements[2]).toMatchObject(mark)
  })

  it('refuses what it cannot carve', () => {
    const track = straightAndArc()
    const cut = { easting: O.easting + 30, northing: O.northing }
    expect(carveSwitchRoute(track, 'BEGIN', cut, mark, 500)).toBe(null)                  // track ends first
    expect(carveSwitchRoute(track, 'BEGIN', cut, mark, 130, { accepts: e => e.elementType === 0 })).toBe(null)
    const bloss = transitionElement(O, 90, 60, null, 500, { transitionType: 'bloss' }).element
    expect(carveSwitchRoute(makeTrack([bloss]), 'BEGIN', cut, mark, 30)).toBe(null)
    const clothoid = transitionElement(O, 90, 60, null, 500).element
    expect(carveSwitchRoute(makeTrack([clothoid]), 'BEGIN', cut, mark)).toBe(null)       // terminal transition
  })
})
