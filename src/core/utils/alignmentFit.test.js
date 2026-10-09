import { describe, it, expect } from 'vitest'
import {
  ALIGN_DEFAULTS, alignRequest, deleteStraight, elementReport, fittedCurvature, gradientReport, insertStraight,
  moveStraightEnd, parseAxisPointFile, straightRanges, surveyAxis, trackFromFit,
} from './alignmentFit'
import { axisPointsCsv } from './pointCloud/railTrace'
import { surveyFromTrace } from './axisSurvey'
import { expectValidTrack } from '../test/chainInvariants'
import { trackLength } from './heightUtils'
import fixture from '../test/fixtures/align_answer.json'

// The fit is the service's (olt_optimizer/alignment_fit.py); what is tested
// here is the app's half — the point file it reads, the request it sends, and
// the track, the diagram and the report it makes of the answer. The answer is
// a real one, written by tools/optimizer/tests/align_fixture.py.

const { answer, epsg } = fixture

const tracePoints = Array.from({ length: 12 }, (_, i) => ({
  station: 35.5 + i / 2, easting: 4467335.487 + i * 0.47, northing: 5333806.389 - i * 0.17,
  zLeft: 508.15, zRight: 508.149, cant: 0.001, gauge: 1.435, quality: i === 3 ? 'doubtful' : 'good',
}))

describe('the point file', () => {
  it('reads the export of stage A, the plane from its name', () => {
    const parsed = parseAxisPointFile(axisPointsCsv(tracePoints), 'Gleisachse_5550L_EPSG5684.csv')
    expect(parsed.epsg).toBe(5684)
    expect(parsed.points).toHaveLength(12)
    // The export writes a cant under its noise as 0; a stated one is read in mm.
    expect(parsed.points[0]).toEqual({ station: 35.5, easting: 4467335.487, northing: 5333806.389, z: 508.149, cant: 0 })
    const canted = parseAxisPointFile(axisPointsCsv(tracePoints.map(p => ({ ...p, cant: -0.045 }))), 'x_EPSG5684.csv')
    expect(canted.points[0].cant).toBe(-45)
    expect(parsed.points[11].station).toBeCloseTo(41, 6)
  })

  it('reads a decimal comma between semicolons, and Easting/Northing headers', () => {
    const rows = tracePoints.map(p => `${p.easting.toFixed(3).replace('.', ',')};${p.northing.toFixed(3).replace('.', ',')}`)
    const parsed = parseAxisPointFile(['Easting;Northing', ...rows].join('\n'), 'achse.csv')
    expect(parsed.epsg).toBeNull()
    expect(parsed.points[1].easting).toBeCloseTo(4467335.957, 6)
    expect(parsed.points[1].z).toBeUndefined()
    // Without a station column the points are stationed along themselves.
    expect(parsed.points[1].station).toBeCloseTo(Math.hypot(0.47, 0.17), 3)
  })

  it('reads a file without a header, a running number first', () => {
    const rows = tracePoints.map((p, i) => `${i + 1} ${p.easting} ${p.northing} 508.1`)
    const parsed = parseAxisPointFile(rows.join('\n'))
    expect(parsed.points).toHaveLength(12)
    expect(parsed.points[0].easting).toBe(4467335.487)
    expect(parsed.points[0].northing).toBe(5333806.389)
    expect(parsed.points[0].z).toBe(508.1)
  })

  it('reads the heights from a column named for them', () => {
    const rows = tracePoints.map(p => `${p.easting},${p.northing},${p.zLeft},x`)
    const parsed = parseAxisPointFile(['East,North,Height,Code', ...rows].join('\n'))
    expect(parsed.points[0].z).toBe(508.15)
  })

  it('says what is wrong with one it cannot read', () => {
    expect(parseAxisPointFile('', 'x.csv').error).toBe('align_file_empty')
    expect(parseAxisPointFile('Höhe;Güte\n1;2', 'x.csv').error).toBe('align_file_columns')
    expect(parseAxisPointFile('Rechtswert;Hochwert\n1;2\n3;4', 'x.csv').error).toBe('align_file_few_points')
  })

  it('takes a survey of the project as it stands', () => {
    const survey = surveyFromTrace({ id: 's', name: 'S', rail: '54E4', guide: { kind: 'line' }, step: 0.5 },
      { points: tracePoints, gaps: [], epsg: 5684 })
    const axis = surveyAxis(survey)
    expect(axis).toHaveLength(12)
    expect(axis[2].easting).toBeCloseTo(tracePoints[2].easting, 3)
    expect(Object.keys(axis[0]).sort()).toEqual(['cant', 'easting', 'northing', 'station', 'z'])
    expect(axis[0].cant).toBe(1)
    // The top of the lower rail, as the point file has it.
    expect(axis[0].z).toBeCloseTo(508.149, 3)
  })
})

