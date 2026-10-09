/**
 * Re-referencing a point cloud (phase 13, AP 13.12): the spatial Helmert
 * transformation T that carries one cloud onto another, found by least
 * squares from pairs of points picked in both (decision 211).
 *
 * T works in the plane of the reference cloud. A point `src` of the cloud to
 * be fitted is given there already — carried over by planeMapper when its
 * system is known — or in its own local system (decision 214):
 *
 *     T(p) = c + t + s · R · (p − c)
 *
 * with c the centre of the fitted cloud's picked points, t the shift of that
 * centre, R = Rz(κ) · Ry(φ) · Rx(ω) and s the scale. Estimated are always
 * t (east, north, height) and κ, the turn about the vertical; the two tilts
 * ω (about east) and φ (about north) and the scale only when asked for —
 * scanned data are metric, and points along a railway lie nearly in a line
 * and a plane, so the tilts are often poorly determined (decision 212).
 * κ is counted anticlockwise seen from above.
 *
 * A pair is one of
 *
 *   - `kind: '3d'`: picked in the 3D view, three equations (east, north, height);
 *   - `kind: 'section'`: picked in a cross section, two equations — across the
 *     section and height (decision 213). The section shows nothing of the
 *     position along the track; its `bearing` (grid, degrees) says which way
 *     the track ran there.
 *
 * Pairs carry `{ id, kind, ref: [E, N, H], src: [E, N, H], bearing?, on? }`;
 * a pair with `on: false` is left out. Residuals are given across, along and
 * in height — along the pair's bearing, or for a 3D pair without one along
 * the line the pairs lie on.
 */

/** The parameters in the order of the unknowns. */
const PARAMETERS = ['tE', 'tN', 'tH', 'kappa', 'omega', 'phi', 'scale']

/** Normalised residual above which an equation is suspect (two-sided, α = 0.1 %). */
const SUSPECT_W = 3.29

/** The smallest eigenvalue of the scaled normal matrix against the largest below which a parameter counts as undetermined. */
const RANK_TOL = 1e-9
const MAX_ITER = 30

const rad = (deg) => deg * Math.PI / 180

/** A matrix that changes nothing. */
export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Which unknowns are estimated: the four always, tilts and scale on request. */
function estimatedParameters({ tilts = false, scale = false } = {}) {
  return PARAMETERS.filter(p => (p === 'omega' || p === 'phi' ? tilts : p === 'scale' ? scale : true))
}

/** R = Rz(κ) · Ry(φ) · Rx(ω), row-major 3 × 3. */
function rotation(kappa = 0, omega = 0, phi = 0) {
  const [ck, sk, co, so, cp, sp] = [Math.cos(kappa), Math.sin(kappa), Math.cos(omega), Math.sin(omega), Math.cos(phi), Math.sin(phi)]
  const rz = [ck, -sk, 0, sk, ck, 0, 0, 0, 1]
  const ry = [cp, 0, sp, 0, 1, 0, -sp, 0, cp]
  const rx = [1, 0, 0, 0, co, -so, 0, so, co]
  return mul3(rz, mul3(ry, rx))
}

function mul3(a, b) {
  const out = new Array(9)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j]
  return out
}

/**
 * The 4 × 4 matrix (row-major, 16 numbers) of T for `params` about centre
 * `c`: [E', N', H', 1] = M · [E, N, H, 1].
 */
export function transformMatrix(params, c) {
  const { tE = 0, tN = 0, tH = 0, kappa = 0, omega = 0, phi = 0, scale = 0 } = params
  const s = 1 + scale
  const r = rotation(kappa, omega, phi).map(v => v * s)
  const t = [0, 1, 2].map(i => c[i] + [tE, tN, tH][i] - (r[3 * i] * c[0] + r[3 * i + 1] * c[1] + r[3 * i + 2] * c[2]))
  return [r[0], r[1], r[2], t[0], r[3], r[4], r[5], t[1], r[6], r[7], r[8], t[2], 0, 0, 0, 1]
}

/** A point [E, N, H] through a 4 × 4 matrix. */
export function applyMatrix(m, [e, n, h]) {
  return [
    m[0] * e + m[1] * n + m[2] * h + m[3],
    m[4] * e + m[5] * n + m[6] * h + m[7],
    m[8] * e + m[9] * n + m[10] * h + m[11],
  ]
}

