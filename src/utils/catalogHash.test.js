import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { bundledCatalogHash, catalogFiles, hashCatalogFiles } from './catalogHash'

const DIR = join(import.meta.dirname, '..', 'constraints')

describe('catalogue hash (R0.1)', () => {
  it('covers every catalogue file, in name order', () => {
    const names = catalogFiles().map(f => f.name)
    expect(names).toEqual(readdirSync(DIR).filter(n => n.endsWith('.json')).sort())
  })

  it('equals the hash the optimizer service computes over the raw file bytes', async () => {
    // The same recipe as olt_optimizer/regelwerk.py catalog_hash, here with
    // node:crypto over the files as they lie on disk.
    const h = createHash('sha256')
    for (const name of readdirSync(DIR).filter(n => n.endsWith('.json')).sort()) {
      h.update(Buffer.from(name + '\0', 'utf-8'))
      h.update(Buffer.concat([readFileSync(join(DIR, name)), Buffer.from([0])]))
    }
    expect(await bundledCatalogHash()).toBe(h.digest('hex'))
  })

  it('changes with any byte of any file', async () => {
    const a = await hashCatalogFiles([{ name: 'a.json', text: '{}' }])
    const b = await hashCatalogFiles([{ name: 'a.json', text: '{ }' }])
    expect(a).not.toBe(b)
  })
})
