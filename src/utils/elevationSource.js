// Ground heights, independent of which basemap the map is showing. In the
// automatic choice the best source that has a point answers it:
//
// 1. The Länder's DGM1 (1 m grid, laser scan) — Thüringen, Sachsen, Berlin,
//    Brandenburg, Bayern, Baden-Württemberg and Nordrhein-Westfalen, the ones
//    whose tiles can be had at a fixed URL. The Länder publish them as tiles a
//    page cannot read (no CORS header, megabytes each), so the service reads
//    them and answers points (terrainOnServer). Only points in those Länder
//    are sent at all.
// 2. DGM5 (BKG, Germany, 5 m grid), served as terrain-RGB tiles up to zoom 15,
//    about 3 m per pixel.
// 3. The worldwide MapTiler terrain tiles (zoom 12, ~20 m per pixel).
//
// A source can also be chosen outright (TERRAIN_SOURCES); then only it is
// asked, and a point it has no height for stays without one.
//
// The two tile sources use the Mapbox encoding:
//   height = -10000 + (R·65536 + G·256 + B) · 0.1   [m]
// and encode "no data" as exactly 0 m (DGM5 ends at the border, the world
// tiles at the coast), which real ground never reads as.
//
// The height systems differ (DHHN2016, DHHN92, EGM96 for the world tiles) by
// far less than any of these resolve against a track's gradient; the app
// treats them all as the height system of its tracks.

import { terrainOnServer } from './optimizerService'
import { loadSettings } from './settings'

/** The choices of terrain source, the first the default. */
export const TERRAIN_SOURCES = ['auto', 'dgm1', 'dgm5', 'maptiler']
export const DEFAULT_TERRAIN_SOURCE = 'auto'

/** The terrain source the user chose (kept with the settings), or the automatic one. */
export function chosenTerrainSource() {
  const s = loadSettings().terrainSource
  return TERRAIN_SOURCES.includes(s) ? s : DEFAULT_TERRAIN_SOURCE
}

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

async function sampleDgm1(lngLats, timeoutMs) {
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

const SOURCES = [
  { id: 'dgm5',    zoom: 15, url: (z, x, y) => `https://sg.geodatenzentrum.de/gdz_basemapde_3d_gelaende/dgm5_rgb_tiles/${z}/${x}/${y}.png` },
  { id: 'terrain', zoom: 12, url: (z, x, y) => `https://api.maptiler.com/tiles/terrain-rgb/${z}/${x}/${y}.png?key=QojDLOuI2wG4mNbHjzA7` },
]
const TILE_CACHE_MAX = 256
const FETCH_CONCURRENCY = 6

const tileCache = new Map()   // key → { data: Uint8ClampedArray, w: number } | null (no tile)

/** Fractional tile coordinates of a WGS84 point at a zoom level. (exported for tests) */
function tileCoords([lng, lat], z) {
  const n = 2 ** z
  const r = lat * Math.PI / 180
  return {
    x: (lng + 180) / 360 * n,
    y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n,
  }
}

async function loadTile(source, z, x, y) {
  const key = `${source.id}/${z}/${x}/${y}`
  if (tileCache.has(key)) return tileCache.get(key)
  let tile = null
  try {
    const res = await fetch(source.url(z, x, y))
    if (res.ok) {
      const bitmap = await createImageBitmap(await res.blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bitmap, 0, 0)
      tile = { data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, w: bitmap.width }
      bitmap.close?.()
    }
  } catch {
    tile = null
  }
  if (tileCache.size >= TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value)
  tileCache.set(key, tile)
  return tile
}

const decode = (data, i) => -10000 + (data[i] * 65536 + data[i + 1] * 256 + data[i + 2]) * 0.1

/**
 * Height at fractional tile coordinates, bilinear between the four nearest
 * pixels (clamped at the tile edge). null when any of them is "no data".
 */
function heightInTile(tile, fx, fy) {
  const { data, w } = tile
  const px = Math.min(Math.max(fx * w - 0.5, 0), w - 1)
  const py = Math.min(Math.max(fy * w - 0.5, 0), w - 1)
  const x0 = Math.floor(px), y0 = Math.floor(py)
  const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, w - 1)
  const tx = px - x0, ty = py - y0
  const h = (x, y) => decode(data, (y * w + x) * 4)
  const h00 = h(x0, y0), h10 = h(x1, y0), h01 = h(x0, y1), h11 = h(x1, y1)
  if ([h00, h10, h01, h11].some(v => v === 0)) return null
  return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty
}

