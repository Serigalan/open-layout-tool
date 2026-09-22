import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  optimizeOnServer, optimizerReachable, fetchRegelwerke, fetchRegelwerk, OptimizerError,
} from './optimizerService'
import { reconstructElements } from './elementReconstruct'
import { recalcAbsLengths } from '../storage'
import { expectValidTrack } from '../test/chainInvariants'
import korbbogen from '../test/fixtures/optimizer_service_korbbogen.json'

// What the service promises over the wire is checked against a running one in
// tools/optimizer/tests/verify_service.py. What is checked here is the half the
// panel depends on: that a result arrives unwrapped, and that every way a run
// can fail arrives as something the panel can put into words.

const RESULT = {
  elements: [], report: [{ group: 1, arc: 1, arcs: 1, changed: true }],
  variant: 'Bestand', vBestand: 100, vBaseline: 110, vNeu: 120, shifts: {},
}

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

afterEach(() => { vi.unstubAllGlobals() })

describe('what the panel gets back from the optimizer service', () => {
  it('is the result object, unwrapped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(RESULT)))
    await expect(optimizeOnServer({ track: {} })).resolves.toEqual(RESULT)
  })

  it('is asked for with the payload as JSON on /optimize', async () => {
    const fetchMock = vi.fn(async () => json(RESULT))
    vi.stubGlobal('fetch', fetchMock)
    await optimizeOnServer({ track: { id: 'a' }, corridorCm: 50, uf: 130 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/optimize$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toMatchObject({ corridorCm: 50, uf: 130 })
  })
})

describe('a run that fails', () => {
  it('carries the service’s own key, so the panel can name it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'too_large' }, 413)))
    await expect(optimizeOnServer({})).rejects.toMatchObject({
      name: 'OptimizerError', code: 'too_large',
    })
  })

  // The topology message names the element sequence that was refused, which no
  // generic key can — so it travels alongside the key.
  it('keeps the sentence the optimizer wrote about an unusable topology', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(
      { error: 'unsupported_topology', message: 'S-Bögen ohne Zwischengerade …' }, 422)))
    const err = await optimizeOnServer({}).catch(e => e)
    expect(err.code).toBe('unsupported_topology')
    expect(err.detail).toBe('S-Bögen ohne Zwischengerade …')
  })

  // There is no second implementation in the bundle to fall back on, so an
  // unreachable service has to arrive as a stateable error rather than a hang.
  it('reads as unreachable where the request never lands', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(optimizeOnServer({})).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('reads as unreachable where something other than JSON comes back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => { throw new SyntaxError('<html>') },
    })))
    await expect(optimizeOnServer({})).rejects.toBeInstanceOf(OptimizerError)
  })

  it('leaves an abort an abort — that is the caller’s own doing', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn(async () => { throw abort }))
    await expect(optimizeOnServer({})).rejects.toBe(abort)
  })
})

describe('asking whether the service is there', () => {
  it('answers true where it is', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ status: 'ok' })))
    await expect(optimizerReachable()).resolves.toBe(true)
  })

  // The panel asks this to decide whether to offer the run at all, so it may
  // not throw — a dead service is an answer, not an exception.
  it('answers false instead of throwing where it is not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(optimizerReachable()).resolves.toBe(false)
  })
})

describe('asking which regelwerke the service knows (AP R.3)', () => {
  it('resolves with the list', async () => {
    const regelwerke = [{ id: 'db-ril-800', name: 'DB Ril 800', version: '1', gueltigAb: '2026-09-22' }]
    vi.stubGlobal('fetch', vi.fn(async () => json({ regelwerke })))
    await expect(fetchRegelwerke()).resolves.toEqual(regelwerke)
  })

  it('resolves with [] rather than throwing where the service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(fetchRegelwerke()).resolves.toEqual([])
  })

  it('resolves with [] where the answer is not the expected shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ nope: true })))
    await expect(fetchRegelwerke()).resolves.toEqual([])
  })
})

describe('asking for one regelwerk in full', () => {
  it('resolves with the regelwerk', async () => {
    const rw = { id: 'db-ril-800', ueberhoehung: { u_max: { wert: 160 } } }
    vi.stubGlobal('fetch', vi.fn(async () => json(rw)))
    await expect(fetchRegelwerk('db-ril-800')).resolves.toEqual(rw)
  })

  it('resolves with null where the id is unknown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'not_found' }, 404)))
    await expect(fetchRegelwerk('nicht-vorhanden')).resolves.toBeNull()
  })

  it('resolves with null rather than throwing where the service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(fetchRegelwerk('db-ril-800')).resolves.toBeNull()
  })
})

// A compound curve is what AP 4.2 is about, and this is the seam it has to
// cross: an answer the service really gave (recorded from a running one) has to
// come back as a track this app will take. The optimization itself is checked
// in tools/optimizer/tests/verify.py.
describe('an optimized compound curve coming back from the service', () => {
  const { track } = korbbogen.request
  const optimized = korbbogen.response

  it('rebuilds into a valid element chain', () => {
    const elements = recalcAbsLengths(reconstructElements(optimized.elements, track.epsg))
    expectValidTrack({ ...track, elements })
  })

  it('stays one group of two arcs turning the same way', () => {
    const arcs = optimized.elements.filter(el => el.radius != null)
    expect(arcs).toHaveLength(2)
    expect(new Set(optimized.report.map(r => r.group)).size).toBe(1)
    expect(optimized.report.map(r => r.arc)).toEqual([1, 2])
    expect(Math.sign(arcs[0].radius)).toBe(Math.sign(arcs[1].radius))
  })

  it('is faster than what it replaces, and keeps the track ends where they were', () => {
    const before = track.elements
    const after = optimized.elements
    expect(optimized.vNeu).toBeGreaterThan(optimized.vBestand)
    expect(after[0].startNode[0]).toBeCloseTo(before[0].startNode[0], 6)
    expect(after[0].startNode[1]).toBeCloseTo(before[0].startNode[1], 6)
    expect(after.at(-1).endNode[0]).toBeCloseTo(before.at(-1).endNode[0], 6)
    expect(after.at(-1).endNode[1]).toBeCloseTo(before.at(-1).endNode[1], 6)
  })

  // The rule a compound curve adds over a simple one: the cant step between two
  // arcs is carried by the ramp between them, measured against the step itself
  // rather than against zero.
  it('carries the cant step between the arcs on a long enough ramp', () => {
    const els = optimized.elements
    const first = els.findIndex(el => el.radius != null)
    const second = els.findIndex((el, i) => el.radius != null && i > first)
    const between = els.slice(first + 1, second)
    expect(between).toHaveLength(1)
    expect(between[0].elementType).toBe(2)

    const deltaU = Math.abs(Math.abs(els[first].cant) - Math.abs(els[second].cant))
    const k = between[0].transitionType === 'bloss' ? 6 : 8
    const v = Math.min(els[first].speed, els[second].speed)
    expect(between[0].length).toBeGreaterThanOrEqual(k * v * deltaU / 1000 - 1e-9)
  })
})
