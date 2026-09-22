// The switch form tables as the regelwerk they are: DB Ril 800.0120,
// „Auswahl der Weichen und Kreuzungen" (AP R.6, named in AP R.8).
//
// Since the constraints were gathered in src/constraints/, the tables are a
// file of their own — db-ril-800-0120.json — and this module only groups them
// for the viewer: the Ril's two classes (Regelformen A01, Sonderbauformen A02)
// crossed with what a row can state, because a turnout, a crossing and a
// crossing switch do not answer the same columns.
//
// It is not a second copy of anything: switchUtils.js reads the same file for
// the geometry, and a form here is that file's entry.
//
// The difference to the served regelwerk is where it comes from, not what it
// is: this one is bundled, so it is there whether or not the optimizer service
// answers.

import {
  SWITCH_TYPES, SWITCH_TYPES_SPECIAL, CROSSING_TYPES, WEICHEN_KATALOG,
} from './switchUtils'

/**
 * What this rulebook is, as the catalogue states it about itself. The Ril's
 * own edition is deliberately not among it: what carries a version here is the
 * machine-readable rendering.
 */
export const WEICHEN_REGELWERK = WEICHEN_KATALOG.katalog

export const WEICHEN_REGELWERK_ID = WEICHEN_REGELWERK.id

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
  // A Bogenkreuzungsweiche has no one radius — its routes state theirs.
  radius: form.R ?? null,
  // What the form states about how far its ends lie from the crossing point:
  // a plain crossing its tangent, a Bogenkreuzungsweiche the length of its
  // curved legs. A crossing switch with straight legs states neither.
  tangente: form.lt ?? form.lb ?? null,
  speed: form.speed ?? null,
  marke: form.dLcs ?? null,
  // A crossing switch carries more than one route and a speed for each of
  // them; a plain crossing has the one. Passed on as the catalogue states it,
  // formatted where it is drawn.
  routen: form.routen ?? null,
})

const istKreuzungsweiche = (form) => form.kind !== 'crossing'

/**
 * The tables, in the order the catalogue states them: the Regelformen of
 * A01 first, the Sonderbauformen of A02 after, each split by what a row can
 * say. Each group carries the locale keys that name it and say what it is for,
 * so the viewer and the test that checks both locales answer them cannot drift
 * apart.
 *
 * `art` says which columns a group has: a turnout form states a minimum
 * intermediate straight and a straight end piece, a crossing a tangent — and
 * neither has the other's. A group with no form in it is left out: an empty
 * table would claim the Ril has no such forms — which is how the
 * Bogenkreuzungsweichen stayed out of sight until AP 3.4 brought them.
 */
export function weichenGruppen() {
  const gruppe = (key, art, formen) => ({
    key,
    art,
    titleKey: `constraints_weichen_${key}`,
    hintKey: `constraints_weichen_${key}_hint`,
    formen,
  })
  const kreuzungen = (klasse, slip) => CROSSING_TYPES
    .filter(form => form.klasse === klasse && istKreuzungsweiche(form) === slip)
    .map(kreuzungRow)
  return [
    gruppe('regel_weichen', 'weiche', SWITCH_TYPES.map(weicheRow)),
    gruppe('regel_kreuzungen', 'kreuzung', kreuzungen('regel', false)),
    gruppe('regel_kreuzungsweichen', 'kreuzung', kreuzungen('regel', true)),
    gruppe('sonder_weichen', 'weiche', SWITCH_TYPES_SPECIAL.map(weicheRow)),
    gruppe('sonder_kreuzungen', 'kreuzung', kreuzungen('sonderbauform', false)),
    gruppe('sonder_kreuzungsweichen', 'kreuzung', kreuzungen('sonderbauform', true)),
  ].filter(gruppe => gruppe.formen.length)
}
