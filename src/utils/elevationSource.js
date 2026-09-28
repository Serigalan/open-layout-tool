// Ground heights, independent of which basemap the map is showing — the best
// source that has a point answers it:
//
// 1. The Länder's DGM1 (1 m grid, laser scan), so far Thüringen. The Länder
//    publish it as zipped kilometre tiles a page cannot read (no CORS header,
//    5 MB each), so the service reads them and answers points (terrainOnServer).
//    Only points in the Länder it knows are sent at all.
// 2. DGM5 (BKG, Germany, 5 m grid), served as terrain-RGB tiles up to zoom 15,
//    about 3 m per pixel.
// 3. The worldwide MapTiler terrain tiles (zoom 12, ~20 m per pixel).
//
// The two tile sources use the Mapbox encoding:
//   height = -10000 + (R·65536 + G·256 + B) · 0.1   [m]
// and encode "no data" as exactly 0 m (DGM5 ends at the border, the world
// tiles at the coast), which real ground never reads as.
//
// The height systems differ (DHHN2016, DHHN92, EGM96 for the world tiles) by
// far less than any of these resolve against a track's gradient; the app
// treats them all as the height system of its tracks.

import { wgs84ToUTM } from './coordinateUtils'
import { terrainOnServer } from './optimizerService'

/**
 * The Länder the service has a DGM1 for, as a WGS84 box around each — a coarse
 * test so a point far away is not sent at all. The service answers null for a
 * point inside the box but outside the Land.
 */
const DGM1_LAENDER = [
  { id: 'th', box: [9.85, 50.17, 12.68, 51.68] },   // Thüringen, EPSG:25832 tiles
]
const DGM1_CHUNK = 5000

const inDgm1 = ([lng, lat]) =>
  DGM1_LAENDER.some(({ box: [w, s, e, n] }) => lng >= w && lng <= e && lat >= s && lat <= n)

async function sampleDgm1(lngLats) {
  const idx = lngLats.map((p, i) => (p && inDgm1(p) ? i : -1)).filter(i => i >= 0)
  const heights = new Array(lngLats.length).fill(null)
  const sources = new Array(lngLats.length).fill(null)
  for (let i = 0; i < idx.length; i += DGM1_CHUNK) {
    const part = idx.slice(i, i + DGM1_CHUNK)
    const points = part.map(k => {
      const { easting, northing } = wgs84ToUTM(lngLats[k], 25832)
      return [Math.round(easting * 100) / 100, Math.round(northing * 100) / 100]
    })
    const answer = await terrainOnServer(points)
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
export function tileCoords([lng, lat], z) {
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
export function heightInTile(tile, fx, fy) {
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
 * Ground height [m] for each WGS84 point, with the dataset that answered it:
 * the Länder's DGM1 where the service has one, DGM5 where it has data, the
 * worldwide terrain tiles elsewhere; null for both where none has any. Heights
 * come back rounded to the centimetre. `sources` name the dataset —
 * 'dgm1-th 2020-2025' and the like from the service, 'dgm5', 'terrain'.
 */
export async function sampleHeightsWithSource(lngLats) {
  const dgm1 = await sampleDgm1(lngLats)
  let result = dgm1.heights
  const sources = [...dgm1.sources]
  let pending = lngLats.map((p, i) => (result[i] == null ? p : null))
  for (const source of SOURCES) {
    if (!pending.some(Boolean)) break
    const zs = await sampleFrom(source, pending)
    zs.forEach((z, i) => { if (result[i] == null && z != null) sources[i] = source.id })
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
  const land = { th: 'Thüringen' }[m[1]] ?? m[1].toUpperCase()
  return `DGM1 ${land}${m[2] ? ` ${m[2]}–${m[3]}` : ''}`
}

/** Ground height [m] for each WGS84 point, null where no source has one (see sampleHeightsWithSource). */
export async function sampleHeights(lngLats) {
  return (await sampleHeightsWithSource(lngLats)).heights
}
