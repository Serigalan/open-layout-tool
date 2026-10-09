import { describe, it, expect } from 'vitest'
import {
  solveRegistration, transformMatrix, applyMatrix, invertMatrix, chainMatrices, symmetricEigen, mainBearing, IDENTITY,
} from './registration'

/** A small deterministic noise source. */
function noise(seed = 3) {
  let s = seed
  return (amp) => {
    s = (s * 16807) % 2147483647
    return ((s / 2147483647) * 2 - 1) * amp
  }
}

const E0 = 4467335, N0 = 5333806, H0 = 508

/**
 * Points along a track: a straight line at `bearing` [deg], or with `radius`
 * a curve to the right, every `step` m over `length`; each station with a
 * point on the left and the right rail head and, every `posts` m, a mast top
 * 3.5 m beside it and 6 m up.
 */
function trackPoints({ bearing = 110, radius = null, length = 200, step = 50, posts = 100 } = {}) {
  const out = []
  for (let s = 0; s <= length + 1e-9; s += step) {
    let e, n, b
    if (radius) {
      const turn = s / radius
      const b0 = bearing * Math.PI / 180
      // a curve to the right: the bearing grows
      e = E0 + radius * (Math.cos(b0) - Math.cos(b0 + turn))
      n = N0 + radius * (Math.sin(b0 + turn) - Math.sin(b0))
      b = bearing + turn * 180 / Math.PI
    } else {
      e = E0 + s * Math.sin(bearing * Math.PI / 180)
      n = N0 + s * Math.cos(bearing * Math.PI / 180)
      b = bearing
    }
    const r = [Math.cos(b * Math.PI / 180), -Math.sin(b * Math.PI / 180)]
    const h = H0 + s * 0.002
    out.push({ station: s, bearing: b, side: 'left', p: [e - 0.75 * r[0], n - 0.75 * r[1], h] })
    out.push({ station: s, bearing: b, side: 'right', p: [e + 0.75 * r[0], n + 0.75 * r[1], h] })
    if (posts && Math.abs(s % posts) < 1e-9) out.push({ station: s, bearing: b, side: 'mast', p: [e + 3.5 * r[0], n + 3.5 * r[1], h + 6] })
  }
  return out
}

/**
 * The cloud to be fitted, made from the reference by the inverse of a known
 * T: src = T⁻¹(ref) + noise. A section pair's source point is moved along
 * the track by up to 4 cm — the slice is 10 cm thick.
 */
function pairsFor(points, truth, { amp = 0.002, kinds = () => 'section', seed = 3 } = {}) {
  const rnd = noise(seed)
  const inv = invertMatrix(truth)
  return points.map((q, k) => {
    const kind = kinds(q, k)
    const b = q.bearing * Math.PI / 180
    const slide = kind === 'section' ? rnd(0.04) : 0
    const ref = q.p
    const src = applyMatrix(inv, [ref[0] + Math.sin(b) * slide, ref[1] + Math.cos(b) * slide, ref[2]])
    return { id: `P${k + 1}`, kind, bearing: q.bearing, ref, src: src.map(x => x + rnd(amp)) }
  })
}

// The acceptance of AP 13.15: 0.30 m, 0.8 mrad, +0.05 m.
const TRUE = { tE: 0.3 * Math.sin(110 * Math.PI / 180), tN: 0.3 * Math.cos(110 * Math.PI / 180), tH: 0.05, kappa: 0.0008 }
const centreOf = (pairs) => [0, 1, 2].map(i => pairs.reduce((a, p) => a + p.src[i], 0) / pairs.length)

