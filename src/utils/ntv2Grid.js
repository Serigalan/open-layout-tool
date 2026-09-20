import { fromArrayBuffer } from 'geotiff'
import proj4 from 'proj4'

/**
 * The BeTA2007 grid (AdV, official DHDN→ETRS89 transition) — the difference
 * between the 7-parameter Helmert approximation `dhdnProj` falls back to
 * (~1 m, p95) and the roughly 5 cm the plan view needs. The file is the one
 * checked into `grids/` (24 kB, converted by the AdV/PROJ project from the
 * original BETA2007.gsb, open licence) and symlinked into `public/data/` the
 * same way the kilometrage tiles are — `npm run dev`/`build` pick it up
 * without a separate step.
 *
 * proj4 loads a GeoTIFF grid asynchronously, but `projStringFor` is not — so
 * this is awaited once at startup next to `initStorage()` (see main.jsx), and
 * every proj string decides towgs84-vs-nadgrids off `ntv2Ready()` afterwards.
 * A failed load (offline dev server, blocked asset) leaves `ntv2Ready()`
 * false forever: DHDN keeps working at the 1 m fallback rather than the app
 * refusing to start.
 */

export const GRID_KEY = 'BETA2007'

const GRID_URL = import.meta.env.VITE_OLT_NTV2_GRID ?? 'data/de_adv_BETA2007.tif'

let ready = false

export function ntv2Ready() {
  return ready
}

export async function loadNtv2Grid() {
  try {
    const res = await fetch(GRID_URL)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const buffer = await res.arrayBuffer()
    const tiff = await fromArrayBuffer(buffer)
    await proj4.nadgrid(GRID_KEY, tiff).ready
    ready = true
  } catch (err) {
    console.error('BeTA2007 grid did not load — DHDN keeps the 1 m fallback', err)
  }
}
