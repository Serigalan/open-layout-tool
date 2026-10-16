import { checkTrack, severityRank, transitionLengths, SPEED_STEP } from '../rules'

// What "an Gleis anschließen" can change where the rules reject the refitted
// element or its joint (Entscheidung 314) — the splice's suggestions
// (spliceRemedies) as far as they apply here: the speed, and a transition
// before the arc. The arc's radius is no choice: it follows from where the
// turnout or crossing meets the track.

/** Start length of a transition a suggestion puts in; the Regellänge follows [m]. */
const LEAD_START = 60

/** Solves for the transition at its own Regellänge — the arc it meets changes with it. */
const LEAD_ROUNDS = 6

/** What is still worse than a hint on the refitted elements of an outcome (refitOutcome). */
function remainingFindings(outcome) {
  const per = checkTrack(outcome.chain).perElement
  return outcome.judged.flatMap(i => per[i]?.results ?? [])
    .filter(r => severityRank(r.severity) > severityRank('hint'))
}

/** The Regellänge of the transition in an outcome, for the arc it leads into. */
const regularOf = (anchor, o) => transitionLengths({
  prev: o.chain.length > 2 ? o.chain[0] : null, next: o.element, r1: anchor.r0 ?? null, speed: o.element.speed,
}).regular

/**
 * The outcome with a transition at its Regellänge before the arc: a longer
 * transition makes the arc tighter, which asks for a longer one again, so
 * the length is where the Regellänge of the arc it leads into is its own —
 * found by secant steps from LEAD_START. Null where none connects.
 */
function atRegularLead(anchor, current, outcomeFor) {
  const at = (L) => {
    const o = outcomeFor({ ...current, lead: L })
    if (!o?.lead) return null
    const regular = regularOf(anchor, o)
    return { L, o, h: regular > 0 ? regular - L : 0 }
  }
  let a = at(LEAD_START)
  if (!a) return null
  if (Math.abs(a.h) < 0.05) return a.o
  let b = at(LEAD_START + a.h)
  for (let k = 0; b && k < LEAD_ROUNDS && Math.abs(b.h) >= 0.05; k++) {
    const slope = (b.h - a.h) / (b.L - a.L)
    const next = Math.abs(slope) > 1e-9 ? b.L - b.h / slope : b.L + b.h
    a = b
    b = at(Math.max(1, Math.round(next * 10) / 10))
  }
  return (b ?? a).o
}

/**
 * The suggestions for an outcome with a rule error, each tried and kept only
 * where it leaves no error:
 *
 * - `speed`: the highest speed in 5 km/h steps below the fastest of the
 *   refitted elements and their neighbour that clears it — those elements no
 *   faster than that (`speedLimit`);
 * - `transition`: a transition at the Regellänge put in before the arc, where
 *   there is none yet and the element was no transition — the turnout or
 *   crossing moves for it, so the connection is solved again; where that alone
 *   does not clear it (the arc gets tighter), with the highest speed that does.
 *
 * `current` is { lead, speedLimit } as the dialog has them, `outcome` the one
 * it shows; `outcomeFor({ lead, speedLimit })` solves and judges again, null
 * where nothing connects. Returns [{ kind, speed, length, lead, speedLimit,
 * outcome, remaining }].
 */
export function connectRemedies({ anchor, current, outcome, outcomeFor }) {
  if (!outcome?.ruleError) return []
  const out = []
  const clear = (o) => o && !o.ruleError
  // The highest speed below `fastest` at which `withLimit` clears.
  const slowest = (o, withLimit) => {
    const fastest = Math.max(0, ...o.chain.map(el => el.speed || 0))
    for (let v = Math.ceil(fastest / SPEED_STEP) * SPEED_STEP - SPEED_STEP; v >= SPEED_STEP; v -= SPEED_STEP) {
      const found = withLimit(v)
      if (clear(found)) return { v, o: found }
    }
    return null
  }

  const bySpeed = slowest(outcome, v => outcomeFor({ ...current, speedLimit: v }))
  if (bySpeed) {
    out.push({ kind: 'speed', speed: bySpeed.v, ...current, speedLimit: bySpeed.v, outcome: bySpeed.o, remaining: remainingFindings(bySpeed.o) })
  }

  if (!(current.lead > 0) && anchor.kind !== 'transition') {
    const o = atRegularLead(anchor, current, outcomeFor)
    if (o) {
      const lead = o.lead.length
      const slower = clear(o) ? null : slowest(o, v => outcomeFor({ ...current, lead, speedLimit: v }))
      const done = clear(o) ? o : slower?.o
      if (done) {
        out.push({
          kind: 'transition', length: lead, speed: slower?.v ?? null, ...current, lead,
          speedLimit: slower?.v ?? current.speedLimit, outcome: done, remaining: remainingFindings(done),
        })
      }
    }
  }
  return out
}
