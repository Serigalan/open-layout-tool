#!/usr/bin/env node
// The local build holds nothing of the server (Paket L, AP L.5): no request to
// the project server (/api/) or the optimizer service (/optimizer), no module
// of src/server. Run after `vite build --mode standalone` (npm run build:local).
//
//   node tools/check-local-bundle.mjs [dist-local]
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'dist-local'
if (!existsSync(join(dir, 'index.html'))) {
  console.error(`${dir}/index.html missing — build it first: npm run build:local`)
  process.exit(2)
}
const files = (d) => readdirSync(d).flatMap(n => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? files(p) : [p]
})

// What only the server's modules say: their endpoints, and the names of
// modules that live in src/server alone.
const FORBIDDEN = [
  [/["'`]\/api\//, 'a request to the project server (/api/)'],
  [/\/optimizer\b/, 'a request to the optimizer service (/optimizer)'],
  [/#\/cloud3d/, 'the 3D window'],
]
const found = []
for (const file of files(join(dir, 'assets')).filter(f => /\.(js|html)$/.test(f))) {
  const text = readFileSync(file, 'utf8')
  for (const [re, what] of FORBIDDEN) if (re.test(text)) found.push(`${file}: ${what}`)
}
const html = readFileSync(join(dir, 'index.html'), 'utf8')
if (!/assets\/index-[\w-]+\.js/.test(html)) found.push(`${dir}/index.html: no entry script`)

if (found.length) {
  console.error('The local build holds server parts:\n  ' + found.join('\n  '))
  process.exit(1)
}
console.log(`${dir}: no server parts`)
