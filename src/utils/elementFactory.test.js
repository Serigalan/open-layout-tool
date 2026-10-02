import { describe, it, expect } from 'vitest'
import { arcElement, arcFrom, straightElement, straightFrom, transitionElement } from './elementFactory'
import { reconstructElements } from './elementReconstruct'
import { expectValidTrack } from '../test/chainInvariants'
import { recalcAbsLengths } from './trackModel'

const EPSG = 25832
const A = { easting: 500000, northing: 5600000, zone: EPSG }
const B = { easting: 500300, northing: 5600400, zone: EPSG }

describe('the element factory (R4.1)', () => {
  it('makes a straight with the plane data and the geometry a reload would give it', () => {
    const el = straightElement(A, B, { speed: 100 })
    expect(el).toMatchObject({ elementType: 0, length: 500, speed: 100, startNode: [500000, 5600000], endNode: [500300, 5600400] })
    const again = reconstructElements([el], EPSG)[0]
    expect(again.geometry.coordinates).toEqual(el.geometry.coordinates)
  })

  it('makes an arc whose fine and coarse polylines are a reload\'s', () => {
    const el = arcElement(A, B, 1000)
    const again = reconstructElements([el], EPSG)[0]
    expect(again.geometry.coordinates).toEqual(el.geometry.coordinates)
    expect(again.renderCoords).toEqual(el.renderCoords)
    expect(el.radius).toBe(1000)
  })

  it('chains from a start, a bearing and a length', () => {
    const s = straightFrom(A, 90, 200)
    const end = { easting: s.endNode[0], northing: s.endNode[1], zone: EPSG }
    const t = transitionElement(end, 90, 60, null, 800)
    const a = arcFrom(t.endUtm, t.endBearing, 150, 800)
    const track = { id: 't', epsg: EPSG, elements: recalcAbsLengths([s, t.element, a].map(e => ({ ...e, speed: 80 }))) }
    expectValidTrack(track)
  })

  it('ends a transition on a point given for it', () => {
    const fixed = { easting: 500100.0004, northing: 5600000.0002, zone: EPSG }
    const { element, endUtm } = transitionElement(A, 90, 100, null, null, { endUtm: fixed })
    expect(element.endNode).toEqual([fixed.easting, fixed.northing])
    expect(endUtm).toEqual(fixed)
  })
})
