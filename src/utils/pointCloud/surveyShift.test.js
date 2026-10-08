import { describe, it, expect } from 'vitest'
import { surveyFromTrace, surveyPoints } from '../axisSurvey'
import { cloudToPlane } from './cloudCrs'
import { transformMatrix } from './registration'
import { cloudRefsOf, surveyChanges, shiftSurvey } from './surveyShift'

const C = [4467335, 5333806, 508]
const T1 = { id: 1, matrix: transformMatrix({ tE: 0.1, tN: 0.2, tH: 0.03, kappa: 0.0005 }, C), crs: 5678 }
const T2 = { id: 2, matrix: transformMatrix({ tE: -0.2, tN: 0.05, tH: -0.02, kappa: -0.0003 }, C), crs: 5678 }
/** Axis points in the cloud's file: a straight line east-south-east. */
const FILE = Array.from({ length: 20 }, (_, i) => [C[0] + i * 0.47, C[1] - i * 0.17, C[2] + i * 0.001])

/** The survey a trace through `transform` would have found, in plane `epsg`. */
function traced(transform, epsg) {
  const read = cloudToPlane({ crs: 5678, transform }, epsg)
  const points = FILE.map((f, i) => {
    const [e, n, z] = read ? read(...f) : f
    return { station: i * 0.5, easting: e, northing: n, zLeft: z + 0.004, zRight: z, gauge: 1.433, quality: 'good' }
  })
  const clouds = [{ id: 'c1', crs: 5678, server: { level: 1 }, transform }, { id: 'local', crs: 5678 }]
  return surveyFromTrace({ id: 's', name: 'S', rail: '54E4', guide: { kind: 'line' }, cloudRefs: cloudRefsOf(clouds), step: 0.5 },
    { points, gaps: [], epsg })
}

describe('measured axes after a re-referencing (AP 13.15)', () => {
  it('remembers the server clouds a trace read, with their transformation', () => {
    expect(traced(T1, 5678).cloudRefs).toEqual([{ id: 'c1', crs: 5678, transform: { id: 1, matrix: T1.matrix, crs: 5678 } }])
  })

  it('is marked when a cloud is read through another transformation since — not when it is the same', () => {
    const s = traced(T1, 5678)
    expect(surveyChanges(s, [{ id: 'c1', name: 'W', crs: 5678, transform: T1 }])).toEqual([])
    expect(surveyChanges(s, [{ id: 'c1', name: 'W', crs: 5678, transform: T2 }])).toMatchObject([{ id: 'c1', name: 'W', old: { id: 1 }, now: { id: 2 } }])
    expect(surveyChanges(s, [{ id: 'c1', name: 'W', crs: 5678, transform: null }])).toMatchObject([{ now: null }])
    expect(surveyChanges(s, [])).toEqual([])
  })

  it.each([[5678, T2], [5678, null], [25832, T2]])('carried along lands where a trace through the new one would (plane %i)', (epsg, now) => {
    const s = traced(T1, epsg)
    const [change] = surveyChanges(s, [{ id: 'c1', name: 'W', crs: 5678, transform: now }])
    const shifted = shiftSurvey(s, change)
    const want = surveyPoints(traced(now, epsg))
    surveyPoints(shifted).forEach((p, i) => {
      expect(Math.abs(p.easting - want[i].easting)).toBeLessThan(0.0015)
      expect(Math.abs(p.northing - want[i].northing)).toBeLessThan(0.0015)
      expect(Math.abs(p.zLeft - want[i].zLeft)).toBeLessThan(0.0015)
    })
    expect(surveyChanges(shifted, [{ id: 'c1', name: 'W', crs: 5678, transform: now }])).toEqual([])
  })
})
