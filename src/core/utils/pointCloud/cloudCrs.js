import { transformPlanePoint } from '../coordinateUtils'
import { invertMatrix } from './registration'

/**
 * Coordinate systems around a point cloud.
 *
 * The tiles are kept in the plane of the project's tracks, so a cross section
 * reads them without converting anything. A delivery comes in whatever system
 * the surveyor chose (Entscheidung 118), so the import converts — some
 * hundreds of millions of points, each of which would cost a proj4 call with
 * an NTv2 grid behind it.
 *
 * Between two conformal planes the conversion is smooth to the millimetre over
 * a few hundred metres, so it is replaced by an **affine map per cell** of
 * CELL metres: the exact conversion of the cell's centre plus its Jacobian,
 * taken by central differences. Measured against proj4 the remaining error
 * is far under a millimetre (test), well inside the millimetre the files are
 * stated in.
 */

const CELL = 250
const H = CELL / 2

/**
 * `(e, n) → [e', n']` from plane `fromCrs` into `toCrs` (EPSG codes). The
 * same plane on both sides gives the identity.
 */
export function planeMapper(fromCrs, toCrs) {
  if (Number(fromCrs) === Number(toCrs)) return (e, n) => [e, n]
  const exact = (e, n) => transformPlanePoint(e, n, fromCrs, toCrs)
  const cells = new Map()
  const cellAt = (ci, cj) => {
    const key = ci * 1e6 + cj
    let c = cells.get(key)
    if (!c) {
      const ce = (ci + 0.5) * CELL, cn = (cj + 0.5) * CELL
      const [e0, n0] = exact(ce, cn)
      const [ee1, ne1] = exact(ce + H, cn), [ee2, ne2] = exact(ce - H, cn)
      const [en1, nn1] = exact(ce, cn + H), [en2, nn2] = exact(ce, cn - H)
      c = {
        ce, cn, e0, n0,
        dee: (ee1 - ee2) / CELL, dne: (ne1 - ne2) / CELL,
        den: (en1 - en2) / CELL, dnn: (nn1 - nn2) / CELL,
      }
      cells.set(key, c)
    }
    return c
  }
  return (e, n) => {
    const c = cellAt(Math.floor(e / CELL), Math.floor(n / CELL))
    const de = e - c.ce, dn = n - c.cn
    return [c.e0 + c.dee * de + c.den * dn, c.n0 + c.dne * de + c.dnn * dn]
  }
}

/**
 * The plane a cloud's points are read in: that of its re-referencing where it
 * has one (decision 211), its own otherwise — null for a cloud in a local
 * system that has none yet (decision 214).
 */
export const cloudPlane = (cloud) => cloud?.transform?.crs ?? cloud?.crs ?? null

/**
 * The chain a cloud's points are read through into plane `crs` (AP 13.13):
 * the file's plane carried into the plane of its re-referencing T, then T,
 * then on into `crs` — `(e, n, z) → [e, n, z]`. Without T the plane alone.
 * null where nothing is to be done.
 */
export function cloudToPlane(cloud, crs) {
  const t = cloud.transform
  if (!t) return Number(cloud.crs) === Number(crs) ? null : planeOnly(planeMapper(cloud.crs, crs))
  const pre = cloud.crs != null && Number(cloud.crs) !== Number(t.crs) ? planeMapper(cloud.crs, t.crs) : null
  const post = Number(t.crs) !== Number(crs) ? planeMapper(t.crs, crs) : null
  const m = t.matrix
  return (e, n, z) => {
    if (pre) [e, n] = pre(e, n)
    let x = m[0] * e + m[1] * n + m[2] * z + m[3]
    let y = m[4] * e + m[5] * n + m[6] * z + m[7]
    const h = m[8] * e + m[9] * n + m[10] * z + m[11]
    if (post) [x, y] = post(x, y)
    return [x, y, h]
  }
}

/** The same chain the other way, from plane `crs` into the cloud's file; null where nothing is to be done. */
export function planeToCloud(cloud, crs) {
  const t = cloud.transform
  if (!t) return Number(cloud.crs) === Number(crs) ? null : planeOnly(planeMapper(crs, cloud.crs))
  const pre = Number(t.crs) !== Number(crs) ? planeMapper(crs, t.crs) : null
  const post = cloud.crs != null && Number(cloud.crs) !== Number(t.crs) ? planeMapper(t.crs, cloud.crs) : null
  const m = invertMatrix(t.matrix)
  return (e, n, z) => {
    if (pre) [e, n] = pre(e, n)
    let x = m[0] * e + m[1] * n + m[2] * z + m[3]
    let y = m[4] * e + m[5] * n + m[6] * z + m[7]
    const h = m[8] * e + m[9] * n + m[10] * z + m[11]
    if (post) [x, y] = post(x, y)
    return [x, y, h]
  }
}

const planeOnly = (map) => (e, n, z) => { const [x, y] = map(e, n); return [x, y, z] }
