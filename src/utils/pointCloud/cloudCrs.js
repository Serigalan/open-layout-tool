import { transformPlanePoint } from '../coordinateUtils'

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
