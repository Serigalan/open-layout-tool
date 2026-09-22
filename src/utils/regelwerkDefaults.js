/**
 * The optimizer's own regelwerk values that the app needs synchronously — cant
 * limits a dialog judges on every keystroke, before any fetch could return.
 * This is the one place they are allowed to be a JS copy of
 * tools/optimizer/olt_optimizer/regelwerke/db-ril-800.json (and, for the
 * physics coefficient, tools/optimizer/physics.json): regelwerkDefaults.test.js
 * reads both files straight off disk and fails the moment this module
 * disagrees with them. The drift AP R.3 is about removing was two
 * independently maintained copies with no test between them, not that a JS
 * copy exists at all — a switch dialog cannot await a network round trip.
 *
 * AP R.3 stops short of pulling the app live off the service at startup and
 * re-rendering every open dialog should a second regelwerk ever appear: there
 * is only one today, and wiring that up for a regelwerk that does not exist
 * yet is exactly what the roadmap's own "Zwei Fallstricke" warns against. The
 * optimizer panel (OptimizeTrackPanel.jsx) does ask the service which
 * regelwerke exist and sends the chosen id along with a run — this module is
 * only the fallback the rest of the app draws on without a round trip.
 */

export const REGELWERK_ID = 'db-ril-800'

// weiche.u_max.wert / weiche.uf_max.wert [mm]
export const MAX_SWITCH_CANT = 100
export const MAX_SWITCH_CANT_DEF = 110

// ueberhoehungsfehlbetrag_koeffizient.wert — v = sqrt(R * (u+uf) / coeff)
export const CANT_DEFICIENCY_COEFF = 11.8
