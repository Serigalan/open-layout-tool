#!/usr/bin/env node
// The local version as one zip (Paket L, AP L.7): the local build under app/,
// the small server that serves it (serve.mjs), start scripts and the README.
// Run after `npm run build:local`:
//
//   node tools/local/pack.mjs [out.zip]     default open-layout-tool-local-<date>.zip
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { zipSync } from 'fflate'

const ROOT = new URL('../..', import.meta.url).pathname
const DIST = join(ROOT, 'dist-local')
const HERE = join(ROOT, 'tools/local')
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist-local/index.html missing — build it first: npm run build:local')
  process.exit(2)
}
const now = new Date()
const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const out = process.argv[2] ?? join(ROOT, `open-layout-tool-local-${date}.zip`)
const TOP = `open-layout-tool-local-${date}`

const files = (d) => readdirSync(d).flatMap(n => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? files(p) : [p]
})
// Already compressed, or too big to be worth the time: stored as they are.
const STORED = /\.(png|webp|jpg|pdf|pmtiles|tif|zip|gz|woff2)$/i

const entries = {}
const add = (name, path, mode) => {
  entries[`${TOP}/${name}`] = [readFileSync(path), { level: STORED.test(path) ? 0 : 6, ...(mode ? { os: 3, attrs: mode << 16 } : {}) }]
}
for (const path of files(DIST)) add(`app/${relative(DIST, path)}`, path)
add('serve.mjs', join(HERE, 'serve.mjs'))
add('README.md', join(HERE, 'README.md'))
add('start.sh', join(HERE, 'start.sh'), 0o100755)
add('start.cmd', join(HERE, 'start.cmd'))

writeFileSync(out, zipSync(entries))
console.log(`${relative(process.cwd(), out)}: ${(statSync(out).size / 1e6).toFixed(1)} MB, ${Object.keys(entries).length} files`)
