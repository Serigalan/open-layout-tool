// Lets plain Node load the browser modules under src/ unchanged: they import
// each other without file extensions and import JSON without attributes, both
// of which only the bundler resolves.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const RELATIVE = /^\.{1,2}\//

export async function resolve(specifier, context, next) {
  if (RELATIVE.test(specifier) && context.parentURL?.startsWith('file:')) {
    for (const suffix of ['', '.js', '.jsx', '/index.js']) {
      const url = new URL(specifier + suffix, context.parentURL)
      if (existsSync(fileURLToPath(url)) && !(suffix === '' && !/\.[cm]?jsx?$|\.json$/.test(specifier))) {
        return next(url.href, context)
      }
    }
  }
  return next(specifier, context)
}

export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.json')) {
    const json = await readFile(fileURLToPath(url), 'utf8')
    return { format: 'module', source: `export default ${json}`, shortCircuit: true }
  }
  if (url.startsWith('file:') && url.includes('/src/') && url.endsWith('.js')) {
    const source = await readFile(fileURLToPath(url), 'utf8')
    // Vite fills import.meta.env at build time; under Node it is not there.
    return { format: 'module', source: source.replaceAll('import.meta.env', '(import.meta.env ?? {})'), shortCircuit: true }
  }
  return next(url, context)
}
