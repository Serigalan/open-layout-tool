// The switch form tables as a regelwerk (AP R.6).
//
// A form table is a regelwerk in exactly the sense the optimizer's one is:
// values a railway administration sets, which the app reads and never
// computes — a radius, a frog gradient, the speed the branch is good for, the
// distance the Weichenmarke stands at. They live in switchUtils.js because
// that is where the geometry that draws them lives, and they are read from
// there rather than copied: a second copy for the viewer would be a second
// table to keep true.
//
// The difference to the served regelwerk is where it comes from, not what it
// is: this one is bundled, so it is there whether or not the optimizer service
// answers, and it has no version or validity date to state — the repo is its
// version.

import {
  SWITCH_TYPES, SWITCH_TYPES_ALT1, SWITCH_TYPES_ALT2, SWITCH_TYPES_INVENTORY,
  CROSSING_TYPES,
} from './switchUtils'

/**
 * The id this regelwerk carries in the viewer's selector. It is not an id the
 * service knows — nothing is fetched for it — which is why the fetch is
 * skipped on exactly this one.
 */
export const WEICHEN_REGELWERK_ID = 'weichen'

/** The straight piece a branch ends in [m]; 0 for a form whose branch is one arc. */
const geradesEndstueck = (form) =>
  (form.branch ?? [])
    .filter(section => section.type === 'straight')
    .reduce((sum, section) => sum + section.length, 0)

const weicheRow = (form) => ({
  label: form.label,
  radius: form.R,
  neigung: form.ratio,
  speed: form.speed,
  marke: form.dLcs ?? null,
  minl: form.minl ?? null,
  gerade: geradesEndstueck(form),
  // The symmetrical turnout has no through route that runs on: both routes
  // leave the toe on the one radius. A reader of the table would otherwise
  // read it as an ordinary form with a very sharp branch.
  symmetrisch: form.symmetric === true,
})

const kreuzungRow = (form) => ({
  label: form.label,
  kind: form.kind,
  neigung: form.ratio,
  radius: form.R ?? null,
  tangente: form.lt ?? null,
  speed: form.speed ?? null,
  marke: form.dLcs ?? null,
})

/**
 * The tables, in the order the connection calculation reaches for them, each
 * with the locale keys that name it and say what it is for. The keys are
 * returned rather than built at the call site so the viewer and the test that
 * checks both locales answer them cannot drift apart.
 *
 * `art` says which columns a group has: a turnout form states a minimum
 * intermediate straight and a straight end piece, a crossing a tangent — and
 * neither has the other's.
 */
export function weichenGruppen() {
  const gruppe = (key, art, formen) => ({
    key,
    art,
    titleKey: `constraints_weichen_${key}`,
    hintKey: `constraints_weichen_${key}_hint`,
    formen,
  })
  return [
    gruppe('regel', 'weiche', SWITCH_TYPES.map(weicheRow)),
    gruppe('alt1', 'weiche', SWITCH_TYPES_ALT1.map(weicheRow)),
    gruppe('alt2', 'weiche', SWITCH_TYPES_ALT2.map(weicheRow)),
    gruppe('bestand', 'weiche', SWITCH_TYPES_INVENTORY.map(weicheRow)),
    gruppe('kreuzung', 'kreuzung', CROSSING_TYPES.map(kreuzungRow)),
  ]
}
