import { describe, it, expect } from 'vitest'
import { bytesText, classifyKey, groupFiles, storedBytes, walkFiles } from './localStore'


/** A directory of the Origin Private File System, as far as walkFiles reads one. */
function fakeDir(tree) {
  return {
    kind: 'directory',
    async *entries() {
      for (const [name, value] of Object.entries(tree)) {
        yield [name, typeof value === 'number'
          ? { kind: 'file', getFile: async () => ({ size: value, lastModified: 1000 + value }) }
          : fakeDir(value)]
      }
    },
  }
}

describe('local storage: entries', () => {
  it('tells the settings, the import reports and the hidden tracks apart', () => {
    expect(classifyKey('olt_settings')).toEqual({ kind: 'settings', ref: null })
    expect(classifyKey('olt_reports_v-42')).toEqual({ kind: 'reports', ref: 'v-42' })
    expect(classifyKey('olt_hidden_tracks_p-7')).toEqual({ kind: 'hidden', ref: 'p-7' })
    expect(classifyKey('something_else')).toEqual({ kind: 'other', ref: null })
  })
})

describe('local storage: files', () => {
  const root = fakeDir({
    pointclouds: {
      p1: {
        c1: { 'tiles.bin': 5000, 'index.json': 40 },
        c2: { 'tiles.bin': 300 },                 // an import that never finished
      },
      p2: { c3: { 'tiles.bin': 900, 'index.json': 50 } },
      'stray.txt': 7,
    },
    scratch: { a: 10, b: { c: 20 } },
  })

  it('walks every file with its path from the root', async () => {
    const files = await walkFiles(root)
    expect(files).toHaveLength(8)
    expect(files).toContainEqual({ path: ['scratch', 'b', 'c'], bytes: 20, lastModified: 1020 })
  })

  it('groups a cloud into one entry, an unfinished one without its index, the rest by top-level entry', async () => {
    const { clouds, other } = groupFiles(await walkFiles(root))
    expect(clouds.map(c => [c.projectId, c.cloudId, c.bytes, c.hasIndex])).toEqual([
      ['p1', 'c1', 5040, true],
      ['p2', 'c3', 950, true],
      ['p1', 'c2', 300, false],
    ])
    expect(clouds[0].path).toEqual(['pointclouds', 'p1', 'c1'])
    expect(other).toEqual([
      { path: ['scratch'], bytes: 30, lastModified: 1020 },
      { path: ['pointclouds', 'stray.txt'], bytes: 7, lastModified: 1007 },
    ])
  })
})

describe('local storage: record sizes', () => {
  it('counts a record as its JSON at two bytes a character and a Blob at its own size', () => {
    expect(storedBytes({ a: 'xy' })).toBe(2 * '{"a":"xy"}'.length)
    expect(storedBytes({ img: new Blob(['12345']) })).toBe(2 * '{"img":null}'.length + 5)
  })
})

describe('local storage: sizes as text', () => {
  it('names bytes in the unit that fits, with the language\'s decimal separator', () => {
    expect(bytesText(512, 'de')).toBe('512 B')
    expect(bytesText(1536, 'de')).toBe('1,5 kB')
    expect(bytesText(2.25e6, 'en')).toBe('2.3 MB')
    expect(bytesText(3e9, 'de')).toBe('3,0 GB')
  })
})
