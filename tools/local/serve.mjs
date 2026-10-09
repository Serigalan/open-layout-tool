#!/usr/bin/env node
// The local build of the Open Layout Tool, served on this computer only
// (Paket L, AP L.7). The app needs a web server — workers, the browser's file
// system and ES modules do not run from file:// — and its km data is read in
// ranges (PMTiles), so this one answers Range requests. No dependencies: any
// Node.js from version 18 runs it.
//
//   node serve.mjs [port]        then open http://localhost:<port>/  (default 8080)
//
// It listens on 127.0.0.1 alone: nothing is reachable from other computers.
import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
// Beside this file in the zip; in the repository the build's own folder.
const ROOT = resolve(process.env.OLT_LOCAL_ROOT ?? (statOr(join(HERE, 'app')) ? join(HERE, 'app') : join(HERE, '..', '..', 'dist-local')))
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080)

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.wasm': 'application/wasm', '.tif': 'image/tiff', '.pmtiles': 'application/octet-stream',
  '.woff2': 'font/woff2', '.pbf': 'application/x-protobuf', '.txt': 'text/plain; charset=utf-8',
}

function statOr(path) {
  try { return statSync(path) } catch { return null }
}

/** The file a request names, inside ROOT, or null. */
function fileOf(urlPath) {
  let path
  try { path = decodeURIComponent(urlPath.split('?')[0]) } catch { return null }
  const full = normalize(join(ROOT, path))
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null
  const stat = statOr(full)
  if (stat?.isDirectory()) return fileOf(join(path, 'index.html'))
  return stat?.isFile() ? { full, size: stat.size } : null
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return }
  const file = fileOf(req.url ?? '/')
  if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return }
  const headers = {
    'Content-Type': TYPES[extname(file.full).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': file.full.endsWith('.html') ? 'no-cache' : 'max-age=3600',
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  let start = 0, end = file.size - 1, status = 200
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), end) }
    else start = Math.max(0, file.size - Number(range[2]))
    if (start > end || start >= file.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${file.size}` }).end()
      return
    }
    status = 206
    headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`
  }
  headers['Content-Length'] = file.size ? end - start + 1 : 0
  res.writeHead(status, headers)
  if (req.method === 'HEAD' || !file.size) { res.end(); return }
  createReadStream(file.full, { start, end }).pipe(res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Open Layout Tool (local) — open http://localhost:${PORT}/ in the browser. Stop with Ctrl+C.`)
})
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is taken — start with another one: node serve.mjs 8081` : err.message)
  process.exit(1)
})
