/**
 * What lies over the map besides the panel (R2.4) — one state with its rules
 * stated here, instead of a flag per overlay.
 *
 *   overlay   the one map overlay that belongs to the open panel:
 *             trackTable (edit), profile (elevation), crossSection (platform),
 *             planPreview (plan), topologyGraph (topology) — { kind, ...data }
 *   popup     a read-only reference popup over the map pane, reachable from
 *             more than one panel: physics | regelwerk ({ regelwerkId })
 *
 * The rules: at most one overlay and one popup at a time; physics and the
 * regelwerk replace each other; changing the panel closes both (the overlay
 * belongs to the panel that is being left, the popup to no panel at all).
 * Whether the element table may be closed — it can hold unsaved edits — is
 * asked before an action that closes it is dispatched (App's closeTrackTable).
 */
export const OVERLAYS_CLOSED = { overlay: null, popup: null }

export function overlayReducer(state, action) {
  switch (action.type) {
    case 'open':
      return { ...state, overlay: action.overlay }
    case 'close':
      return state.overlay?.kind === action.kind ? { ...state, overlay: null } : state
    case 'popup':
      return { ...state, popup: action.popup }
    case 'closePopup':
      return state.popup ? { ...state, popup: null } : state
    case 'panelChange':
    case 'closeAll':
      return OVERLAYS_CLOSED
    default:
      return state
  }
}

/** Whether closing everything would take the element table with it. */
export const closesTrackTable = (state, action) =>
  state.overlay?.kind === 'trackTable' && overlayReducer(state, action).overlay?.kind !== 'trackTable'
