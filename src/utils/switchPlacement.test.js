import { describe, it, expect } from 'vitest'
import { clickStation, placeSwitchOnTrack, switchEndAnchorRefusal } from './switchPlacement'
import { arcFrom, straightFrom, transitionElement } from './elementFactory'
import { recalcAbsLengths } from './trackModel'

const EPSG = 25832
const O = { easting: 500000, northing: 5700000, zone: EPSG }
const at = (node) => ({ easting: node[0], northing: node[1], zone: EPSG })
const track = (elements) => ({ id: 't', epsg: EPSG, elements: recalcAbsLengths(elements) })

// 100 m straight due east, 100 m of arc R 500 to the right with 40 mm cant.
function straightAndArc() {
  const s = straightFrom(O, 90, 100)
  return track([s, arcFrom(at(s.endNode), 90, 100, 500, { cant: 40 })])
}

describe('the station a click states', () => {
  it('projects the click onto the element and adds the elements before it', () => {
    const t = straightAndArc()
    expect(clickStation(t, 0, { easting: O.easting + 37, northing: O.northing + 3 })).toBeCloseTo(37, 6)
    const onArc = arcFrom(at(t.elements[0].endNode), 90, 25, 500).endNode
    expect(clickStation(t, 1, at(onArc))).toBeCloseTo(125, 4)
  })

  it('holds a click past either end to the element', () => {
    const t = straightAndArc()
    expect(clickStation(t, 0, { easting: O.easting - 20, northing: O.northing })).toBe(0)
    expect(clickStation(t, 0, { easting: O.easting + 180, northing: O.northing })).toBe(100)
  })
})

describe('placing a turnout on a track', () => {
  it('lays it inside one element, opening with the track', () => {
    const p = placeSwitchOnTrack(straightAndArc(), 20, false, 30)
    expect(p.error).toBeUndefined()
    expect(p).toMatchObject({ joint: null, elIdx: 0, cutsClothoid: false })
    expect(p.s).toBeCloseTo(20, 9)
    expect(p.bearing).toBeCloseTo(90, 9)
    expect(p.toeUtm.easting).toBeCloseTo(O.easting + 20, 6)
    expect(p.endUtm.easting).toBeCloseTo(O.easting + 50, 6)
    expect(p.spans).toHaveLength(1)
    expect(p.spans[0]).toMatchObject({ elIdx: 0, s0: 0, cantStart: 0, cantEnd: 0 })
    expect(p.spans[0].length).toBeCloseTo(30, 9)
  })

  it('reaches over a joint, a piece per element, with each one\'s cant', () => {
    const p = placeSwitchOnTrack(straightAndArc(), 80, false, 50)
    expect(p.spans.map(sp => sp.elIdx)).toEqual([0, 1])
    expect(p.spans[0].length).toBeCloseTo(20, 9)
    expect(p.spans[1].length).toBeCloseTo(30, 9)
    expect(p.pieces).toHaveLength(2)
    expect(p.cantAt(10)).toBe(0)
    expect(p.cantAt(40)).toBe(40)
    expect(p.cantAt(20, 1)).toBe(40)                // the joint, on the arc's span
  })

  it('opens against the track when reversed, the cant turned with it', () => {
    const p = placeSwitchOnTrack(straightAndArc(), 180, true, 50)
    expect(p.bearing).toBeGreaterThan(180)          // running back west
    expect(p.spans.map(sp => sp.elIdx)).toEqual([1])
    expect(p.spans[0].cantStart).toBe(-40)
  })

  it('takes a toe on a joint as the joint', () => {
    const p = placeSwitchOnTrack(straightAndArc(), 100, false, 30)
    expect(p).toMatchObject({ joint: 1, elIdx: null, s: null })
    expect(p.spans[0].elIdx).toBe(1)
    const back = placeSwitchOnTrack(straightAndArc(), 100, true, 30)
    expect(back.joint).toBe(1)
    expect(back.spans[0].elIdx).toBe(0)
  })

  it('cuts a clothoid where the toe falls into one', () => {
    const s = straightFrom(O, 90, 100)
    const t = transitionElement(at(s.endNode), 90, 60, null, 500)
    const p = placeSwitchOnTrack(track([s, t.element]), 120, false, 20)
    expect(p).toMatchObject({ elIdx: 1, cutsClothoid: true })
  })

  it('refuses what a turnout cannot lie on', () => {
    const t = straightAndArc()
    expect(placeSwitchOnTrack(track([]), 0, false, 30).error).toBe('switch_on_track_outside')
    expect(placeSwitchOnTrack(t, 500, false, 30).error).toBe('switch_on_track_no_room')   // held to the end
    expect(placeSwitchOnTrack(t, 180, false, 30).error).toBe('switch_on_track_no_room')

    const s = straightFrom(O, 90, 100)
    const bloss = transitionElement(at(s.endNode), 90, 60, null, 500, { transitionType: 'bloss' }).element
    expect(placeSwitchOnTrack(track([s, bloss]), 90, false, 30).error).toBe('switch_on_track_bloss')

    const marked = track([{ ...s, switchBranch: 'main' }])
    expect(placeSwitchOnTrack(marked, 20, false, 30).error).toBe('switch_on_track_over_switch')

    const kinked = track([{ ...s, endBearing: 95 }])
    expect(placeSwitchOnTrack(kinked, 20, false, 30).error).toBe('switch_on_track_kink')

    // Two straights meeting at an angle: the joint under the turnout is a kink.
    const bent = track([s, straightFrom(at(s.endNode), 100, 100)])
    expect(placeSwitchOnTrack(bent, 90, false, 30).error).toBe('switch_on_track_kink')
  })
})

describe('anchoring a turnout at a track end', () => {
  it('allows only the last element', () => {
    const t = straightAndArc()
    expect(switchEndAnchorRefusal(t, 1)).toBe(null)
    expect(switchEndAnchorRefusal(t, 0)).toBe('switch_anchor_not_track_end')
    expect(switchEndAnchorRefusal(t, 5)).toBe('switch_anchor_no_element')
    expect(switchEndAnchorRefusal(null, 0)).toBe('switch_anchor_no_element')
  })
})
