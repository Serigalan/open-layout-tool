#!/usr/bin/env node
// The documentation under docs/ against the repository: every relative link
// leads to a file that is there, and every file a page names in backticks —
// `storage.js`, `src/core/utils/splice/solveSplice.js`, `tools/check.sh` — is
// there too. A page that names a file the code no longer has is wrong, and
// this is what notices it when the file is moved or renamed.
//
//   node tools/docs.mjs     check, exit 1 on a breach
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, resolve, basename } from 'node:path'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')
const DOCS = join(ROOT, 'docs')

const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-local', '__pycache__', 'archiv'])
const files = (dir) => readdirSync(dir).flatMap(name => {
  if (SKIP.has(name) || name.endsWith('.egg-info')) return []
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : [path]
})

// A backticked word names a file when it ends in one of these.
const FILE = /^[\w./-]+\.(js|jsx|mjs|json|py|md|sql|sh|css|html)$/

/** The breaches, as lines of text. */
export function checkDocs() {
  const repo = files(ROOT)
  const names = new Set(repo.map(p => basename(p)))
  const paths = new Set(repo.map(p => relative(ROOT, p)))
  const breaches = []
  for (const page of files(DOCS).filter(p => p.endsWith('.md'))) {
    const text = readFileSync(page, 'utf8')
    const where = relative(ROOT, page)
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/.test(target) || target.startsWith('#')) continue
      const file = resolve(dirname(page), target.split('#')[0])
      if (!existsSync(file)) breaches.push(`${where}: link to ${target}, which is not there`)
    }
    // Code blocks hold examples, not file names.
    const prose = text.replace(/```[\s\S]*?```/g, '')
    for (const [, word] of prose.matchAll(/`([^`\n]+)`/g)) {
      if (!FILE.test(word)) continue
      const found = word.includes('/')
        ? [...paths].some(p => p === word || p.endsWith(`/${word}`))
        : names.has(word)
      if (!found) breaches.push(`${where}: names \`${word}\`, which the repository does not have`)
    }
  }
  return breaches
}

function main() {
  const breaches = checkDocs()
  for (const b of breaches) console.log(b)
  process.exitCode = breaches.length ? 1 : 0
}

if (import.meta.url === `file://${process.argv[1]}`) main()
