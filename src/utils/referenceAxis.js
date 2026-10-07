import { elementPoints } from './commands/reconnect'
import { gradientAt } from './heightUtils'
import { generateId } from './identifierUtils'

// A reference axis (Bestandsachse, Paket V): the axis of a surveyed track as
// points every centimetre, nothing else — its elements are not kept
// (Entscheidung 195). Other tracks and what the connect dialogs would build
// are compared with it (utils/shiftValues).
//
//   { id, name, epsg, heightEpsg | null,
//     source: { tra, gra | null, importedAt },
//     points: { s0, step, count, e0, n0, de, dn, z: null | { i0, z0, dz } } }
//
// Point i lies at station s0 + i·step of the axis (its own stationing, as
// the TRA file has it). Easting, northing and height are whole millimetres,
// each stored as the difference to the point before (Entscheidung 198):
// de[0] = dn[0] = 0, and the k-th height belongs to point i0 + k — a
// gradient may cover less than the stretch read.

/** Spacing of the points [m]. */
const REFERENCE_STEP = 0.01
/** The longest stretch read into a project [m] (Entscheidung 195). */
export const REFERENCE_MAX_LENGTH = 2000

const mm = (v) => Math.round(v * 1000)

/** Differences to the value before, the first against 0 — whole numbers in, whole numbers out. */
function deltas(values) {
  const out = new Array(values.length)
  let prev = 0
  for (let i = 0; i < values.length; i++) { out[i] = values[i] - prev; prev = values[i] }
  return out
}

/**
 * The axis of `elements` (one track's, in the plane `epsg`) every `step` from
 * station `from` to `to`, both counted along the axis from its first element
 * (0 at its start): { offset, e, n } with the stations offset + i·step. Each
 * element is sampled in steps of at most `step` (elementPoints) and the grid
 * read off linearly — between two points a centimetre apart a curve of any
 * radius on a railway departs from its chord by less than a micrometre.
 */
export function sampleAlong(elements, epsg, from, to, step = REFERENCE_STEP) {
  const k0 = Math.ceil(from / step - 1e-9), k1 = Math.floor(to / step + 1e-9)
  const e = [], n = []
  let start = 0
  let k = k0
  for (const el of elements) {
    const len = el.length ?? 0
    const end = start + len
    if (end >= k * step - 1e-9 && start <= k1 * step + 1e-9 && len > 0) {
      const pts = elementPoints(el, epsg, step)
      const m = pts.length - 1
      while (k <= k1 && k * step <= end + 1e-9) {
        const x = Math.min(m, Math.max(0, (k * step - start) / len * m))
        const j = Math.min(m - 1, Math.floor(x)), t = x - j
        e.push(pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t)
        n.push(pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t)
        k++
      }
    }
    start = end
    if (k > k1) break
  }
  return { offset: k0 * step, e, n }
}

/**
 * A reference axis from a Verm.ESN alignment (vermEsnImport buildElements):
 * its `elements` with the station `startStation` the first begins at, the
 * stretch `from`–`to` in that stationing (at most REFERENCE_MAX_LENGTH), and
 * where a gradient came with it, its tangent polygon `gradient` ([{ station,
 * z, rv? }] in the same stationing) and the height system it is stated in.
 */
export function buildReferenceAxis({
  name, epsg, elements, startStation = 0, from, to, gradient = null, heightEpsg = null,
  tra, gra = null, importedAt = new Date().toISOString(), id = generateId(), step = REFERENCE_STEP,
}) {
  if (!(to > from) || to - from > REFERENCE_MAX_LENGTH + 1e-6) throw new Error('reference axis: stretch')
  const { offset, e, n } = sampleAlong(elements, epsg, from - startStation, to - startStation, step)
  if (e.length < 2) throw new Error('reference axis: no points')
  const s0 = startStation + offset
  const em = e.map(mm), nm = n.map(mm)
  const e0 = em[0], n0 = nm[0]
  let z = null
  if (gradient?.length >= 2) {
    const first = gradient[0].station, last = gradient[gradient.length - 1].station
    const hs = []
    let i0 = null
    for (let i = 0; i < e.length; i++) {
      const s = s0 + i * step
      if (s < first - 1e-6 || s > last + 1e-6) { if (i0 != null) break; continue }
      if (i0 == null) i0 = i
      hs.push(mm(gradientAt(gradient, s)))
    }
    if (hs.length >= 2) z = { i0, z0: hs[0], dz: deltas(hs.map(h => h - hs[0])) }
  }
  return {
    id, name, epsg: Number(epsg), heightEpsg: z && heightEpsg ? Number(heightEpsg) : null,
    source: { tra, gra: z ? gra : null, importedAt },
    points: {
      s0: Math.round(s0 * 1000) / 1000, step, count: e.length,
      e0: e0 / 1000, n0: n0 / 1000,
      de: deltas(em.map(v => v - e0)), dn: deltas(nm.map(v => v - n0)),
      z,
    },
  }
}

const decoded = new WeakMap()

/**
 * The points of a reference axis, decoded once per axis object: { s0, step,
 * count, e, n, z } — e, n Float64Array in the plane [m], z a Float64Array
 * with NaN where the axis has no height, or null.
 */
export function referencePoints(axis) {
  const hit = decoded.get(axis)
  if (hit) return hit
  const p = axis.points
  const count = p.de.length
  const e = new Float64Array(count), n = new Float64Array(count)
  let ce = 0, cn = 0
  for (let i = 0; i < count; i++) {
    ce += p.de[i]; cn += p.dn[i]
    e[i] = p.e0 + ce / 1000
    n[i] = p.n0 + cn / 1000
  }
  let z = null
  if (p.z) {
    z = new Float64Array(count).fill(NaN)
    let cz = 0
    for (let k = 0; k < p.z.dz.length; k++) {
      cz += p.z.dz[k]
      z[p.z.i0 + k] = (p.z.z0 + cz) / 1000
    }
  }
  const out = { s0: p.s0, step: p.step, count, e, n, z }
  decoded.set(axis, out)
  return out
}

/** The stations a reference axis covers [m], in its own stationing. */
export function axisRange(axis) {
  const p = axis.points
  return { from: p.s0, to: p.s0 + (p.de.length - 1) * p.step }
}

/** Its points every `every` metres as [[e, n], …] in the plane — for drawing it. */
export function axisOutline(axis, every = 1) {
  const { e, n, count, step } = referencePoints(axis)
  const stride = Math.max(1, Math.round(every / step))
  const out = []
  for (let i = 0; i < count; i += stride) out.push([e[i], n[i]])
  if ((count - 1) % stride) out.push([e[count - 1], n[count - 1]])
  return out
}

/** What is wrong with a stored reference axis, as the field it is in — or null. */
export function referenceAxisDefect(axis) {
  if (!axis?.id) return 'id'
  if (!Number.isFinite(Number(axis.epsg))) return 'epsg'
  const p = axis.points
  if (!p || !Array.isArray(p.de) || !Array.isArray(p.dn) || p.de.length !== p.dn.length || p.de.length < 2) return 'points'
  if (!(p.step > 0) || !Number.isFinite(p.s0) || !Number.isFinite(p.e0) || !Number.isFinite(p.n0)) return 'points'
  if ((p.de.length - 1) * p.step > REFERENCE_MAX_LENGTH + 1) return 'length'
  if (p.z && (!Array.isArray(p.z.dz) || !(p.z.i0 >= 0) || p.z.i0 + p.z.dz.length > p.de.length)) return 'z'
  return null
}