/** The inverse of a similarity matrix (scaled rotation plus shift). */
export function invertMatrix(m) {
  const s2 = m[0] * m[0] + m[4] * m[4] + m[8] * m[8]   // the scale squared: a column of sR
  const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]].map(v => v / s2)   // (sR)ᵀ / s² = (sR)⁻¹
  const t = [0, 1, 2].map(i => -(r[3 * i] * m[3] + r[3 * i + 1] * m[7] + r[3 * i + 2] * m[11]))
  return [r[0], r[1], r[2], t[0], r[3], r[4], r[5], t[1], r[6], r[7], r[8], t[2], 0, 0, 0, 1]
}

/** Two matrices one after the other: first `a`, then `b`. */
export function chainMatrices(a, b) {
  const out = new Array(16).fill(0)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) out[4 * i + j] += b[4 * i + k] * a[4 * k + j]
  return out
}

/** The turn of a matrix about the vertical [rad], anticlockwise. */
const matrixKappa = (m) => Math.atan2(m[4], m[0])

/** The unit vectors across (right) and along a grid bearing [degrees]. */
function frame(bearing) {
  const b = rad(bearing)
  return { along: [Math.sin(b), Math.cos(b)], across: [Math.cos(b), -Math.sin(b)] }
}

/** The bearing of the line the points lie on, by their principal horizontal axis [degrees]. */
export function mainBearing(points) {
  if (points.length < 2) return 0
  const me = points.reduce((a, p) => a + p[0], 0) / points.length
  const mn = points.reduce((a, p) => a + p[1], 0) / points.length
  let see = 0, snn = 0, sen = 0
  for (const p of points) { see += (p[0] - me) ** 2; snn += (p[1] - mn) ** 2; sen += (p[0] - me) * (p[1] - mn) }
  const theta = 0.5 * Math.atan2(2 * sen, see - snn)   // from east, anticlockwise
  return ((90 - theta * 180 / Math.PI) % 180 + 180) % 180
}

/**
 * The 2D Helmert transformation (shift, turn, scale left out) from the
 * horizontal positions — the start of the iteration for a cloud in a local
 * system, whose turn may be anything.
 */
function helmert2d(pairs) {
  const n = pairs.length
  const cs = [0, 1].map(i => pairs.reduce((a, p) => a + p.src[i], 0) / n)
  const cr = [0, 1].map(i => pairs.reduce((a, p) => a + p.ref[i], 0) / n)
  let a = 0, b = 0
  for (const p of pairs) {
    const x = p.src[0] - cs[0], y = p.src[1] - cs[1]
    const u = p.ref[0] - cr[0], v = p.ref[1] - cr[1]
    a += x * u + y * v
    b += x * v - y * u
  }
  return Math.atan2(b, a)
}

// ── small dense linear algebra ────────────────────────────────────────────────

/** Eigenvalues and vectors of a symmetric matrix (Jacobi); vectors as columns of `vectors[i][k]`. */
export function symmetricEigen(a) {
  const n = a.length
  const m = a.map(r => r.slice())
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += m[i][j] ** 2
    if (off < 1e-30) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-300) continue
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1), s = t * c
        for (let k = 0; k < n; k++) {
          const mkp = m[k][p], mkq = m[k][q]
          m[k][p] = c * mkp - s * mkq
          m[k][q] = s * mkp + c * mkq
        }
        for (let k = 0; k < n; k++) {
          const mpk = m[p][k], mqk = m[q][k]
          m[p][k] = c * mpk - s * mqk
          m[q][k] = s * mpk + c * mqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  return { values: m.map((r, i) => r[i]), vectors: v }
}

/** The inverse of a symmetric positive definite matrix from its eigen decomposition. */
function inverseFromEigen({ values, vectors }) {
  const n = values.length
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    let s = 0
    for (let k = 0; k < n; k++) s += vectors[i][k] * vectors[j][k] / values[k]
    return s
  }))
}

// ── the adjustment ────────────────────────────────────────────────────────────

/**
 * The equations of the pairs: `rows[k]` says which pair and which component
 * (`'e' | 'n' | 'h' | 'across'`), `f(x)` gives the misclosures for the full
 * parameter vector.
 */
function equations(pairs, centre) {
  const rows = []
  for (const p of pairs) {
    if (p.kind === 'section') {
      rows.push({ pair: p, part: 'across', dir: frame(p.bearing).across })
      rows.push({ pair: p, part: 'h' })
    } else {
      rows.push({ pair: p, part: 'e' }, { pair: p, part: 'n' }, { pair: p, part: 'h' })
    }
  }
  const f = (params) => {
    const m = transformMatrix(params, centre)
    const moved = new Map()
    return rows.map(({ pair, part, dir }) => {
      if (!moved.has(pair)) moved.set(pair, applyMatrix(m, pair.src))
      const q = moved.get(pair)
      const d = [q[0] - pair.ref[0], q[1] - pair.ref[1], q[2] - pair.ref[2]]
      if (part === 'across') return d[0] * dir[0] + d[1] * dir[1]
      return d[part === 'e' ? 0 : part === 'n' ? 1 : 2]
    })
  }
  return { rows, f }
}

