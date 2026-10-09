import { terrainOnServer } from './optimizerService'

/**
 * The Länder's DGM1 as a source of ground heights (core/utils/elevationSource.js,
 * extension point `terrainSources`): 1 m grid, laser scan — Thüringen,
 * Sachsen, Berlin, Brandenburg, Bayern, Baden-Württemberg and
 * Nordrhein-Westfalen, the ones whose tiles can be had at a fixed URL. The
 * Länder publish them as tiles a page cannot read (no CORS header, megabytes
 * each), so the optimizer service reads them and answers points
 * (terrainOnServer). Only points in those Länder are sent at all.
 */

/**
 * The Länder the service has a DGM1 for, as a WGS84 box around each — a coarse
 * test so a point far away is not sent at all. The service answers null for a
 * point inside a box but outside the Land. Kept in step with SOURCES in
 * tools/optimizer/olt_optimizer/terrain.py.
 */
const DGM1_LAENDER = {
  th: { name: 'Thüringen',           box: [9.85, 50.17, 12.68, 51.68] },
  sn: { name: 'Sachsen',             box: [11.85, 50.15, 15.05, 51.70] },
  be: { name: 'Berlin',              box: [13.07, 52.33, 13.78, 52.68] },
  bb: { name: 'Brandenburg',         box: [11.25, 51.35, 14.78, 53.57] },
  by: { name: 'Bayern',              box: [8.95, 47.26, 13.85, 50.57] },
  bw: { name: 'Baden-Württemberg',   box: [7.50, 47.53, 10.50, 49.80] },
  nw: { name: 'Nordrhein-Westfalen', box: [5.85, 50.32, 9.47, 52.54] },
}
const DGM1_CHUNK = 5000
// In the automatic choice DGM1 gets this long before DGM5 answers instead —
// a Land's portal can be slow (Brandenburg's hands out 15 kB/s), and the
// service goes on loading the tile, so the next request has it.
const DGM1_WAIT_AUTO = 20000
const DGM1_WAIT_CHOSEN = 180000

const inDgm1 = ([lng, lat]) => Object.values(DGM1_LAENDER)
  .some(({ box: [w, s, e, n] }) => lng >= w && lng <= e && lat >= s && lat <= n)

async function sampleDgm1(lngLats, { chosen = false } = {}) {
  const timeoutMs = chosen ? DGM1_WAIT_CHOSEN : DGM1_WAIT_AUTO
  const idx = lngLats.map((p, i) => (p && inDgm1(p) ? i : -1)).filter(i => i >= 0)
  const heights = new Array(lngLats.length).fill(null)
  const sources = new Array(lngLats.length).fill(null)
  for (let i = 0; i < idx.length; i += DGM1_CHUNK) {
    const part = idx.slice(i, i + DGM1_CHUNK)
    const answer = await terrainOnServer(part.map(k => lngLats[k]), { timeoutMs })
    part.forEach((k, j) => {
      heights[k] = answer.heights[j] ?? null
      sources[k] = heights[k] == null ? null : (answer.sources[j] ?? 'dgm1')
    })
  }
  return { heights, sources }
}

/** 'dgm1-th 2020-2025' → "DGM1 Thüringen 2020–2025", null for an id that is no DGM1. */
function dgm1Label(id) {
  const m = /^dgm1-(\w+)(?: (\d{4})-(\d{4}))?$/.exec(id ?? '')
  if (!m) return null
  const land = DGM1_LAENDER[m[1]]?.name ?? m[1].toUpperCase()
  return `DGM1 ${land}${m[2] ? ` ${m[2]}–${m[3]}` : ''}`
}

export const dgm1Source = { id: 'dgm1', sample: sampleDgm1, label: dgm1Label }