async function sampleFrom(source, lngLats) {
  const jobs = lngLats.map(p => {
    if (!p) return null
    const { x, y } = tileCoords(p, source.zoom)
    return { tx: Math.floor(x), ty: Math.floor(y), fx: x - Math.floor(x), fy: y - Math.floor(y) }
  })
  const keys = [...new Set(jobs.filter(Boolean).map(j => `${j.tx}/${j.ty}`))]
  const tiles = new Map()
  // A few tiles at a time — a long line touches dozens.
  for (let i = 0; i < keys.length; i += FETCH_CONCURRENCY) {
    await Promise.all(keys.slice(i, i + FETCH_CONCURRENCY).map(async k => {
      const [tx, ty] = k.split('/').map(Number)
      tiles.set(k, await loadTile(source, source.zoom, tx, ty))
    }))
  }
  return jobs.map(j => {
    if (!j) return null
    const tile = tiles.get(`${j.tx}/${j.ty}`)
    return tile ? heightInTile(tile, j.fx, j.fy) : null
  })
}

/**
 * Ground height [m] for each WGS84 point, with the dataset that answered it.
 * `source` is one of TERRAIN_SOURCES: 'auto' asks the Länder's DGM1, then
 * DGM5, then the worldwide terrain tiles, each for what the one before had no
 * height for; the others ask only the source they name. Null for both where
 * none has a height. Heights come back rounded to the centimetre. `sources`
 * name the dataset — 'dgm1-th 2020-2025', 'dgm1-by' and the like from the
 * service, 'dgm5', 'terrain'.
 */
export async function sampleHeightsWithSource(lngLats, { source = DEFAULT_TERRAIN_SOURCE } = {}) {
  const none = { heights: new Array(lngLats.length).fill(null), sources: new Array(lngLats.length).fill(null) }
  const first = source === 'auto' || source === 'dgm1'
    ? await sampleDgm1(lngLats, source === 'dgm1' ? DGM1_WAIT_CHOSEN : DGM1_WAIT_AUTO)
    : none
  let result = first.heights
  const sources = [...first.sources]
  const tiles = source === 'auto' ? SOURCES
    : SOURCES.filter(s => (source === 'dgm5' ? s.id === 'dgm5' : source === 'maptiler' && s.id === 'terrain'))
  let pending = lngLats.map((p, i) => (result[i] == null ? p : null))
  for (const tileSource of tiles) {
    if (!pending.some(Boolean)) break
    const zs = await sampleFrom(tileSource, pending)
    zs.forEach((z, i) => { if (result[i] == null && z != null) sources[i] = tileSource.id })
    result = result.map((z, i) => z ?? zs[i])
    pending = pending.map((p, i) => (result[i] == null ? p : null))
  }
  return { heights: result.map(z => (z == null ? null : Math.round(z * 100) / 100)), sources }
}

/**
 * The dataset a source id names, as a reader knows it: 'dgm1-th 2020-2025' →
 * "DGM1 Thüringen 2020–2025". These are names, not words to translate.
 */
export function terrainSourceLabel(id) {
  if (id === 'dgm5') return 'DGM5 (BKG)'
  if (id === 'terrain') return 'MapTiler Terrain'
  const m = /^dgm1-(\w+)(?: (\d{4})-(\d{4}))?$/.exec(id ?? '')
  if (!m) return id ?? ''
  const land = DGM1_LAENDER[m[1]]?.name ?? m[1].toUpperCase()
  return `DGM1 ${land}${m[2] ? ` ${m[2]}–${m[3]}` : ''}`
}

/** Ground height [m] for each WGS84 point, null where no source has one (see sampleHeightsWithSource). */
export async function sampleHeights(lngLats, options) {
  return (await sampleHeightsWithSource(lngLats, options)).heights
}
