import { describe, it, expect } from 'vitest'
import { readLasHeader, readFirstPoints } from './lasReader'
import { pointsAsText, decimalsOf } from './lasText'
import { hasLaz, LAZ_PATH, nodeFileSource, nodeLazPerf, bytesSource, makeLas } from '../../test/pointCloudFixture'

describe('decimalsOf — what the scale resolves', () => {
  it('counts the decimals of a power of ten', () => {
    expect([1, 0.1, 0.01, 0.001, 0.0001].map(decimalsOf)).toEqual([0, 1, 2, 3, 4])
    expect(decimalsOf(0.0025)).toBe(3)
    expect(decimalsOf(0)).toBe(3)
  })
})

describe('readFirstPoints and pointsAsText', () => {
  it('reads only the points asked for and prints one per line', async () => {
    const pts = Array.from({ length: 60000 }, (_, i) => ({ x: 4470000 + i * 0.001, y: 5332000.5, z: 530.25, intensity: i }))
    const source = bytesSource(makeLas(pts, { offset: [4470000, 5332000, 500] }))
    const header = await readLasHeader(source)
    const points = await readFirstPoints(source, header, 200)
    expect(points).toHaveLength(200)
    const text = pointsAsText(header, points, { name: 'probe.las' })
    const lines = text.split('\n')
    expect(lines[0]).toBe('# probe.las')
    const columns = lines.indexOf('X\tY\tZ\tintensity')
    expect(columns).toBeGreaterThan(0)
    expect(lines.slice(columns + 1)).toHaveLength(200)
    expect(lines[columns + 1]).toBe('4470000.000\t5332000.500\t530.250\t0')
    expect(lines[columns + 200]).toBe('4470000.199\t5332000.500\t530.250\t199')
  })

  it('takes what there is when the file holds fewer points', async () => {
    const source = bytesSource(makeLas([{ x: 1, y: 2, z: 3 }]))
    const header = await readLasHeader(source)
    expect(await readFirstPoints(source, header, 200)).toHaveLength(1)
  })

  it('labels the header in the language asked for', async () => {
    const source = bytesSource(makeLas([{ x: 1, y: 2, z: 3 }]))
    const header = await readLasHeader(source)
    const text = pointsAsText(header, await readFirstPoints(source, header, 5), {
      labels: { first: 'die ersten {n} Punkte', intensity: 'Intensität' },
    })
    expect(text).toContain('# die ersten 1 Punkte:')
    expect(text).toContain('X\tY\tZ\tIntensität')
  })
})

describe.skipIf(!hasLaz)('readFirstPoints — the LAZ sample', () => {
  it('decodes the first points as the full read does', async () => {
    const source = await nodeFileSource(LAZ_PATH)
    try {
      const header = await readLasHeader(source)
      const points = await readFirstPoints(source, header, 200, { lazPerf: await nodeLazPerf() })
      expect(points).toHaveLength(200)
      expect(points[0].x).toBeCloseTo(4470683.058286359, 6)
      expect(points[0].y).toBeCloseTo(5332199.762836749, 6)
      expect(points[0].z).toBeCloseTo(536.8305144555818, 6)
      expect(points[0].intensity).toBe(14867)
      expect(pointsAsText(header, points).split('\n')).toContain('4470683.058\t5332199.763\t536.831\t14867')
    } finally {
      await source.close()
    }
  })
})
