import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Rules about who may import whom (Roadmap rework). Checked on the sources,
// so a new import that breaks one fails here and not in review.

const SRC = join(import.meta.dirname, '..')
const files = (dir) => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : [path]
})
const sources = (dir) => files(join(SRC, dir)).filter(p => /\.(js|jsx)$/.test(p) && !/\.test\.js$/.test(p))
const importsOf = (path) => [...readFileSync(path, 'utf8').matchAll(/from '([^']+)'/g)].map(m => m[1])

describe('architecture', () => {
  it('no util reads the store except the working-copy sync (R1.1)', () => {
    const allowed = new Set(['utils/workingCopySync.js', 'utils/variantMerge.js'])
    const offenders = sources('utils')
      .filter(p => !allowed.has(relative(SRC, p)))
      .filter(p => importsOf(p).some(s => /(^|\/)storage$/.test(s)))
      .map(p => relative(SRC, p))
    expect(offenders).toEqual([])
  })
})
