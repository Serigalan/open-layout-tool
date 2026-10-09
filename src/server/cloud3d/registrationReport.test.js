import { describe, it, expect } from 'vitest'
import { protocolCsv, parameterRows, pairRows } from './registrationReport'
import { solveRegistration, transformMatrix, applyMatrix, invertMatrix } from '../../core/utils/pointCloud/registration'

const T = transformMatrix({ tE: 0.3, tN: -0.1, tH: 0.05, kappa: 0.0008 }, [1000, 2000, 100])
const pairs = [[1000, 2000, 100], [1100, 2050, 101], [1180, 1960, 99], [1050, 1900, 102.5]].map((ref, k) => ({
  id: `P${k + 1}`, label: k === 0 ? 'Mast 12' : '', kind: '3d', ref, src: applyMatrix(invertMatrix(T), ref).map((v, i) => v + (i === k % 3 ? 0.002 : 0)),
}))
pairs.push({ id: 'P5', label: '', kind: '3d', on: false, ref: [1000, 2100, 100], src: [1000, 2100, 100] })
const solution = solveRegistration(pairs)
const names = { tE: 'Ost', tN: 'Nord', tH: 'Höhe', kappa: 'Drehung' }

describe('the protocol of a re-referencing (AP 13.14)', () => {
  it('lists the parameters in m and mrad with their standard deviations', () => {
    const rows = parameterRows(solution, names)
    expect(rows.map(r => r[0])).toEqual(['Ost', 'Nord', 'Höhe', 'Drehung'])
    expect(rows[3][3]).toBe('mrad')
    expect(Number(rows[3][1])).toBeCloseTo(0.8, 1)
    expect(Number(rows[0][2])).toBeGreaterThan(0)
  })

  it('lists every pair, the switched-off one without residuals', () => {
    const rows = pairRows(pairs, solution)
    expect(rows).toHaveLength(5)
    expect(rows[0].slice(0, 4)).toEqual(['1', 'Mast 12', '3D', 'an'])
    expect(rows[4][3]).toBe('aus')
    expect(rows[4][10]).toBe('')
  })

  it('as CSV: header, parameters, accuracy, matrix and the pairs', () => {
    const csv = protocolCsv({ solution, pairs, names, project: 'P', cloud: 'W', reference: 'B', crs: 5678, heightName: 'DHHN2016', person: 'Ada', date: '08.10.2026', options: {} })
    expect(csv).toContain('# Angepasste Wolke: W')
    expect(csv).toContain('Drehung;')
    expect(csv).toMatch(/Matrix \(zeilenweise\);(-?[\d.e+-]+;){15}/)
    expect(csv.trim().split('\r\n').at(-1).startsWith('5;P5;3D;aus')).toBe(true)
  })
})
