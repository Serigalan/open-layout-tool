import { planeCoordsToWgs84 } from '../coordinateUtils'
import { cloudPlane, cloudToPlane } from './cloudCrs'

/**
 * Where a point cloud lies, for the map: the outline of the cells of
 * CELL × CELL metres it has points in. A box around a cloud would say little —
 * a survey follows the track, at any angle to the grid, and its box is mostly
 * empty — while the tiles themselves are too many to draw (some 17 500 a
 * kilometre).
 */

const CELL = 10

/**
 * The boundary of the occupied cells as segments `[[e, n], [e, n]]` in the
 * cloud's plane: every cell side whose neighbour across it is empty.
 */
export function outlineSegments(index, cell = CELL) {
  const per = cell / index.tileSize
  const cells = new Set(index.tiles.map(([tx, ty]) => `${Math.floor(tx / per)},${Math.floor(ty / per)}`))
  const segs = []
  for (const key of cells) {
    const [i, j] = key.split(',').map(Number)
    const [e0, n0, e1, n1] = [i * cell, j * cell, (i + 1) * cell, (j + 1) * cell]
    if (!cells.has(`${i},${j - 1}`)) segs.push([[e0, n0], [e1, n0]])
    if (!cells.has(`${i},${j + 1}`)) segs.push([[e0, n1], [e1, n1]])
    if (!cells.has(`${i - 1},${j}`)) segs.push([[e0, n0], [e0, n1]])
    if (!cells.has(`${i + 1},${j}`)) segs.push([[e1, n0], [e1, n1]])
  }
  return segs
}

/**
 * The outline as a GeoJSON feature in WGS84, tagged with the cloud's id. A
 * level of coarse tiles (a server cloud's L2) is outlined in cells of two
 * tiles.
 */
export function outlineFeature(index) {
  return {
    type: 'Feature',
    properties: { cloudId: index.id, name: index.name },
    geometry: {
      type: 'MultiLineString',
      coordinates: placedSegments(index).map(seg => planeCoordsToWgs84(seg, cloudPlane(index))),
    },
  }
}

/** The outline's segments where the cloud is read — through its re-referencing, if it has one. */
function placedSegments(index) {
  const segs = outlineSegments(index, Math.max(CELL, 2 * index.tileSize))
  if (!index.transform) return segs
  const toPlane = cloudToPlane(index, index.transform.crs)
  const z = (index.bounds.minZ + index.bounds.maxZ) / 2
  return segs.map(seg => seg.map(([e, n]) => toPlane(e, n, z).slice(0, 2)))
}

/** Width across and length along the cloud's box [m]. */
export const cloudSize = (index) => [
  index.bounds.maxE - index.bounds.minE,
  index.bounds.maxN - index.bounds.minN,
]
