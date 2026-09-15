// Ground heights from terrain-RGB tile services, sampled directly — independent
// of which basemap the map is showing.
//
// DGM5 (BKG, Germany, 5 m grid) is served as terrain-RGB tiles up to zoom 15,
// about 3 m per pixel; outside its coverage the worldwide MapTiler terrain
// tiles (zoom 12, ~20 m per pixel) stand in. Both use the Mapbox encoding:
//   height = -10000 + (R·65536 + G·256 + B) · 0.1   [m]
// and encode "no data" as exactly 0 m (DGM5 ends at the border, the world
// tiles at the coast), which real ground never reads as.

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
 * Ground height [m] for each WGS84 point, from DGM5 where it has data and from
 * the worldwide terrain tiles elsewhere; null where neither has any. Heights
 * come back rounded to the centimetre — the sources resolve a decimetre.
 */
export async function sampleHeights(lngLats) {
  let result = new Array(lngLats.length).fill(null)
  let pending = lngLats
  for (const source of SOURCES) {
    if (!pending.some(Boolean)) break
    const zs = await sampleFrom(source, pending)
    result = result.map((z, i) => z ?? zs[i])
    pending = pending.map((p, i) => (result[i] == null ? p : null))
  }
  return result.map(z => (z == null ? null : Math.round(z * 100) / 100))
}
