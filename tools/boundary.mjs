#!/usr/bin/env node
// The line between browser and server components (Paket L, decision 277).
//
// Every module under src/ that needs the project server or the Python service
// — directly, because it imports one of the two clients, or indirectly,
// because something it imports does. Those belong to src/server; the rest is
// src/core. Once the split is done the list under src/core is empty: core
// never imports from server, and the lint rule (eslint.config.js) and
// src/core/test/architecture.test.js hold it there.
//
//   node tools/boundary.mjs           the server modules, direct and indirect
//   node tools/boundary.mjs --core    only the modules in src/core that still reach a client
//   node tools/boundary.mjs --why <file>   the import chain from <file> to a client
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')
const SRC = join(ROOT, 'src')

/** The two ways out of the browser: the project server and the Python service. */
// (Before AP L.1 moved them, both lived in src/api and src/utils.)
export const CLIENTS = [
  'src/server/api/client.js', 'src/server/optimizerService.js',
  'src/server/api/client.js', 'src/server/optimizerService.js',
]

const files = (dir) => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : [path]
})

// Everything a module names as a path: static and dynamic imports, re-exports,
// workers and assets (`new URL(…, import.meta.url)`) and the modules a test mocks.
const SPECIFIERS = [
  /\bfrom\s+'([^']+)'/g,
  /\bimport\s+'([^']+)'/g,
  /\bimport\(\s*'([^']+)'\s*\)/g,
  /new URL\(\s*'([^']+)'\s*,\s*import\.meta\.url\s*\)/g,
  /\bvi\.mock\(\s*'([^']+)'/g,
]

export function specifiersOf(source) {
  return SPECIFIERS.flatMap(re => [...source.matchAll(re)].map(m => m[1]))
}

/** The file a relative specifier names, or null for a package or a path that is not there. */
export function resolveSpecifier(from, specifier) {
  if (!/^\.{1,2}\//.test(specifier)) return null
  const bare = specifier.replace(/\?.*$/, '')
  const base = resolve(dirname(from), bare)
  for (const suffix of ['', '.js', '.jsx', '/index.js', '/index.jsx']) {
    const p = base + suffix
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  return null
}

/**
 * The entries of the two builds (src/main.jsx, src/main.local.jsx) belong to
 * neither layer: a module that names one (a test reading its source) does not
 * import what the entry imports.
 */
const isEntry = (path) => dirname(path) === SRC && /^main(\.\w+)?\.jsx$/.test(path.slice(SRC.length + 1))

/** Module → the modules it imports, for every .js/.jsx under src/ (tests included). */
export function importGraph() {
  const graph = new Map()
  for (const path of files(SRC).filter(p => /\.(js|jsx)$/.test(p))) {
    const deps = specifiersOf(readFileSync(path, 'utf8'))
      .map(s => resolveSpecifier(path, s)).filter(p => p && /\.(js|jsx)$/.test(p) && !isEntry(p))
    graph.set(path, [...new Set(deps)])
  }
  return graph
}

/** For each module that reaches a client: the next step on its shortest way there. */
export function serverReach(graph = importGraph()) {
  const clients = CLIENTS.map(c => join(ROOT, c)).filter(c => graph.has(c))
  const next = new Map(clients.map(c => [c, null]))
  const importers = new Map()
  for (const [from, deps] of graph) for (const d of deps) {
    if (!importers.has(d)) importers.set(d, [])
    importers.get(d).push(from)
  }
  const queue = [...clients]
  while (queue.length) {
    const at = queue.shift()
    for (const from of importers.get(at) ?? []) {
      if (next.has(from)) continue
      next.set(from, at)
      queue.push(from)
    }
  }
  return next
}

function main() {
  const args = process.argv.slice(2)
  const graph = importGraph()
  const reach = serverReach(graph)
  const rel = (p) => relative(ROOT, p)
  if (args[0] === '--why') {
    let at = resolve(args[1])
    if (!reach.has(at)) { console.log(`${rel(at)} reaches no server client`); return }
    const chain = []
    while (at) { chain.push(rel(at)); at = reach.get(at) }
    console.log(chain.join('\n  → '))
    return
  }
  const clients = new Set(CLIENTS.map(c => join(ROOT, c)))
  const direct = [...reach.keys()].filter(p => !clients.has(p) && clients.has(reach.get(p)))
  const indirect = [...reach.keys()].filter(p => !clients.has(p) && !clients.has(reach.get(p)))
  const inCore = (p) => p.startsWith(join(SRC, 'core') + '/')
  if (args[0] === '--core') {
    const offenders = [...reach.keys()].filter(inCore).map(rel).sort()
    for (const p of offenders) console.log(p)
    process.exitCode = offenders.length ? 1 : 0
    return
  }
  console.log(`direct (${direct.length}):`)
  for (const p of direct.map(rel).sort()) console.log(`  ${p}`)
  console.log(`indirect (${indirect.length}):`)
  for (const p of indirect.map(rel).sort()) console.log(`  ${p}  ← ${rel(reach.get(join(ROOT, p)))}`)
  const core = [...reach.keys()].filter(inCore)
  if (core.length) console.log(`\nstill in src/core (${core.length}) — see --why <file>`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
