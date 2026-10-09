import { planeMapper } from '../../core/utils/pointCloud/cloudCrs'
import { applyMatrix, IDENTITY } from '../../core/utils/pointCloud/registration'

/**
 * Where a cloud is drawn in the 3D view (AP 13.13). The worker carries the
 * file's points into a *pre* plane, relative to a pre origin near the cloud;
 * a model matrix takes them on into the view:
 *
 *   - a cloud without re-referencing: the pre plane is the view's, the
 *     matrix nothing but the step between the origins — exactly the points
 *     the worker computed, as before;
 *   - a cloud with a re-referencing T (in force, or the one being fitted):
 *     the pre plane is T's, the matrix T followed by the view's plane, taken
 *     as an affine map about the cloud (the same as its plane where T's plane
 *     is the view's). T can then change without a tile being read again.
 *
 * A cloud in a local system has no pre plane — its file is the pre frame.
 */

/** 4 × 4 row-major helpers. */
export function multiply(a, b) {
  const out = new Array(16).fill(0)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) out[4 * i + j] += a[4 * i + k] * b[4 * k + j]
  return out
}
const translation = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]

/** The inverse of an affine 4 × 4 matrix (last row 0 0 0 1). */
export function invertAffine(m) {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  const r = [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ]
  const t = [0, 1, 2].map(k => -(r[3 * k] * m[3] + r[3 * k + 1] * m[7] + r[3 * k + 2] * m[11]))
  return [r[0], r[1], r[2], t[0], r[3], r[4], r[5], t[1], r[6], r[7], r[8], t[2], 0, 0, 0, 1]
}

/** Plane `from` into `to` as an affine map about (e, n): exact there, to the millimetre over a delivery. */
function affineAbout(from, to, e, n) {
  if (from == null || to == null || Number(from) === Number(to)) return IDENTITY
  const map = planeMapper(from, to)
  const H = 50
  const [e0, n0] = map(e, n)
  const [ex1, nx1] = map(e + H, n), [ex2, nx2] = map(e - H, n)
  const [ey1, ny1] = map(e, n + H), [ey2, ny2] = map(e, n - H)
  const a = (ex1 - ex2) / (2 * H), b = (ey1 - ey2) / (2 * H)
  const c = (nx1 - nx2) / (2 * H), d = (ny1 - ny2) / (2 * H)
  return [a, b, 0, e0 - a * e - b * n, c, d, 0, n0 - c * e - d * n, 0, 0, 1, 0, 0, 0, 0, 1]
}

/**
 * The placement of a cloud (`index` of one of its levels: `crs`, `bounds`,
 * `transform`) in a view in plane `viewCrs` (null: the view is the cloud's own
 * frame, the split view of AP 13.13). `transform` overrides the cloud's own —
 * the one being fitted, `{ matrix, crs }`, or null for none.
 *
 * Returns `{ preCrs, preOrigin, matrix, toView, toFile }`: `matrix` (4 × 4,
 * absolute pre plane → absolute view plane), `toView(e, n, z)` a point of the
 * file into the view, `toFile` the way back.
 */
export function cloudPlacement(index, viewCrs, transform = index.transform ?? null) {
  const b = index.bounds
  const centre = [(b.minE + b.maxE) / 2, (b.minN + b.maxN) / 2, (b.minZ + b.maxZ) / 2]
  const own = index.crs ?? null
  let preCrs, matrix
  if (viewCrs == null) {
    // The cloud's own frame: nothing carried, nothing turned.
    preCrs = own
    matrix = IDENTITY
  } else if (!transform) {
    preCrs = viewCrs
    matrix = IDENTITY
  } else {
    preCrs = own == null ? null : transform.crs
    const at = applyMatrix(transform.matrix, own == null ? centre : toPre(own, transform.crs, centre))
    matrix = multiply(affineAbout(transform.crs, viewCrs, at[0], at[1]), transform.matrix)
  }
  const pre = (p) => (own == null || preCrs == null ? p : toPre(own, preCrs, p))
  const c = pre(centre)
  const preOrigin = [Math.round(c[0] / 10) * 10, Math.round(c[1] / 10) * 10, Math.floor(c[2])]
  const back = invertAffine(matrix)
  const fromPre = own == null || preCrs == null || Number(own) === Number(preCrs) ? null : planeMapper(preCrs, own)
  const intoPre = own == null || preCrs == null || Number(own) === Number(preCrs) ? null : planeMapper(own, preCrs)
  return {
    preCrs,
    preOrigin,
    matrix,
    toView: (e, n, z) => {
      const p = intoPre ? [...intoPre(e, n), z] : [e, n, z]
      return applyMatrix(matrix, p)
    },
    toFile: (e, n, z) => {
      const [x, y, h] = applyMatrix(back, [e, n, z])
      return fromPre ? [...fromPre(x, y), h] : [x, y, h]
    },
  }
}

function toPre(from, to, [e, n, z]) {
  if (Number(from) === Number(to)) return [e, n, z]
  const [x, y] = planeMapper(from, to)(e, n)
  return [x, y, z]
}

/** The model matrix of a placement in a view about `origin`: relative pre → relative view. */
export function modelMatrix(place, origin) {
  return multiply(translation(-origin[0], -origin[1], -origin[2]), multiply(place.matrix, translation(...place.preOrigin)))
}
