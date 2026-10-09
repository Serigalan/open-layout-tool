// The hash of the rule catalogues this bundle carries, computed the way the
// optimizer service computes `catalogHash` in GET /regelwerke
// (olt_optimizer/regelwerk.py, catalog_hash): SHA-256 over every file in
// src/core/constraints/, in name order, each as its name, a NUL, its bytes, a NUL.
// When the two differ, the service checks and optimizes against other rules
// than the app shows — the panels say so.

const RAW = import.meta.glob('../constraints/*.json', { query: '?raw', import: 'default', eager: true })

/** [{ name, text }] in name order — the input of the hash. */
export function catalogFiles(raw = RAW) {
  return Object.entries(raw)
    .map(([path, text]) => ({ name: path.slice(path.lastIndexOf('/') + 1), text }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** Hex SHA-256 of `files` ([{ name, text }]). */
export async function hashCatalogFiles(files) {
  const enc = new TextEncoder()
  const parts = []
  for (const { name, text } of files) {
    parts.push(enc.encode(name), new Uint8Array([0]), enc.encode(text), new Uint8Array([0]))
  }
  const total = parts.reduce((n, p) => n + p.length, 0)
  const buf = new Uint8Array(total)
  let at = 0
  for (const p of parts) { buf.set(p, at); at += p.length }
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

let own = null
/** The hash of this bundle's catalogues (computed once). */
export function bundledCatalogHash() {
  if (!own) own = hashCatalogFiles(catalogFiles())
  return own
}
