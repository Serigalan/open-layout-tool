import { describe, it, expect } from 'vitest'
import { arcElement, straightElement, endPointCurvedUtm, endPointStraightUtm } from '../geometry'
import { mergeChain } from './mergeElements'
import { rebuildCoords } from './trackModel'
import { expectValidTrack } from '../../test/chainInvariants'

const EPSG = 25832
const START = { easting: 500000, northing: 5600000, zone: EPSG }
const at = (node) => ({ easting: node[0], northing: node[1], zone: EPSG })

/** An arc of `length` on from `el` (or START on bearing 30), with `extra` fields. */
function arcAfter(el, length, radius, extra = {}) {
  const start = el ? at(el.endNode) : START
  const bearing = el ? (el.endBearing ?? el.bearing) : 30
  return { ...arcElement(start, endPointCurvedUtm(start, bearing, length, radius), radius), speed: 100, ...extra }
}

function straightAfter(el, length, extra = {}) {
  const start = el ? at(el.endNode) : START
  const bearing = el ? (el.endBearing ?? el.bearing) : 30
  return { ...straightElement(start, endPointStraightUtm(start, bearing, length)), speed: 100, ...extra }
}

const track = (elements) => ({ id: 't', name: 't', epsg: EPSG, elements, coordinates: rebuildCoords(elements) })

describe('mergeChain — alike elements (Entscheidung 378)', () => {
  it('merges two arcs of one radius and cant, taking speed and role from the first', () => {
    const a = arcAfter(null, 40, 800, { cant: 60, speed: 120, role: 'following' })
    const b = arcAfter(a, 30, 800.0004, { cant: 60, speed: 80, reasons: { x: 'y' } })
    const c = straightAfter(b, 20)
    const merged = mergeChain([a, b, c], EPSG, { equal: true })
    expect(merged.mergedFrom).toBe(2)
    expect(merged.elements).toHaveLength(2)
    const [m] = merged.elements
    expect(m.length).toBeCloseTo(70, 3)
    expect(m.radius).toBe(800)
    expect(m.speed).toBe(120)
    expect(m.role).toBe('following')
    expect(m.reasons).toBeUndefined()
    expect(m.endNode).toEqual(b.endNode)
    expectValidTrack(track(merged.elements))
  })

  it('merges straights in a row, whatever their speeds', () => {
    const a = straightAfter(null, 10, { speed: 60 })
    const b = straightAfter(a, 15, { speed: 100 })
    const c = straightAfter(b, 5)
    const merged = mergeChain([a, b, c], EPSG, { equal: true })
    expect(merged.elements).toHaveLength(1)
    expect(merged.elements[0].length).toBeCloseTo(30, 6)
    expect(merged.elements[0].speed).toBe(60)
  })

  it('keeps arcs apart whose cant or radius differs, or that meet with a kink', () => {
    const a = arcAfter(null, 40, 800, { cant: 60 })
    expect(mergeChain([a, arcAfter(a, 30, 800, { cant: 50 })], EPSG, { equal: true }).mergedFrom).toBe(0)
    expect(mergeChain([a, arcAfter(a, 30, 800.01, { cant: 60 })], EPSG, { equal: true }).mergedFrom).toBe(0)
    expect(mergeChain([a, arcAfter(a, 30, -800, { cant: 60 })], EPSG, { equal: true }).mergedFrom).toBe(0)
    const kinked = { ...arcAfter(a, 30, 800, { cant: 60 }) }
    const turned = arcElement(at(a.endNode), endPointCurvedUtm(at(a.endNode), a.endBearing + 0.5, 30, 800), 800)
    expect(mergeChain([a, { ...kinked, ...turned, cant: 60, speed: 100 }], EPSG, { equal: true }).mergedFrom).toBe(0)
  })

  it('keeps an arc with a cant ramp of its own apart', () => {
    const a = arcAfter(null, 40, 800, { cant: 60 })
    const b = arcAfter(a, 30, 800, { cantStart: 60, cantEnd: 40 })
    expect(mergeChain([a, b], EPSG, { equal: true }).mergedFrom).toBe(0)
  })

  it('never merges a switch’s own element', () => {
    const a = straightAfter(null, 10)
    const b = straightAfter(a, 15, { switchBranch: true, switchId: 'w' })
    expect(mergeChain([a, b], EPSG, { equal: true }).mergedFrom).toBe(0)
  })

  it('without `equal` still asks for every field alike', () => {
    const a = straightAfter(null, 10, { speed: 60 })
    const b = straightAfter(a, 15, { speed: 100 })
    expect(mergeChain([a, b], EPSG).mergedFrom).toBe(0)
  })
})
