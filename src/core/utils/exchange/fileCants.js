import { cantEnds, transitionCantEnds, withCantRamp } from '../geometry'
import { cantSign } from '../rules'

// The exchange files (the Verm.ESN TRA, the Gleislage cant CSV) state the cant
// at both ends of every element, relative to the curve it lies in: positive
// raises the outer rail, negative the inner one — a turnout's branch bending
// away from a canted main line. The app keeps it signed by the raised rail
// (rules/cant.js): on an arc or a straight as its one `cant`, or both ends
// where the cant changes along it (withCantRamp) — an element of one radius is
// an arc or a straight, whatever its cant does —, on a transition as
// `cantStart`/`cantEnd` wherever the neighbours do not already state them
// (transitionCantEnds). Where an element has no curve to go by — a straight,
// a ramp between two straights — the side follows from the cant it meets
// (decision 355).

/** Two cants are the same below this [mm] — the model keeps cant to 0.001 mm. */
const SAME = 0.001

const r3 = (v) => Math.round(v * 1000) / 1000 || 0
/** `side` times `value`, never −0. */
const times = (side, value) => side * value || 0

/** The side a curve-relative cant at `end` of `el` raises: ±1, or 0 where the element has no curve. */
function curveSide(el, end) {
  if (el.elementType === 1) return el.radius ? cantSign(el.radius) : 0
  if (el.elementType === 2) {
    const r = end === 'start' ? (el.r1 ?? el.r2) : (el.r2 ?? el.r1)
    return r ? cantSign(r) : 0
  }
  return 0
}

/**
 * The cants of the file, `ends` ([{ start, end }] per element, curve-relative,
 * mm), signed by the raised rail: [{ start, end }] per element.
 *
 * An element without a curve takes the side of the cant it continues: the one
 * before it where it starts canted, else the one after it where it ends so,
 * the file's own sign kept relative to that. Nothing canted next to it either
 * — it stands as the file says.
 */
export function signedCants(elements, ends) {
  const out = elements.map((el, i) => {
    const side = { start: curveSide(el, 'start'), end: curveSide(el, 'end') }
    const { start = 0, end = 0 } = ends[i] ?? {}
    if (!side.start && !side.end) return start || end ? null : { start: 0, end: 0 }
    return { start: times(side.start || side.end, start), end: times(side.end || side.start, end) }
  })
  // A run of straights takes its side one element a pass, from either end.
  for (let pass = 0; pass < elements.length && out.includes(null); pass++) {
    out.forEach((value, i) => {
      if (value) return
      const { start = 0, end = 0 } = ends[i] ?? {}
      const before = out[i - 1]?.end, after = out[i + 1]?.start
      const d = start && before ? Math.sign(before) * Math.sign(start)
        : end && after ? Math.sign(after) * Math.sign(end)
          : null
      if (d) out[i] = { start: times(d, start), end: times(d, end) }
    })
  }
  return out.map((value, i) => value ?? { start: ends[i]?.start ?? 0, end: ends[i]?.end ?? 0 })
}

/**
 * `elements` with the file's cants `ends` (as signedCants reads them) put on
 * them, as new objects: an arc or straight its `cant`, or its two ends where
 * they differ (withCantRamp), and a transition `cantStart`/`cantEnd` wherever
 * its neighbours do not state the same already.
 */
export const withFileCants = (elements, ends) => withSignedCants(elements, signedCants(elements, ends))

/** `elements` with the cants `signed` ([{ start, end }], by the raised rail) put on them, as withFileCants does. */
export function withSignedCants(elements, signed) {
  const out = elements.map((el, i) => {
    if (el.elementType !== 2) return withCantRamp(el, r3(signed[i].start), r3(signed[i].end))
    const { cant: _cant, cantStart: _s, cantEnd: _e, ...rest } = el
    return rest
  })
  return out.map((el, i) => {
    if (el.elementType !== 2) return el
    const implied = transitionCantEnds(out, i)
    const start = r3(signed[i].start), end = r3(signed[i].end)
    return {
      ...el,
      ...(Math.abs(start - implied.start) > SAME ? { cantStart: start } : {}),
      ...(Math.abs(end - implied.end) > SAME ? { cantEnd: end } : {}),
    }
  })
}

/**
 * The cants of `elements` as a file states them: [{ start, end }] per
 * element, relative to the curve each lies in (the inverse of signedCants).
 * An element without a curve is written from the side its own cant raises.
 */
export function fileCants(elements) {
  return elements.map((el, i) => {
    const ends = cantEnds(elements, i)
    const side = { start: curveSide(el, 'start'), end: curveSide(el, 'end') }
    if (!side.start && !side.end) {
      const d = Math.sign(ends.start) || Math.sign(ends.end) || 1
      return { start: times(d, ends.start), end: times(d, ends.end) }
    }
    return { start: times(side.start || side.end, ends.start), end: times(side.end || side.start, ends.end) }
  })
}
