import { trackPointAt } from './planGeometry'
import { trackLength } from './heightUtils'
import { toPlane } from './planSchematic'

/**
 * The location sketch of the title block: the whole network as coarse
 * polylines, and the part a sheet shows picked out on it. A sketch a few
 * centimetres wide needs no more than a point every hundred metres.
 */

/** Spacing of the sketch samples [m]. */
const SKETCH_STEP = 100

/** Every track as a polyline in the plane of `epsg`. */
export function sketchLines(tracks, epsg = tracks.find(tr => tr.epsg)?.epsg) {
  const lines = []
  for (const track of tracks) {
    if (!(track.elements ?? []).length) continue
    const total = trackLength(track)
    const n = Math.max(1, Math.ceil(total / SKETCH_STEP))
    const pts = []
    for (let i = 0; i <= n; i++) {
      const at = trackPointAt(track, total * i / n)
      if (at) pts.push(toPlane(at.point, track.epsg, epsg))
    }
    if (pts.length > 1) lines.push(pts)
  }
  return { epsg, lines }
}

/**
 * The ground a sheet of the site plan covers, as a closed ring of plane
 * points: the drawing area taken back through the sheet's transform.
 */
export function sheetFootprint(sheet, area, pageW, pageH, scaleDen, reserve = 0) {
  const mmPerM = 1000 / scaleDen
  const cx = (pageW - reserve) / 2
  const cy = pageH / 2
  const th = (sheet.rotDeg ?? 0) * Math.PI / 180
  const cos = Math.cos(th)
  const sin = Math.sin(th)
  const back = (px, py) => {
    const rx = (px - cx) / mmPerM
    const ry = (cy - py) / mmPerM
    return [sheet.center.e + rx * cos - ry * sin, sheet.center.n + rx * sin + ry * cos]
  }
  return [
    back(area.x, area.y), back(area.x + area.w, area.y),
    back(area.x + area.w, area.y + area.h), back(area.x, area.y + area.h),
    back(area.x, area.y),
  ]
}
