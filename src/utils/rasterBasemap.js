import maplibregl from 'maplibre-gl'
import { wgs84ToUTM, utmToWgs84 } from './coordinateUtils'
import { makeTransform, MARGIN_MM } from './planExport'

// OpenFreeMap "Positron" — light and grey, the default backdrop for a plan.
// Any MapLibre style the app knows can stand in, an aerial one included.
const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/positron'

const MAX_CANVAS_PX = 4096   // hard cap for both source render and page output
const CELL = 256             // warp granularity in source pixels
const RENDER_TIMEOUT_MS = 20000

/**
 * Render a MapLibre style north-up into an offscreen canvas covering `bounds`.
 * Resolves with { canvas, map, dispose } — the map is kept alive so the caller
 * can use map.unproject during warping; call dispose() when done.
 *
 * @returns {Promise<null | {canvas:HTMLCanvasElement, map:maplibregl.Map, dispose:()=>void}>}
 */
function renderStyleToCanvas(bounds, sizePx, style) {
  return new Promise((resolve) => {
    const div = document.createElement('div')
    div.style.position = 'absolute'
    div.style.left = '-99999px'
    div.style.top = '0'
    div.style.width = `${sizePx}px`
    div.style.height = `${sizePx}px`
    document.body.appendChild(div)

    let map
    try {
      map = new maplibregl.Map({
        container: div,
        style,
        bounds,
        fitBoundsOptions: { padding: 0, animate: false },
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        preserveDrawingBuffer: true,   // required to read pixels back via drawImage
      })
    } catch {
      div.remove()
      resolve(null)
      return
    }

    let settled = false
    const dispose = () => { try { map.remove() } catch { /* noop */ } div.remove() }
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        resolve({ canvas: map.getCanvas(), map, dispose })
      } catch {
        dispose()
        resolve(null)
      }
    }
    // 'idle' fires once all tiles/glyphs are loaded and nothing is pending.
    map.on('idle', finish)
    map.on('error', () => { /* ignore individual tile errors, keep the rest */ })
    // Safety net: capture whatever has rendered if 'idle' never arrives.
    const timer = setTimeout(finish, RENDER_TIMEOUT_MS)
  })
}

/**
 * Build a raster basemap image that lines up with the plan transform.
 *
 * @param {object} p
 * @param {{e:number,n:number}} p.center  UTM centre (same as the plan)
 * @param {string} p.zone     UTM zone
 * @param {number} p.pageW    page width [mm]
 * @param {number} p.pageH    page height [mm]
 * @param {number} p.scaleDen scale denominator
 * @param {number} p.rotDeg   rotation [deg] (same as the plan)
 * @param {string|object} p.style  MapLibre style to render; a plain map by default
 * @returns {Promise<null | {dataUrl, xMm, yMm, wMm, hMm}>}
 */
export async function fetchBasemapImage({
  center, zone, pageW, pageH, scaleDen, rotDeg, style = DEFAULT_STYLE,
}) {
  const drawWmm = pageW - 2 * MARGIN_MM
  const drawHmm = pageH - 2 * MARGIN_MM

  // Page-pixel output resolution (cap the long side).
  let pxPerMm = 150 / 25.4
  pxPerMm = Math.min(pxPerMm, MAX_CANVAS_PX / Math.max(drawWmm, drawHmm))
  const canvasW = Math.round(drawWmm * pxPerMm)
  const canvasH = Math.round(drawHmm * pxPerMm)

  const transform = makeTransform(center, pageW, pageH, scaleDen, rotDeg)

  // Ground half-extent the page covers; the diagonal covers any rotation.
  const mmPerM = 1000 / scaleDen
  const halfWm = (drawWmm / 2) / mmPerM
  const halfHm = (drawHmm / 2) / mmPerM
  const diag = Math.hypot(halfWm, halfHm)
  const utmCorners = [
    [center.e - diag, center.n - diag],
    [center.e + diag, center.n - diag],
    [center.e - diag, center.n + diag],
    [center.e + diag, center.n + diag],
  ]
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity
  for (const [e, n] of utmCorners) {
    const [lon, lat] = utmToWgs84(e, n, zone)
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }

  // Render OpenFreeMap north-up. The ground bbox is roughly square, so a square
  // source canvas keeps resolution even; oversize vs. the page to leave room for
  // the diagonal that rotation can expose.
  const sizePx = Math.min(MAX_CANVAS_PX, Math.round(Math.max(canvasW, canvasH) * 1.5))
  const rendered = await renderStyleToCanvas([[minLon, minLat], [maxLon, maxLat]], sizePx, style)
  if (!rendered) return null
  const { canvas: srcCanvas, map, dispose } = rendered

  try {
    const sw = srcCanvas.width
    const sh = srcCanvas.height
    // The WebGL canvas is in device pixels; unproject expects CSS pixels.
    const dpr = sw / (map.getCanvas().clientWidth || sw)

    const out = document.createElement('canvas')
    out.width = canvasW
    out.height = canvasH
    const ctx = out.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvasW, canvasH)

    // Source canvas pixel (device px) → page drawing-area pixel.
    const toPage = (px, py) => {
      const ll = map.unproject([px / dpr, py / dpr])
      const u = wgs84ToUTM([ll.lng, ll.lat], zone)
      const [mmX, mmY] = transform(u.easting, u.northing)
      return [(mmX - MARGIN_MM) * pxPerMm, (mmY - MARGIN_MM) * pxPerMm]
    }

    // Warp the rendered Mercator image into the rotated UTM page frame, cell by
    // cell so the local affine stays an accurate approximation of UTM↔Mercator.
    for (let sy = 0; sy < sh; sy += CELL) {
      for (let sx = 0; sx < sw; sx += CELL) {
        const cw = Math.min(CELL, sw - sx)
        const ch = Math.min(CELL, sh - sy)
        const d0 = toPage(sx, sy)            // cell origin
        const d1 = toPage(sx + cw, sy)       // +x edge
        const d2 = toPage(sx, sy + ch)       // +y edge
        const d3 = toPage(sx + cw, sy + ch)  // far corner (for the clip quad)
        // Affine mapping full-image source px → page px from three corners.
        const a = (d1[0] - d0[0]) / cw
        const b = (d1[1] - d0[1]) / cw
        const c = (d2[0] - d0[0]) / ch
        const d = (d2[1] - d0[1]) / ch
        const e = d0[0] - a * sx - c * sy
        const f = d0[1] - b * sx - d * sy

        ctx.save()
        // Clip to the cell's destination quad (in identity/page space)...
        ctx.beginPath()
        ctx.moveTo(d0[0], d0[1])
        ctx.lineTo(d1[0], d1[1])
        ctx.lineTo(d3[0], d3[1])
        ctx.lineTo(d2[0], d2[1])
        ctx.closePath()
        ctx.clip()
        // ...then draw the whole source under the cell's affine.
        ctx.setTransform(a, b, c, d, e, f)
        ctx.drawImage(srcCanvas, 0, 0)
        ctx.restore()
      }
    }

    return {
      dataUrl: out.toDataURL('image/png'),
      xMm: MARGIN_MM, yMm: MARGIN_MM, wMm: drawWmm, hMm: drawHmm,
    }
  } finally {
    dispose()
  }
}
