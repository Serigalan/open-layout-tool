import { describe, it, expect, vi, afterEach } from 'vitest'
import { optimizeOnServer, optimizerReachable, OptimizerError } from './optimizerService'

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
