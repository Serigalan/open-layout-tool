import { transitionCantEnds } from '../clothoidUtils'
import { maxSpeedFor } from './cant'

// Speed is designed in 5 km/h steps, like cant is in 5 mm ones.
export const SPEED_STEP = 5

const isTransition = (el) => el.elementType === 2

/**
 * Radius (m) and signed cant (mm) that govern an element's cant physics.
 * An arc carries both itself. Across a transition both ramp, so the tighter end
 * governs — and its cant is the one of the neighbouring element on that side,
 * or the ramp value a cut transition keeps there (transitionCantEnds, the same
 * rule the exchange export uses for the ramp ends). A straight has neither,
 * hence null: no deficiency, no curvature-imposed speed limit.
 */
export function governing(elements, i) {
  const el = elements[i]
  // The radius comes back signed: cant that follows the curve helps, cant
  // against it (a bent switch's second route) adds to the deficiency, so the
  // sign has to survive as far as the deficiency and the speed limit.
  if (el.radius) return { radius: el.radius, cant: el.cant ?? 0 }
  if (isTransition(el)) {
    const r1 = el.r1 ? Math.abs(el.r1) : Infinity   // a null end runs into a straight
    const r2 = el.r2 ? Math.abs(el.r2) : Infinity
    if (!Number.isFinite(Math.min(r1, r2))) return null
    const ends = transitionCantEnds(elements, i)
    return r1 <= r2
      ? { radius: el.r1, cant: ends.start }
      : { radius: el.r2, cant: ends.end }
  }
  return null
}

/**
 * Every element's speed raised to what its geometry admits. A curved element —
 * an arc, or a transition, where the tighter end governs — is capped by the cant
 * deficiency its radius and cant leave room for, rounded DOWN onto the 5 km/h
 * design step so the limit is never overshot. A straight has no curvature of its
 * own to limit it: it takes the faster of the curves it runs between, looking
 * past any straights in between since those carry no limit either. An element
 * with no curve on either side keeps the speed it had — nothing bounds it.
 *
 * `cap` is the line speed, the ceiling nothing may exceed. It is applied last,
 * so it also trims an element the geometry leaves unbounded; null means the
 * geometry alone decides. Elements that keep their speed are returned as they
 * are.
 */
export function maxSpeeds(elements, cap) {
  // Pass one: the curves. null marks an element the curvature does not limit.
  const curved = elements.map((el, i) => {
    const g = governing(elements, i)
    if (!g) return null
    const v = maxSpeedFor(el, g.radius, g.cant)
    return v == null ? null : Math.floor(v / SPEED_STEP) * SPEED_STEP
  })

  // Pass two: the straights, from the nearest curve on either side.
  return elements.map((el, i) => {
    let v = curved[i]
    if (v == null) {
      for (let j = i - 1; j >= 0; j--) if (curved[j] != null) { v = curved[j]; break }
      for (let j = i + 1; j < elements.length; j++) if (curved[j] != null) { v = Math.max(v ?? 0, curved[j]); break }
    }
    // Nothing bounds this one: it keeps its speed, and only the cap may trim it.
    if (v == null) return cap != null && el.speed > cap ? { ...el, speed: cap } : el
    const speed = cap == null ? v : Math.min(v, cap)
    return el.speed === speed ? el : { ...el, speed }
  })
}