const STEP = { tE: 1e-4, tN: 1e-4, tH: 1e-4, kappa: 1e-8, omega: 1e-8, phi: 1e-8, scale: 1e-8 }

/** The Jacobian of `f` at `params` over `names`, by central differences. */
function jacobian(f, params, names) {
  const cols = names.map((name) => {
    const h = STEP[name]
    const up = f({ ...params, [name]: params[name] + h })
    const down = f({ ...params, [name]: params[name] - h })
    return up.map((u, k) => (u - down[k]) / (2 * h))
  })
  return cols[0].map((_, k) => cols.map(c => c[k]))
}

/** What a direction in parameter space that the pairs do not fix stands for. */
function undetermined(vector, names, along) {
  const w = Object.fromEntries(names.map((n, i) => [n, vector[i]]))
  const horizontal = Math.hypot(w.tE ?? 0, w.tN ?? 0)
  const groups = {
    shift: horizontal,
    height: Math.abs(w.tH ?? 0),
    rotation: Math.abs(w.kappa ?? 0),
    tilt: Math.hypot(w.omega ?? 0, w.phi ?? 0),
    scale: Math.abs(w.scale ?? 0),
  }
  const top = Object.entries(groups).sort((a, b) => b[1] - a[1])[0][0]
  if (top !== 'shift') return top
  const alongShare = Math.abs((w.tE ?? 0) * along[0] + (w.tN ?? 0) * along[1]) / (horizontal || 1)
  return alongShare > 0.7 ? 'along' : 'across'
}

/**
 * The adjustment (AP 13.12). `options`: `tilts`, `scale` (decision 212);
 * `start` the matrix in force, where only section pairs are there to go by.
 * Returns `{ ok: true, params, sigmas, centre, matrix, sigma0, rms, max,
 * equations, unknowns, redundancy, residuals }` or `{ ok: false, reason,
 * equations, unknowns }` — reason `'no_pairs' | 'too_few' | 'along' |
 * 'across' | 'height' | 'rotation' | 'tilt' | 'scale'`: which part the pairs
 * do not fix.
 *
 * `params` in metres and radians (scale as s − 1), `sigmas` alike (null
 * without redundancy). Per pair in `residuals`: `{ id, across, along,
 * height, w, suspect }` — the residuals [m] of T(src) − ref (along is null
 * for a section pair), `w` the largest normalised residual of its equations.
 */
