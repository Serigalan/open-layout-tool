import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  // The dev server runs over https because two of the Landesvermessung WMS
  // (Sachsen-Anhalt, Schleswig-Holstein) only answer CORS for https origins —
  // over plain http://localhost the browser drops their tiles. Production is
  // served over https anyway, so this only affects local development.
  plugins: [react(), basicSsl()],
  base: './',
  // The project server (tools/server) answers under /api and the optimizer
  // service (tools/optimizer) under /optimizer on the app's own origin, as both
  // do behind Caddy in production (deploy/Caddyfile.template). The optimizer
  // itself knows nothing of the prefix, so it is cut off here as there.
  server: {
    proxy: {
      '/api': { target: process.env.OLT_API_TARGET ?? 'http://127.0.0.1:8787' },
      '/optimizer': {
        target: process.env.OLT_OPTIMIZER_TARGET ?? 'http://127.0.0.1:8099',
        rewrite: path => path.replace(/^\/optimizer/, ''),
      },
    },
  },
})
