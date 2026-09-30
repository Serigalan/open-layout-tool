import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { lineNameOf } from './lineLookup'

// The line files are fetched next to the app; here they answer from a table.
const FILES = {
  '6344': { lineNumber: 6344, lineName: 'Halle - Vienenburg', chainage: [] },
  '6345': { lineNumber: 6345, chainage: [] },
}

describe('lineNameOf', () => {
  const fetchMock = vi.fn(async (url) => {
    const file = FILES[decodeURIComponent(String(url).split('/').pop().replace(/\.json$/, ''))]
    return file
      ? { ok: true, status: 200, json: async () => file }
      : { ok: false, status: 404, json: async () => null }
  })
  beforeAll(() => {
    vi.stubGlobal('window', { location: { href: 'http://localhost/' } })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterAll(() => vi.unstubAllGlobals())

  it('gives the name the line file carries', async () => {
    expect(await lineNameOf('6344')).toBe('Halle - Vienenburg')
    expect(await lineNameOf(' 6344 ')).toBe('Halle - Vienenburg')
    expect(await lineNameOf(6344)).toBe('Halle - Vienenburg')
  })

  it('gives null for a line without a name or without a file', async () => {
    expect(await lineNameOf('6345')).toBeNull()
    expect(await lineNameOf('9999')).toBeNull()
  })

  it('does not look up what is no number', async () => {
    fetchMock.mockClear()
    expect(await lineNameOf('')).toBeNull()
    expect(await lineNameOf(null)).toBeNull()
    expect(await lineNameOf('63a4')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
