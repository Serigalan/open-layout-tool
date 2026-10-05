import { describe, it, expect } from 'vitest'
import { surveyFromTrace, surveyPoints, surveyStats, surveyDefect } from './axisSurvey'
import { validateProject } from './validateProject'
import { mergeProject } from './merge'
import { describeStep } from './stepLabel'

const trace = {
  epsg: 5684,
  gaps: [{ from: 1, to: 1 }],
  points: [
    { station: 0, easting: 4467335.4870, northing: 5333806.3894, zLeft: 508.142, zRight: 508.149, gauge: 1.4312, quality: 'good' },
    { station: 0.5, easting: 4467335.9582, northing: 5333806.2215, zLeft: 508.151, zRight: 508.151, gauge: 1.4296, quality: 'doubtful' },
    { station: 1.5, easting: 4467336.9006, northing: 5333805.8857, zLeft: 508.1534, zRight: 508.149, gauge: 1.43, quality: 'good' },
  ],
}
const meta = { id: 's1', name: '5550L', rail: '54E4', guide: { kind: 'track', trackId: 't1' }, cloudNames: ['a.laz'], createdAt: '2026-10-05T10:00:00Z', step: 0.5 }

describe('a measured axis in the record', () => {
  it('keeps the points to the millimetre, packed', () => {
    const survey = surveyFromTrace(meta, trace)
    expect(survey).toMatchObject({ id: 's1', name: '5550L', epsg: 5684, rail: '54E4', gaps: [{ from: 1, to: 1 }] })
    expect(survey.points.de.every(Number.isInteger)).toBe(true)
    const back = surveyPoints(survey)
    expect(back).toHaveLength(3)
    back.forEach((p, i) => {
      const q = trace.points[i]
      expect(p.station).toBeCloseTo(q.station, 3)
      expect(Math.abs(p.easting - q.easting)).toBeLessThan(0.0006)
      expect(Math.abs(p.northing - q.northing)).toBeLessThan(0.0006)
      expect(Math.abs(p.zLeft - q.zLeft)).toBeLessThan(0.0006)
      expect(p.quality).toBe(q.quality)
    })
    expect(back[2].cant).toBeCloseTo(0.004, 6)
    expect(back[0].gauge).toBeCloseTo(1.431, 6)
  })

  it('takes some 40 bytes of JSON a point', () => {
    const points = Array.from({ length: 2000 }, (_, i) => ({
      station: i / 2, easting: 4467335 + i * 0.47, northing: 5333806 - i * 0.17,
      zLeft: 508.1 + i * 0.0002, zRight: 508.1 + i * 0.0002, gauge: 1.433, quality: 'good',
    }))
    const bytes = JSON.stringify(surveyFromTrace(meta, { epsg: 5684, gaps: [], points })).length
    expect(bytes / 2000).toBeLessThan(45)
  })

  it('says how many points and what stretch', () => {
    expect(surveyStats(surveyFromTrace(meta, trace))).toEqual({ points: 3, good: 2, from: 0, to: 1.5 })
    expect(surveyStats({})).toEqual({ points: 0, good: 0, from: 0, to: 0 })
  })

  it('is an error in the record where it does not hold together', () => {
    const survey = surveyFromTrace(meta, trace)
    expect(surveyDefect(survey)).toBeNull()
    const broken = { ...survey, points: { ...survey.points, zr: [0] } }
    expect(surveyDefect(broken)).toBe('zr')
    const { errors } = validateProject({ tracks: [], axisSurveys: [survey, broken] })
    expect(errors.map(e => e.code)).toEqual(['axis_survey_malformed'])
  })

  it('merges as one object: both sides keep what they added, an edit of both is a conflict', () => {
    const a = surveyFromTrace(meta, trace)
    const b = surveyFromTrace({ ...meta, id: 's2', name: 'Linie' }, trace)
    const base = { id: 'p', tracks: [], axisSurveys: [a] }
    const { merged, conflicts } = mergeProject({
      base, mine: { ...base, axisSurveys: [a, b] }, theirs: { ...base, axisSurveys: [{ ...a, name: '5550L neu' }] },
    })
    expect(conflicts).toEqual([])
    expect(merged.axisSurveys.map(s => s.name).sort()).toEqual(['5550L neu', 'Linie'])
    const both = mergeProject({
      base, mine: { ...base, axisSurveys: [{ ...a, name: 'x' }] }, theirs: { ...base, axisSurveys: [{ ...a, name: 'y' }] },
    })
    expect(both.conflicts).toHaveLength(1)
    expect(both.conflicts[0].id).toBe('axisSurveys:s1:*')
  })

  it('names the undo step', () => {
    const a = surveyFromTrace(meta, trace)
    expect(describeStep({ axisSurveys: [] }, { axisSurveys: [a] })).toEqual({ key: 'step_axis_survey_added', params: { name: '5550L' } })
    expect(describeStep({ axisSurveys: [a] }, { axisSurveys: [] })).toEqual({ key: 'step_axis_survey_removed', params: { name: '5550L' } })
  })
})
