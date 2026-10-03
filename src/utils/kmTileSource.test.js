import { afterEach, describe, it, expect, vi } from 'vitest'
import { KmTileSource } from './kmTileSource'

const answer = (status, bytes, etag) => new Response(new Uint8Array(bytes), {
  status, headers: { 'Content-Length': String(bytes), Etag: etag },
})

describe('KmTileSource', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks once more past the cache when a stale range comes back as the whole file', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(answer(200, 50000, '"new"'))   // If-Range with the old ETag
      .mockResolvedValueOnce(answer(206, 16384, '"new"'))
    vi.stubGlobal('fetch', fetch)
    const got = await new KmTileSource('https://x/km.pmtiles').getBytes(0, 16384)
    expect(got.data.byteLength).toBe(16384)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0][1].cache).toBeUndefined()
    expect(fetch.mock.calls[1][1].cache).toBe('reload')
  })

  it('gives up after the second refusal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
    await expect(new KmTileSource('https://x/km.pmtiles').getBytes(0, 16384)).rejects.toThrow('404')
  })
})