describe('the request', () => {
  it('sends the points in travel order, the first station and the settings in metres', () => {
    const points = tracePoints.map(({ station, easting, northing }) => ({ station, easting, northing }))
    const body = alignRequest(points, { settings: ALIGN_DEFAULTS })
    expect(body.points[0]).toEqual([4467335.487, 5333806.389])
    expect(body.station0).toBe(35.5)
    expect(body.straights).toBeNull()
    expect(body.settings).toEqual({
      chord: 10, window: 6, step: 0.5, spacing: 6, minLength: 20, tolerance: 0.01, sagitta: 0.003, heightTolerance: 0.02,
    })
  })

  it('sends a height with the points that have one', () => {
    const body = alignRequest([{ station: 0, easting: 1, northing: 2, z: 3 }, { station: 1, easting: 4, northing: 5 }])
    expect(body.points).toEqual([[1, 2, 3], [4, 5]])
  })

  it('sends a cant after the height, a missing height as null', () => {
    const body = alignRequest([{ station: 0, easting: 1, northing: 2, z: 3, cant: -40 }, { station: 1, easting: 4, northing: 5, cant: 0 }])
    expect(body.points).toEqual([[1, 2, 3, -40], [4, 5, null, 0]])
  })

  it('sends straights set by hand as station ranges', () => {
    const body = alignRequest(tracePoints, { straights: straightRanges([{ from: 0, to: 80 }]) })
    expect(body.straights).toEqual([[0, 80]])
  })

  it('is what the fixture was answered for', () => {
    expect(fixture.request.station0).toBe(answer.stations[0])
  })
})

