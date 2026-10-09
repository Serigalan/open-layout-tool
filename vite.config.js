import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Two builds from one codebase (Paket L, decision 277):
//
//   vite build                     the main build: core and server, entry src/main.jsx → dist/
//   vite build --mode standalone   the local build: core alone, entry src/main.local.jsx → dist-local/
//
// The local build never imports src/server, so none of it is in its bundle
// (tools/check-local-bundle.mjs holds it to that). Both take the same
// public/ — the km data, the NTv2 grids, the UIC list (decision 283).
// ("local" itself is no mode name Vite takes: it clashes with .env.local.)
const LOCAL = 'standalone'

/** The page's entry: main.jsx, or main.local.jsx in the local build — before Vite reads the page's scripts. */
const entryFor = (mode) => ({
  name: 'olt-entry',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => (mode === LOCAL ? html.replace('/src/main.jsx', '/src/main.local.jsx') : html),
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // The dev server runs over https because two of the Landesvermessung WMS
  // (Sachsen-Anhalt, Schleswig-Holstein) only answer CORS for https origins —
  // over plain http://localhost the browser drops their tiles. Production is
  // served over https anyway, so this only affects local development.
  plugins: [react(), basicSsl(), entryFor(mode)],
  base: './',
  build: mode === LOCAL ? { outDir: 'dist-local' } : {},
  // The project server (tools/server) answers under /api and the optimizer
  // service (tools/optimizer) under /optimizer on the app's own origin, as both
  // do behind Caddy in production (deploy/templates/Caddyfile). The optimizer
  // itself knows nothing of the prefix, so it is cut off here as there. The
  // local build asks neither.
  server: mode === LOCAL ? {} : {
    proxy: {
      '/api': { target: process.env.OLT_API_TARGET ?? 'http://127.0.0.1:8787' },
      '/optimizer': {
        target: process.env.OLT_OPTIMIZER_TARGET ?? 'http://127.0.0.1:8099',
        rewrite: path => path.replace(/^\/optimizer/, ''),
      },
    },
  },
}))
