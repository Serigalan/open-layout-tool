import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { importGraph, serverReach } from '../../../tools/boundary.mjs'

// Rules about who may import whom (Roadmap rework). Checked on the sources,
// so a new import that breaks one fails here and not in review.

const SRC = join(import.meta.dirname, '..')
const ROOT = join(SRC, '..', '..')
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
  it('puts no colour value in a component, and few inline styles (R6.3)', () => {
    const jsx = sources('.').filter(p => p.endsWith('.jsx'))
    const hex = jsx.filter(p => /['"]#[0-9a-fA-F]{3,8}['"]/.test(readFileSync(p, 'utf8'))).map(p => relative(SRC, p))
    expect(hex).toEqual([])
    const inline = jsx.reduce((n, p) => n + (readFileSync(p, 'utf8').match(/style=\{/g)?.length ?? 0), 0)
    expect(inline).toBeLessThan(30)
  })
  it('names every button that shows only a symbol, in the interface language (R6.5)', () => {
    const jsx = sources('.').filter(p => p.endsWith('.jsx'))
    const unnamed = jsx.flatMap(p => [...readFileSync(p, 'utf8').matchAll(/<button\b((?:[^>]|=>)*)>\s*[✕×⋯✎◀▶]\s*<\/button>/g)]
      .filter(m => !/aria-label=\{/.test(m[1])).map(() => relative(SRC, p)))
    expect(unnamed).toEqual([])
    const fixed = jsx.filter(p => /aria-label="[A-Za-z]/.test(readFileSync(p, 'utf8'))).map(p => relative(SRC, p))
    expect(fixed).toEqual([])
  })

  // Paket L, decision 277: two layers, one direction.
  describe('core and server (Paket L)', () => {
    const graph = importGraph()
    const reach = serverReach(graph)
    it('core reaches no server module, not even through another (decision 277)', () => {
      const offenders = [...reach.keys()].filter(p => p.startsWith(SRC + '/')).map(p => relative(ROOT, p))
      expect(offenders).toEqual([])
    })
    it('the local entry imports nothing of src/server', () => {
      const seen = new Set()
      const walk = (path) => {
        if (seen.has(path)) return
        seen.add(path)
        for (const d of graph.get(path) ?? []) walk(d)
      }
      for (const d of graph.get(join(ROOT, 'src/main.local.jsx'))) walk(d)
      expect([...seen].filter(p => p.includes('/src/server/')).map(p => relative(ROOT, p))).toEqual([])
      expect(seen.has(join(SRC, 'home/LocalApp.jsx'))).toBe(true)
    })
    it('the main entry docks the server on before anything else', () => {
      const first = readFileSync(join(ROOT, 'src/main.jsx'), 'utf8').split('\n').find(line => line.startsWith('import '))
      expect(first).toBe("import './server/register'")
    })
  })
})