describe('the answer', () => {
  it('is a curve of R 400 left between two straights', () => {
    expect(answer.error).toBeUndefined()
    expect(answer.curves).toHaveLength(1)
    expect(answer.curves[0].radius).toBeCloseTo(-400, 0)
    expect(answer.elements.map(el => el.elementType)).toEqual([0, 2, 1, 2, 0])
  })

  it('becomes a new standing track in the plane of the points', () => {
    const track = trackFromFit(answer, { name: 'Achse Ist', epsg, newId: () => 'new' })
    expect(track).toMatchObject({ id: 'new', epsg: 5684, name: 'Achse Ist', status: 'existing' })
    expect(track.elements).toHaveLength(5)
    expect(track.elements.every(el => el.speed === 0 && el.geometry?.coordinates?.length >= 2)).toBe(true)
    expect(track.coordinates.length).toBeGreaterThan(5)
    expectValidTrack(track)
    const length = track.elements.reduce((s, el) => s + el.length, 0)
    expect(length).toBeCloseTo(answer.elementStations.at(-1) - answer.elementStations[0], 1)
  })

  it('takes the gradient over: rising, rounded with R 8000, falling', () => {
    const track = trackFromFit(answer, { name: 'Achse Ist', epsg, newId: () => 'new' })
    const { heights } = track
    expect(heights).toHaveLength(3)
    expect(heights[0].station).toBe(0)
    expect(heights.at(-1).station).toBeCloseTo(trackLength(track), 2)
    expect(heights[1].station).toBeCloseTo(140, 0)
    expect(heights[1].rv).toBeGreaterThan(7500)
    expect(heights[1].rv).toBeLessThan(8500)
    expect(heights[0].rv).toBeUndefined()
    const grades = gradientReport(answer).map(g => g.grade)
    expect(grades[0]).toBeCloseTo(3, 1)
    expect(grades[1]).toBeCloseTo(-2, 1)
    expect(answer.gradient.rms).toBeLessThan(0.003)
  })

  it('puts the cant on the straights and the arc, the transitions ramping between them', () => {
    const track = trackFromFit(answer, { name: 'Achse Ist', epsg, newId: () => 'new' })
    expect(track.elements.map(el => el.cant)).toEqual([0, undefined, -60, undefined, 0])
    expect(elementReport(answer, 0.01).map(r => r.cant)).toEqual([0, null, -60, null, 0])
  })

  it('makes a track without cant where the points had none', () => {
    const track = trackFromFit({ ...answer, elementCants: null }, { name: 'x', epsg })
    expect(track.elements.every(el => el.cant === undefined)).toBe(true)
  })

  it('ends a transition at an open end with the cant the points stop with', () => {
    const elementCants = [...answer.elementCants.slice(0, 3), { cant: null, measured: null, n: 0, cantEnd: -35 }]
    const cut = { ...answer, elements: answer.elements.slice(0, 4), elementCants }
    const track = trackFromFit(cut, { name: 'x', epsg })
    expect(track.elements[3].cantEnd).toBe(-35)
  })

  it('makes a track without a gradient where the points had no heights', () => {
    const track = trackFromFit({ ...answer, gradient: null }, { name: 'x', epsg })
    expect(track.heights).toBeUndefined()
  })

  it('makes no track of an answer without a chain', () => {
    expect(trackFromFit({ ...answer, elements: null }, { name: 'x', epsg })).toBeNull()
  })

  it('draws the fitted curvature element by element', () => {
    const k = fittedCurvature(answer)
    expect(k).toHaveLength(5)
    expect(k[0]).toMatchObject({ k1: 0, k2: 0 })
    expect(k[1].k1).toBe(0)
    expect(k[1].k2).toBeCloseTo(-1 / 400, 5)
    expect(k[2].k1).toBe(k[2].k2)
    expect(k[3].k2).toBe(0)
    expect(k[1].from).toBe(k[0].to)
  })

  it('reports every element against the tolerance', () => {
    const report = elementReport(answer, 0.01)
    expect(report).toHaveLength(5)
    expect(report.every(r => !r.over && r.n > 0 && r.max < 0.005)).toBe(true)
    expect(elementReport(answer, 0.001).some(r => r.over)).toBe(true)
  })
})

describe('straights by hand', () => {
  const s = [{ from: 0, to: 50 }, { from: 100, to: 150 }]

  it('moves an end, held off the other end and the neighbour', () => {
    expect(moveStraightEnd(s, 0, 'to', 60)[0]).toEqual({ from: 0, to: 60 })
    expect(moveStraightEnd(s, 0, 'to', 120)[0].to).toBe(99)
    expect(moveStraightEnd(s, 1, 'from', 160)[1].from).toBe(148)
    expect(moveStraightEnd(s, 1, 'from', 20)[1].from).toBe(51)
    expect(s[0].to).toBe(50)
  })

  it('inserts one in order, taking in what it overlaps', () => {
    expect(insertStraight(s, 80, 60)).toEqual([{ from: 0, to: 50 }, { from: 60, to: 80 }, { from: 100, to: 150 }])
    expect(insertStraight(s, 40, 110)).toEqual([{ from: 0, to: 150 }])
    expect(insertStraight(s, 60, 61)).toBeNull()
  })

  it('deletes one', () => {
    expect(deleteStraight(s, 0)).toEqual([{ from: 100, to: 150 }])
  })
})
