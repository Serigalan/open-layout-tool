/**
 * The regelwerk values the app needs synchronously — cant limits a dialog
 * judges on every keystroke, before any fetch could return.
 *
 * They are no longer a hand-kept copy of anything. Since AP R.8 they are read
 * out of the rulebook itself: `regelkatalog.js` bundles DB Ril 800.0110 and
 * `catalogLimit` evaluates the very rule a dialog is held to. The drift the
 * AP R.3 note was about — two independently maintained copies with no test
 * between them — is gone by construction, and regelwerkDefaults.test.js still
 * reads the optimizer's served copy straight off disk, so the two halves of
 * the one Ril (the rules here, the values the service runs on) cannot part
 * company unnoticed.
 *
 * AP R.3 stops short of pulling the app live off the service at startup and
 * re-rendering every open dialog should a second regelwerk ever appear: a
 * switch dialog cannot await a network round trip. The optimizer panel
 * (OptimizeTrackPanel.jsx) does ask the service which regelwerke exist and
 * sends the chosen id along with a run — this module is only what the rest of
 * the app draws on without one.
 */

import { catalogLimit, IN_SWITCH_AREA } from './regelkatalog'

/** The regelwerk a run uses unless it is told otherwise — DB Ril 800.0110. */
export const REGELWERK_ID = 'db-ril-800-0110'

// LP.KB.05 — the cant a turnout may carry (weiche.u_max in the served copy).
export const MAX_SWITCH_CANT = catalogLimit('LP.KB.05', 'reg', { 'element.cant': 0 }, IN_SWITCH_AREA)

// LP.KB.06 — the deficiency a turnout may carry (weiche.uf_max).
export const MAX_SWITCH_CANT_DEF = catalogLimit('LP.KB.06', 'max', { 'physics.u_f': 0 }, IN_SWITCH_AREA)

// src/constraints/physics.json, ueberhoehungsfehlbetrag_koeffizient.wert — v = sqrt(R · (u+uf) / coeff).
// Physics, not a regelwerk: no Ril sets it, it follows from the gauge and g.
export const CANT_DEFICIENCY_COEFF = 11.8