export function solveRegistration(allPairs, options = {}) {
  const pairs = allPairs.filter(p => p.on !== false)
  const names = estimatedParameters(options)
  const nEq = pairs.reduce((a, p) => a + (p.kind === 'section' ? 2 : 3), 0)
  const base = { equations: nEq, unknowns: names.length }
  if (!pairs.length) return { ok: false, reason: 'no_pairs', ...base }
  if (nEq < names.length) return { ok: false, reason: 'too_few', ...base }

  const centre = [0, 1, 2].map(i => pairs.reduce((a, p) => a + p.src[i], 0) / pairs.length)
  const refCentre = [0, 1, 2].map(i => pairs.reduce((a, p) => a + p.ref[i], 0) / pairs.length)
  const lineBearing = mainBearing(pairs.map(p => p.ref))
  const { along } = frame(lineBearing)
  // Turns and scale are solved for in metres at the pairs' mean distance from
  // the centre, which puts them on the scale of the shifts.
  const radius = Math.max(1, Math.sqrt(pairs.reduce((a, p) => a + (p.src[0] - centre[0]) ** 2 + (p.src[1] - centre[1]) ** 2
    + (p.src[2] - centre[2]) ** 2, 0) / pairs.length))
  const unit = (name) => (name.startsWith('t') ? 1 : 1 / radius)

  const { rows, f } = equations(pairs, centre)
  // Start: the centres on each other, turned as the horizontal positions say
  // when the pairs are far apart enough to say it.
  const kappa0 = pairs.length >= 2 && radius > 1 ? helmert2d(pairs) : 0
  let params = {
    tE: refCentre[0] - centre[0], tN: refCentre[1] - centre[1], tH: refCentre[2] - centre[2],
    kappa: kappa0, omega: 0, phi: 0, scale: 0,
  }
  // Section pairs alone say nothing along: a shift along that the start put
  // in from points picked a little apart would stay. Their start is the
  // transformation in force (`start`, a matrix) or none, unless 3D pairs are
  // there to place them.
  if (!pairs.some(p => p.kind === '3d')) {
    const m = options.start ?? IDENTITY
    const moved = applyMatrix(m, centre)
    params = { ...params, tE: moved[0] - centre[0], tN: moved[1] - centre[1], tH: moved[2] - centre[2], kappa: matrixKappa(m) }
  }

  let J = null, eig = null
  for (let iter = 0; iter < MAX_ITER; iter++) {
    J = jacobian(f, params, names)
    const v = f(params)
    // N and n in scaled unknowns.
    const u = names.length
    const Js = J.map(r => r.map((x, i) => x * unit(names[i])))
    const N = Array.from({ length: u }, (_, i) => Array.from({ length: u }, (_, j) => Js.reduce((a, r) => a + r[i] * r[j], 0)))
    const g = Array.from({ length: u }, (_, i) => Js.reduce((a, r, k) => a + r[i] * v[k], 0))
    eig = symmetricEigen(N)
    const lmax = Math.max(...eig.values)
    const kmin = eig.values.indexOf(Math.min(...eig.values))
    if (!(eig.values[kmin] > lmax * RANK_TOL)) {
      return { ok: false, reason: undetermined(eig.vectors.map(r => r[kmin]), names, along), ...base }
    }
    const Ninv = inverseFromEigen(eig)
    const dxs = Ninv.map(r => -r.reduce((a, x, j) => a + x * g[j], 0))
    const dx = dxs.map((d, i) => d * unit(names[i]))
    names.forEach((name, i) => { params = { ...params, [name]: params[name] + dx[i] } })
    if (Math.max(...dxs.map(Math.abs)) < 1e-10) break
  }

  // The result and its accuracy.
  const v = f(params)
  J = jacobian(f, params, names)
  const u = names.length
  const N = Array.from({ length: u }, (_, i) => Array.from({ length: u }, (_, j) => J.reduce((a, r) => a + r[i] * r[j], 0)))
  const Qxx = inverseFromEigen(symmetricEigen(N))
  const redundancy = nEq - u
  const vv = v.reduce((a, x) => a + x * x, 0)
  const sigma0 = redundancy > 0 ? Math.sqrt(vv / redundancy) : null
  const sigmas = Object.fromEntries(names.map((name, i) => [name, sigma0 != null ? sigma0 * Math.sqrt(Math.max(0, Qxx[i][i])) : null]))
  // Normalised residuals: v / (σ0 √qvv), qvv = 1 − J Qxx Jᵀ on the diagonal.
  const w = J.map((r, k) => {
    let q = 0
    for (let i = 0; i < u; i++) for (let j = 0; j < u; j++) q += r[i] * Qxx[i][j] * r[j]
    const qvv = 1 - q
    return sigma0 && qvv > 1e-9 ? v[k] / (sigma0 * Math.sqrt(qvv)) : null
  })

  const matrix = transformMatrix(params, centre)
  const residuals = pairs.map((p) => {
    const q = applyMatrix(matrix, p.src)
    const d = [q[0] - p.ref[0], q[1] - p.ref[1], q[2] - p.ref[2]]
    const fr = frame(p.bearing ?? lineBearing)
    const ws = rows.map((r, k) => (r.pair === p ? w[k] : undefined)).filter(x => x !== undefined)
    const wMax = ws.some(x => x == null) && ws.every(x => x == null) ? null
      : Math.max(...ws.filter(x => x != null).map(Math.abs))
    return {
      id: p.id,
      across: d[0] * fr.across[0] + d[1] * fr.across[1],
      along: p.kind === 'section' ? null : d[0] * fr.along[0] + d[1] * fr.along[1],
      height: d[2],
      w: wMax,
      suspect: wMax != null && wMax > SUSPECT_W,
    }
  })
  const sizes = residuals.map(r => Math.hypot(r.across, r.along ?? 0, r.height))
  return {
    ok: true,
    params: Object.fromEntries(PARAMETERS.map(n => [n, names.includes(n) ? params[n] : 0])),
    estimated: names,
    sigmas,
    centre,
    matrix,
    sigma0,
    rms: Math.sqrt(vv / nEq),
    max: Math.max(...sizes),
    equations: nEq,
    unknowns: u,
    redundancy,
    residuals,
  }
}
