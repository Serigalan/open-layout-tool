// Decoding tiles for the 3D view (AP 13.9), off the main thread. Messages in:
//   { type: 'init', base, crs: [[from, to], …], box: [w, s, e, n] }  grids for the conversions
//   { type: 'tile', id, cloud, viewCrs, origin, tx, ty, segs, bytes }
// and out: { type: 'tile', id, count, position, color, intensity } — positions
// as Float32 relative to `origin` in the view's plane (float32 alone would
// leave some half a metre at 4 467 335 / 5 333 806, AP 13.8), colour and
// intensity as bytes; or { type: 'error', id, message }.
import { decodeCloudSegment, segmentPlacement } from '../utils/pointCloud/tiles'
import { planeMapper } from '../utils/pointCloud/cloudCrs'
import { loadNtv2Grid, loadGridsFor } from '../utils/ntv2Grid'
import { crsDatum } from '../utils/coordinateUtils'

let ready = Promise.resolve()
const mappers = new Map()
const mapperFor = (from, to) => {
  const key = `${from}|${to}`
  if (!mappers.has(key)) mappers.set(key, planeMapper(from, to))
  return mappers.get(key)
}

async function init({ base, crs, box }) {
  await loadNtv2Grid({ base })
  const datums = [...new Set(crs.flat().map(crsDatum).filter(Boolean))]
  if (datums.length && box) await loadGridsFor(box, datums, { base })
}

function tile({ id, cloud, viewCrs, origin, tx, ty, segs, bytes }) {
  const count = segs.reduce((n, s) => n + s[0], 0)
  const position = new Float32Array(count * 3)
  const color = cloud.rgb ? new Uint8Array(count * 3) : null
  const intensity = new Uint8Array(count)
  const toView = cloud.crs == null || Number(cloud.crs) === Number(viewCrs) ? null : mapperFor(cloud.crs, viewCrs)
  const [oe, on, oz] = origin
  let k = 0
  segs.forEach(([n, z0], j) => {
    const seg = decodeCloudSegment(cloud, bytes[j], n)
    const { ox, oy, oz: bz, sx, sy, sz } = segmentPlacement(cloud, tx, ty, z0)
    for (let i = 0; i < n; i++, k++) {
      let e = ox + seg.x[i] * sx, nn = oy + seg.y[i] * sy
      if (toView) [e, nn] = toView(e, nn)
      position[3 * k] = e - oe
      position[3 * k + 1] = nn - on
      position[3 * k + 2] = bz + seg.z[i] * sz - oz
      intensity[k] = seg.i[i]
      if (color) { color[3 * k] = seg.r[i]; color[3 * k + 1] = seg.g[i]; color[3 * k + 2] = seg.b[i] }
    }
  })
  const transfer = [position.buffer, intensity.buffer, ...(color ? [color.buffer] : [])]
  self.postMessage({ type: 'tile', id, count, position, color, intensity }, transfer)
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    ready = init(data).catch((err) => console.error('grids for the 3D view did not load', err))
    return
  }
  await ready
  try {
    tile(data)
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, message: String(err?.message ?? err) })
  }
}
