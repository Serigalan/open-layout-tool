// The physics file turned into table rows, and the handful of regelwerk values
// the app holds a copy of — the reading half of the Constraints popup
// (ConstraintsOverlay.jsx). Plain functions, not JSX, so they run in the Node
// test suite without a DOM, same split regelwerkView.js keeps.
//
// The regelwerk itself is not read here: it comes over the wire from the
// service (GET /regelwerke/<id>) and flattenRegelwerk already turns it into
// rows. Physics has no such route — physics.json sits in tools/optimizer/,
// *outside* the olt_optimizer package, so `pip install` never ships it and the
// service could not serve it without moving the file. It drives nothing at
// runtime either (see below), so the popup takes it the other way: bundled at
// build time straight from the one file in the repo. Not a copy — the import
// is that file, which is why there is nothing here that could drift from it.

import physics from '../../tools/optimizer/physics.json'
import { MAX_SWITCH_CANT, MAX_SWITCH_CANT_DEF } from './regelwerkDefaults'

export const PHYSICS = physics

// Where each physics constant is read, the same app knowledge regelwerkView's
// WHERE_USED carries — and with the same caveat the file states about itself:
// it is the readable derivation the kernel's literals are checked against
// (verify.py), not something the kernel loads. Two of the three constants do
// not even reach the kernel as themselves; they are the derivation of the
// third.
const PHYSICS_WHERE_USED = {
  ueberhoehungsfehlbetrag_koeffizient:
    'Optimierer-Kernel (geometry.py) und App — Fehlbetrag und V_max im Trackeditor',
  wirksame_spurweite: 'nur Herleitung — steckt im Koeffizienten 11,8',
  erdbeschleunigung: 'nur Herleitung — steckt im Koeffizienten 11,8',
}

/**
 * The values the app keeps synchronously as well (regelwerkDefaults.js), by
 * the regelwerk path they come from. A dialog judging a cant on every
 * keystroke cannot await a fetch, so these exist twice by design — the popup
 * shows both so that the second copy is visible rather than merely believed,
 * and says so when the two disagree. regelwerkDefaults.test.js holds the copy
 * to the repo's file; what it cannot see is a service deployed from an older
 * commit, and that is exactly the disagreement this column would show.
 */
const APP_VALUES = {
  'weiche.u_max': MAX_SWITCH_CANT,
  'weiche.uf_max': MAX_SWITCH_CANT_DEF,
}

/** The app's own value for a regelwerk path, or null where it holds none. */
export function appValueFor(path) {
  return path in APP_VALUES ? APP_VALUES[path] : null
}

/**
 * physics.json as rows: `konstanten` (one per { wert, ... } entry, in file
 * order) and `profile` (the transition curve profiles, which state a curvature
 * function instead of a value). Values keep their JSON type; formatting is the
 * caller's job.
 */
export function flattenPhysics(physik) {
  const konstanten = []
  for (const [key, node] of Object.entries(physik ?? {})) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    if (!('wert' in node)) continue
    konstanten.push({
      path: key,
      wert: node.wert,
      einheit: node.einheit ?? '',
      formelText: node.formel_text ?? '',
      formelLatex: node.formel_latex ?? '',
      herleitung: node.herleitung ?? '',
      warum: node.warum ?? '',
      woVerwendet: PHYSICS_WHERE_USED[key] ?? 'Optimierer',
    })
  }
  const profile = Object.entries(physik?.uebergangsbogenprofile ?? {}).map(([key, node]) => ({
    key,
    name: node.name ?? key,
    kruemmung: node.kruemmung ?? '',
    kruemmungText: node.kruemmung_text ?? '',
    kruemmungLatex: node.kruemmung_latex ?? '',
    warum: node.warum ?? '',
  }))
  return { konstanten, profile }
}
