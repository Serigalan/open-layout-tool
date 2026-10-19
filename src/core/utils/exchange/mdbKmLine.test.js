import { describe, it, expect, vi, afterEach } from 'vitest'
import { mdbKmRuns, mdbKmLines } from './mdbKmLine'
import { parseMdbPayload } from './mdbImport'
import { ALL_STRECKEN, runMdbImport } from './mdbPipeline'
import { ensureKmLines } from '../km'
import fixture from '../../test/fixtures/mdb_str1244.json'

/**
 * The kilometrage line of the file (Satzart 24), on the delivered
 * STR_1244_KM_112-132: line 1244 from km 12.944 686 on, and a piece of line
 * 6100 around km 273 with a kilometrage jump of 7.770 m in it (type 6).
 */

const payload = parseMdbPayload(fixture)

describe('mdbKmRuns', () => {
  const runs = mdbKmRuns(payload)

  it('lays out the line of each number, its kilometrage in metres on every vertex', () => {
    expect([...runs.keys()].sort()).toEqual(['1244', '6100'])
    const [run] = runs.get('1244')
    expect(run[0][2]).toBeCloseTo(12944.686, 3)
    expect(run[run.length - 1][2]).toBeCloseTo(13718.423, 3)
    // Rising along the run, in WGS84 near Hamburg.
    for (let i = 1; i < run.length; i++) expect(run[i][2]).toBeGreaterThanOrEqual(run[i - 1][2])
    expect(run[0][0]).toBeGreaterThan(9)
    expect(run[0][0]).toBeLessThan(11)
    expect(run[0][1]).toBeGreaterThan(53)
    expect(run[0][1]).toBeLessThan(54)
  })

  it('starts a new run at a kilometrage jump', () => {
    const lines = runs.get('6100')
    expect(lines).toHaveLength(2)
    expect(lines[0].at(-1)[2]).toBeCloseTo(273203.349, 3)
    expect(lines[1][0][2]).toBeCloseTo(273211.119, 3)
  })

  it('keeps the kilometrage of a vertex true to the length along the element', () => {
    // The first element of line 1244 is a straight of 69.944 m from km 12.944 686.
    const [run] = runs.get('1244')
    const k = Math.cos(run[0][1] * Math.PI / 180)
    const d = Math.hypot((run[1][0] - run[0][0]) * 111320 * k, (run[1][1] - run[0][1]) * 110574)
    expect(run[1][2] - run[0][2]).toBeCloseTo(d, 0)
  })

  it('takes only the lines it is asked for', () => {
    expect([...mdbKmRuns(payload, new Set(['1244'])).keys()]).toEqual(['1244'])
  })
})

describe('mdbKmLines', () => {
  it('gives each line the shape a project keeps, marked as from the file', () => {
    const [line] = mdbKmLines(payload, ['1244'], null)
    expect(line).toMatchObject({ id: 'km-1244', lineNumber: 1244, crs: 'EPSG:4326', source: 'mdb' })
    expect(line.runs).toHaveLength(1)
  })

  it('cuts the line to the box like a fetched one', () => {
    const [run] = mdbKmRuns(payload).get('1244')
    const [lon, lat] = run[0]
    const box = [lon - 0.001, lat - 0.001, lon + 0.001, lat + 0.001]
    const [line] = mdbKmLines(payload, ['1244'], box)
    expect(line.clip).toEqual(box)
    expect(line.runs[0].length).toBeLessThan(run.length)
  })
})

describe('in the import', () => {
  it('comes along for the lines the imported tracks run on', async () => {
    let n = 0
    const { commit, counts, notes } = await runMdbImport({
      payload, strecke: ALL_STRECKEN, fill: (key, params) => `${key} ${JSON.stringify(params)}`, newId: () => `id${++n}`,
    })
    expect(counts.kmLines).toBe(2)
    expect(commit.addKmLines.map(l => l.lineNumber).sort()).toEqual([1244, 6100])
    expect(notes.some(t => t.startsWith('data_exchange_mdb_km_lines'))).toBe(true)
  })
})

describe('ensureKmLines', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fetches nothing over a line from the file', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const result = await ensureKmLines({
      tracks: [{ lineNumber: 1244, coordinates: [[10, 53.5], [10.01, 53.51]] }],
      kmLines: [{ id: 'km-1244', lineNumber: 1244, clip: [0, 0, 1, 1], runs: [], source: 'mdb' }],
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(result).toMatchObject({ save: [], remove: [] })
  })
})
