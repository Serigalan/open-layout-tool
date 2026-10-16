#!/usr/bin/env node
// The modules of src/core/utils and the rules between them (docs/architecture.md).
//
// Each directory under src/core/utils is a module: geometry, track, switch, …
// Its index.js is its public face. Three rules hold them apart:
//
//   1. Code outside a module imports from its index.js and nowhere else.
//      Tests may reach inside (they test the parts), and a module's own files
//      import each other directly.
//   2. The modules depend on each other without a cycle — there is an order
//      in which each needs only the ones before it (printed by --order).
//   3. A module is computation, not interface: it imports nothing of the
//      app's interface (components, map, shell, hooks, the store) — only the
//      extension points, the translations, the palette, the basemaps and the
//      rulebooks.
//
//   node tools/modules.mjs           check, exit 1 on a breach
//   node tools/modules.mjs --order   the modules in dependency order, with what each needs
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { specifiersOf, resolveSpecifier } from './boundary.mjs'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')
const UTILS = join(ROOT, 'src/core/utils')
const CORE = join(ROOT, 'src/core')

/** What a module may use of src/core outside the modules (rule 3). */
const CORE_ALLOWED = ['extensions.js', 'locales/', 'styles/', 'basemaps.js', 'constraints/']

const files = (dir) => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  if (name === 'node_modules') return []
  return statSync(path).isDirectory() ? files(path) : [path]
})
const isTest = (p) => /\.test\.js$/.test(p) || p.startsWith(join(CORE, 'test') + '/')

export const MODULES = readdirSync(UTILS).filter(n => statSync(join(UTILS, n)).isDirectory()).sort()

/** The module a path lies in, or null. */
export const moduleOf = (path) => (path.startsWith(UTILS + '/') ? path.slice(UTILS.length + 1).split('/')[0] : null)

/** Every source file that may import a module: the app and the project server. */
function sources() {
  return [...files(join(ROOT, 'src')), ...files(join(ROOT, 'tools/server/src')), ...files(join(ROOT, 'tools/server/bin'))]
    .filter(p => /\.(js|jsx|mjs)$/.test(p))
}

/** The breaches of rules 1–3, as lines of text, and the module graph. */
export function checkModules() {
  const breaches = []
  const needs = new Map(MODULES.map(m => [m, new Set()]))
  for (const path of sources()) {
    const from = moduleOf(path)
    const deps = specifiersOf(readFileSync(path, 'utf8')).map(s => resolveSpecifier(path, s)).filter(Boolean)
    for (const dep of deps) {
      const to = moduleOf(dep)
      // Rule 3: a module reaches only the parts of core it may.
      if (from && !isTest(path) && !to && dep.startsWith(CORE + '/')
        && !CORE_ALLOWED.some(a => relative(CORE, dep).startsWith(a))) {
        breaches.push(`${relative(ROOT, path)} imports ${relative(ROOT, dep)} — a module imports nothing of the interface`)
      }
      if (!to || to === from) continue
      if (from && !isTest(path)) needs.get(from).add(to)
      // Rule 1: from outside, only the index.
      if (!isTest(path) && dep !== join(UTILS, to, 'index.js')) {
        breaches.push(`${relative(ROOT, path)} imports ${relative(ROOT, dep)} — import from src/core/utils/${to} (its index.js)`)
      }
    }
  }
  // Rule 2: no cycle. Kahn's order; what is left over lies on a cycle.
  const order = []
  const left = new Map([...needs].map(([m, s]) => [m, new Set(s)]))
  while (left.size) {
    const ready = [...left].filter(([, s]) => [...s].every(d => !left.has(d))).map(([m]) => m).sort()
    if (!ready.length) {
      breaches.push(`the modules ${[...left.keys()].join(', ')} need each other in a cycle`)
      break
    }
    for (const m of ready) { order.push(m); left.delete(m) }
  }
  // And each has its index.
  for (const m of MODULES) {
    if (!existsSync(join(UTILS, m, 'index.js'))) breaches.push(`src/core/utils/${m} has no index.js`)
  }
  return { breaches, order, needs }
}

function main() {
  const { breaches, order, needs } = checkModules()
  if (process.argv[2] === '--order') {
    for (const m of order) console.log(`${m.padEnd(13)} ${[...needs.get(m)].sort().join(' ')}`)
    return
  }
  for (const b of breaches) console.log(b)
  process.exitCode = breaches.length ? 1 : 0
}

if (import.meta.url === `file://${process.argv[1]}`) main()