describe('matrices', () => {
  it('invert, chain and apply', () => {
    const m = transformMatrix({ tE: 1, tN: -2, tH: 0.5, kappa: 0.3, omega: 0.01, phi: -0.02, scale: 2e-5 }, [E0, N0, H0])
    const p = [E0 + 12.3, N0 - 4.5, H0 + 1]
    const back = applyMatrix(invertMatrix(m), applyMatrix(m, p))
    back.forEach((x, i) => expect(x).toBeCloseTo(p[i], 8))
    chainMatrices(m, invertMatrix(m)).forEach((x, i) => expect(x).toBeCloseTo(IDENTITY[i], 9))
    expect(applyMatrix(m, [E0, N0, H0])).toEqual([E0 + 1, N0 - 2, H0 + 0.5].map(x => expect.closeTo(x, 8)))
  })

  it('eigen decomposition of a symmetric matrix', () => {
    const { values, vectors } = symmetricEigen([[4, 1, 0], [1, 3, 1], [0, 1, 2]])
    for (let k = 0; k < 3; k++) {
      const v = vectors.map(r => r[k])
      const av = [[4, 1, 0], [1, 3, 1], [0, 1, 2]].map(r => r.reduce((a, x, i) => a + x * v[i], 0))
      av.forEach((x, i) => expect(x).toBeCloseTo(values[k] * v[i], 10))
    }
  })

  it('the bearing of points along a line', () => {
    expect(mainBearing(trackPoints({ bearing: 110 }).map(q => q.p))).toBeCloseTo(110, 0)
    expect(mainBearing(trackPoints({ bearing: 20 }).map(q => q.p))).toBeCloseTo(20, 0)
  })
})

