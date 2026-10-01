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
  // The project server (tools/server) answers under /api on the app's own
  // origin, as it does behind Caddy in production.
  server: {
    proxy: { '/api': { target: process.env.OLT_API_TARGET ?? 'http://127.0.0.1:8787' } },
  },
})
