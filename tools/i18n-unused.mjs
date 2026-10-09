#!/usr/bin/env node
// Translation keys no source file uses (R6.2). A key counts as used when it
// appears as a string anywhere under src/, or when it starts with a prefix
// that a key is built from at runtime: `status_${s}`, t(`admin_err_${code}`),
// or a prefix handed on as a string ending in "_" ('admin_err_'), or when it is
// another literal with a suffix put after it at runtime: t(`${key}_hint`).
//
//   node tools/i18n-unused.mjs          list the unused keys, exit 1 if any
//   node tools/i18n-unused.mjs --fix    remove them from every locale file
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const LOCALES = join(ROOT, 'src/locales')
const files = (dir) => readdirSync(dir).flatMap(n => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? files(p) : [p]
})
const sources = files(join(ROOT, 'src'))
  .filter(p => /\.(jsx?|mjs)$/.test(p) && !p.startsWith(LOCALES + '/') || p.endsWith('i18n.js'))
  .map(p => readFileSync(p, 'utf8')).join('\n')

const locales = readdirSync(LOCALES).filter(n => n.endsWith('.json'))
const keys = Object.keys(JSON.parse(readFileSync(join(LOCALES, 'en.json'), 'utf8')))

const literals = new Set([...sources.matchAll(/['"`]([a-z][a-z0-9_]*)['"`]/g)].map(m => m[1]))
const prefixes = new Set([
  ...[...sources.matchAll(/`([a-z][a-z0-9_]*_)\$\{/g)].map(m => m[1]),
  ...[...literals].filter(l => l.endsWith('_')),
])
const suffixes = new Set([...sources.matchAll(/\}(_[a-z0-9_]+)`/g)].map(m => m[1]))
const used = (key) => literals.has(key) || [...prefixes].some(p => key.startsWith(p)) ||
  [...suffixes].some(s => key.endsWith(s) && literals.has(key.slice(0, -s.length)))
const unused = keys.filter(k => !used(k))

if (process.argv.includes('--fix')) {
  for (const name of locales) {
    const path = join(LOCALES, name)
    const data = JSON.parse(readFileSync(path, 'utf8'))
    for (const k of unused) delete data[k]
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
  }
  console.log(`removed ${unused.length} keys from ${locales.join(', ')}`)
} else {
  for (const k of unused) console.log(k)
  if (unused.length) { console.error(`${unused.length} unused keys`); process.exit(1) }
}