describe('solveRegistration (AP 13.12)', () => {
  it('finds a known transformation from section pairs on a curve and one mast as 3D pair', () => {
    const pts = trackPoints({ radius: 1200, length: 200, step: 50, posts: 1000 })
    const masts = trackPoints({ radius: 1200, length: 200, step: 100, posts: 100 }).filter(q => q.side === 'mast')
    const all = [...pts, masts[1]]
    const probe = pairsFor(all, IDENTITY)
    const truth = transformMatrix(TRUE, centreOf(probe))
    const pairs = pairsFor(all, truth, { kinds: (q) => (q.side === 'mast' ? '3d' : 'section') })
    const r = solveRegistration(pairs)
    expect(r.ok).toBe(true)
    expect(r.params.kappa).toBeCloseTo(TRUE.kappa, 4)
    expect(Math.abs(r.params.kappa - TRUE.kappa)).toBeLessThan(0.0001)
    // The parameters on 5 mm (AP 13.15), each.
    const c = r.centre
    const moved = applyMatrix(r.matrix, c), want = applyMatrix(truth, c)
    moved.forEach((x, i) => expect(Math.abs(x - want[i])).toBeLessThan(0.005))
    expect(r.max).toBeLessThan(0.02)
    expect(r.residuals.every(x => !x.suspect)).toBe(true)
    expect(r.sigma0).toBeLessThan(0.01)
    expect(r.sigmas.tE).toBeGreaterThan(0)
    expect(r.residuals.find(x => x.id === pairs[0].id).along).toBeNull()
  })

  it('on a straight line section pairs alone leave the shift along undetermined — and say so', () => {
    const pts = trackPoints({ bearing: 110, length: 200, step: 50, posts: 0 })
    const probe = pairsFor(pts, IDENTITY)
    const pairs = pairsFor(pts, transformMatrix(TRUE, centreOf(probe)))
    expect(solveRegistration(pairs)).toMatchObject({ ok: false, reason: 'along' })
    // A mast picked in 3D fixes it.
    const mast = trackPoints({ bearing: 110, length: 100, step: 100, posts: 100 }).filter(q => q.side === 'mast')[0]
    const all = [...pts, mast]
    const probe2 = pairsFor(all, IDENTITY)
    const truth = transformMatrix(TRUE, centreOf(probe2))
    const r = solveRegistration(pairsFor(all, truth, { kinds: (q) => (q.side === 'mast' ? '3d' : 'section') }))
    expect(r.ok).toBe(true)
    const c = r.centre
    applyMatrix(r.matrix, c).forEach((x, i) => expect(Math.abs(x - applyMatrix(truth, c)[i])).toBeLessThan(0.005))
    expect(Math.abs(r.params.kappa - TRUE.kappa)).toBeLessThan(0.0001)
  })

  it('too few equations, and tilts the pairs cannot fix', () => {
    const pts = trackPoints({ bearing: 110, length: 200, step: 100, posts: 0 })
    const pairs = pairsFor(pts, IDENTITY, { kinds: () => '3d' })
    expect(solveRegistration(pairs.slice(0, 1))).toMatchObject({ ok: false, reason: 'too_few', equations: 3, unknowns: 4 })
    expect(solveRegistration([])).toMatchObject({ ok: false, reason: 'no_pairs' })
    // Points on one straight line say nothing of the roll about it.
    const line = pairsFor(pts.filter(q => q.side === 'left'), IDENTITY, { kinds: () => '3d' })
    expect(solveRegistration(line, { tilts: true })).toMatchObject({ ok: false, reason: 'tilt' })
  })

  it('finds an outlier by its normalised residual', () => {
    const pts = trackPoints({ radius: 800, length: 300, step: 30, posts: 100 })
    const probe = pairsFor(pts, IDENTITY)
    const truth = transformMatrix(TRUE, centreOf(probe))
    const pairs = pairsFor(pts, truth, { kinds: (q) => (q.side === 'mast' ? '3d' : 'section') })
    pairs[7] = { ...pairs[7], src: [pairs[7].src[0], pairs[7].src[1], pairs[7].src[2] + 0.08] }
    const r = solveRegistration(pairs)
    expect(r.ok).toBe(true)
    const worst = [...r.residuals].sort((a, b) => b.w - a.w)[0]
    expect(worst.id).toBe(pairs[7].id)
    expect(worst.suspect).toBe(true)
    // Switched off, the rest fits.
    const again = solveRegistration(pairs.map((p, k) => (k === 7 ? { ...p, on: false } : p)))
    expect(again.residuals.some(x => x.suspect)).toBe(false)
    expect(again.max).toBeLessThan(0.02)
  })

  it('brings a cloud in a local system across from 3D pairs, whatever its turn', () => {
    const pts = trackPoints({ radius: 1500, length: 300, step: 60, posts: 60 })
    // A scanner's own system: around (0, 0, 0), turned by 1.9 rad.
    const local = transformMatrix({ tE: -E0, tN: -N0, tH: -H0, kappa: 1.9 }, [E0, N0, H0])
    const truth = invertMatrix(local)
    const pairs = pairsFor(pts, truth, { kinds: () => '3d', amp: 0.003 })
    expect(Math.abs(pairs[0].src[0])).toBeLessThan(500)
    const r = solveRegistration(pairs)
    expect(r.ok).toBe(true)
    expect(r.params.kappa).toBeCloseTo(-1.9, 3)
    for (const p of pairs) applyMatrix(r.matrix, p.src).forEach((x, i) => expect(Math.abs(x - p.ref[i])).toBeLessThan(0.02))
  })

  it('estimates the scale and the tilts where asked for and the pairs fix them', () => {
    const pts = trackPoints({ radius: 600, length: 400, step: 40, posts: 40 })
    const probe = pairsFor(pts, IDENTITY)
    const truthParams = { ...TRUE, omega: 0.0004, phi: -0.0003, scale: 3e-5 }
    const truth = transformMatrix(truthParams, centreOf(probe))
    const pairs = pairsFor(pts, truth, { kinds: () => '3d', amp: 0.0005 })
    const r = solveRegistration(pairs, { tilts: true, scale: true })
    expect(r.ok).toBe(true)
    expect(r.estimated).toEqual(['tE', 'tN', 'tH', 'kappa', 'omega', 'phi', 'scale'])
    expect(r.params.scale).toBeCloseTo(3e-5, 5)
    expect(r.params.omega).toBeCloseTo(0.0004, 4)
    expect(r.params.phi).toBeCloseTo(-0.0003, 4)
  })

  it('section pairs alone: undetermined on one arc (a turn about its centre), fixed by a straight beside it', () => {
    const arc = trackPoints({ radius: 900, length: 300, step: 30, posts: 0 })
    const probe = pairsFor(arc, IDENTITY)
    expect(solveRegistration(pairsFor(arc, transformMatrix(TRUE, centreOf(probe))))).toMatchObject({ ok: false, reason: 'along' })
    // A straight and an arc, as at a curve's end; the start is the transformation in force.
    const pts = [...trackPoints({ bearing: 110, length: 150, step: 30, posts: 0 }), ...arc]
    const truth = transformMatrix(TRUE, centreOf(pairsFor(pts, IDENTITY)))
    const pairs = pairsFor(pts, truth)
    const r = solveRegistration(pairs, { start: truth })
    expect(r.ok).toBe(true)
    expect(Math.abs(r.params.kappa - TRUE.kappa)).toBeLessThan(0.0001)
    expect(r.residuals.every(x => x.along === null)).toBe(true)
  })

})
