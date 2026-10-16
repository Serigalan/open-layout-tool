import { catalogLimit, severityRank, CANT_DEFICIENCY_COEFF, SPEED_STEP, computeAutoC } from '../rules'

// What a splice can change when the catalogue rejects a curvature jump on the
// stretch it writes (LP.KS.01, Vergleichsradius): the speed at the joint, the
// radius of the arc it inserts, transitions instead of the jump. Each is
// solved again and offered with what remains on it.

const JUMP_RULE = 'LP.KS.01'
const PHYSICS = { u0_factor: CANT_DEFICIENCY_COEFF }
// Radii proposed are rounded up to this step [m]; where the comparison radius
// is not the arc's own (an arc beside an arc), the search grows by RADIUS_GROWTH.
const RADIUS_STEP = 10
const RADIUS_GROWTH = 1.1
const RADIUS_TRIES = 12
// Transitions switched on by a proposal start here, the solver setting the Regellänge.
const TRANSITION_START = 60

const isJumpError = (f) => f.id === JUMP_RULE && severityRank(f.severity) >= severityRank('error')

/** Does a solution (raw or as the dialog reads it) break LP.KS.01? */
export const hasJumpError = (findings = []) => findings.some(isJumpError)

/** The key a raw answer's solution is chosen by — as solutionKey for the dialog's. */
const rawKey = (sol) => `${sol.ends.join()}|${sol.arcJoin ?? ''}`

/** The solution of `answer` joining the same ends as `key`, else its best. */
function matching(answer, key) {
  const sols = answer?.solutions
  if (!sols?.length) return null
  return sols.find(sol => rawKey(sol) === key) ?? sols[0]
}

/** The smallest comparison radius LP.KS.01 lets pass at `v` (its Ermessensgrenze) — null past the table. */
function smallestComparisonRadius(v) {
  try {
    return catalogLimit(JUMP_RULE, 'discretion', {
      'physics.curvature_jump': true, 'prev.design_speed': v, 'next.design_speed': v, 'physics.r_w': 0,
    }, { physics: PHYSICS })
  } catch {
    return null
  }
}

/**
 * Up to three ways out of a curvature jump LP.KS.01 rejects, for the splice
 * `request` (commands/splice spliceRequest) whose solution `key` joins the
 * ends shown (solutionKey) and found `findings` with `elements` — each solved
 * again with `solve` (request → answer, as solveSplice) and kept where the
 * jump no longer is an error:
 *
 * - `speed`: the highest speed in 5 km/h steps below the one at the joint at
 *   which the comparison radius passes — the picked elements and what is
 *   inserted no faster than that;
 * - `radius`: the inserted arc as wide as the comparison radius needs at the
 *   speed of its joints;
 * - `transitions`: transitions at the Regellänge either side, where none were.
 *
 * Each as { kind, speed | radius, request, solution, worst, remaining } —
 * `remaining` what is still worse than a hint on it.
 */
export async function spliceRemedies({ request, key, elements = [], findings = [], solve }) {
  if (!hasJumpError(findings)) return []
  const attempt = async (req) => {
    const sol = matching(await solve(req), key)
    if (!sol || hasJumpError(sol.findings)) return null
    return {
      request: req, solution: sol, worst: sol.worst,
      remaining: sol.findings.filter(f => severityRank(f.severity) > severityRank('hint')),
    }
  }
  const out = []

  // The speed: down from the fastest that takes part.
  const fastest = Math.max(request.dep.speed || 0, request.arr.speed || 0, request.speed || 0)
  for (let v = Math.ceil(fastest / SPEED_STEP) * SPEED_STEP - SPEED_STEP; v >= SPEED_STEP; v -= SPEED_STEP) {
    const slower = (speed) => Math.min(speed || 0, v)
    const found = await attempt({
      ...request,
      dep: { ...request.dep, speed: slower(request.dep.speed) },
      arr: { ...request.arr, speed: slower(request.arr.speed) },
      speed: slower(request.speed),
    })
    if (found) { out.push({ kind: 'speed', speed: v, ...found }); break }
  }

  // The radius of the arc the splice inserts, where a rejected joint is beside it.
  const arcJoints = findings.filter(isJumpError)
    .filter(f => f.index.some(i => elements[i]?.role === 'new' && elements[i]?.elementType === 1))
  if (request.radius > 0 && arcJoints.length) {
    const needed = Math.max(...arcJoints.map(f => smallestComparisonRadius(
      Math.max(...f.index.map(i => elements[i]?.speed || 0)),
    ) ?? Infinity))
    if (Number.isFinite(needed) && needed > request.radius) {
      let r = Math.ceil(needed / RADIUS_STEP) * RADIUS_STEP
      for (let k = 0; k < RADIUS_TRIES; k++) {
        const found = await attempt({ ...request, radius: r })
        if (found) { out.push({ kind: 'radius', radius: r, ...found }); break }
        r = Math.ceil((r * RADIUS_GROWTH) / RADIUS_STEP) * RADIUS_STEP
      }
    }
  }

  // Transitions where there were none — not for one transition from arc to arc.
  const noTransitions = !(request.lDep > 0) && !(request.lArr > 0)
  if (noTransitions && request.arcJoin !== 'transition') {
    const found = await attempt({
      ...request, lDep: TRANSITION_START, lArr: TRANSITION_START, modeDep: 'regular', modeArr: 'regular',
      // With transitions either side the arc takes the Regelüberhöhung, as the
      // dialog then proposes it (Entscheidung 315).
      ...(request.radius > 0 ? { cant: Math.abs(computeAutoC(request.speed, request.radius)) } : {}),
    })
    if (found) out.push({ kind: 'transitions', ...found })
  }
  return out
}
