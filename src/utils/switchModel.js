/**
 * What makes a record a switch, and what ties the elements of its routes back
 * to it.
 *
 * Until now an element found its switch by comparing `el.switchName` with
 * `sw.name`. That is a display string: the user can change it, an import can
 * drop it, and two records can carry the same one — at which point the elements
 * of one turnout answer for the other. `switchId` is the link now. The name
 * stays for what it always was, a label on the map and in the plan.
 *
 * `kind` tells a plain turnout from the crossings and slips that are still to
 * come, so the code that branches on shape has something to branch on instead of
 * inferring it from the port count.
 *
 * `formVersion` freezes the form table (SWITCH_TYPES and its fallbacks) a record
 * was built against. Three of the labels that are to gain a straight end piece
 * already exist without one, so a later table would silently move the geometry
 * of switches already drawn; a record that states the version it was built
 * against can be read with the table it meant.
 */

/** Discriminator of a switch record. Everything the app builds today is a turnout. */
export const SWITCH_KINDS = ['turnout', 'crossing', 'single_slip', 'double_slip']

export const DEFAULT_SWITCH_KIND = 'turnout'

/**
 * Version of the switch form table. Bumped when a form's dimensions change —
 * the straight end pieces are the next such change.
 */
export const SWITCH_FORM_VERSION = 1

/**
 * The routes a turnout has, as its elements mark themselves. A crossing has more
 * than two; generalising the route set belongs with the port model that has to
 * carry it, so this stays the turnout's pair for now.
 */
export const SWITCH_ROUTES = ['main', 'branch']

export const newSwitchId = () => crypto.randomUUID()

/**
 * What an element of a switch's route carries so it can be found again: the
 * switch's id and which of its routes this is, plus the name and form label the
 * map and the plan write along it.
 */
export function switchElementMark(sw, route) {
  return {
    switchBranch: true,
    switchRoute:  route,
    ...(sw.switchId ? { switchId: sw.switchId } : {}),
    ...(sw.name     ? { switchName: sw.name }   : {}),
    ...(sw.label    ? { switchLabel: sw.label } : {}),
  }
}

/**
 * Does this element belong to that switch? The id decides, and only the id —
 * every record and every marked element carries one, and a payload that does
 * not is refused at the door (persistenceUtils.parseProjectsPayload). The
 * missing id is checked for explicitly: two of them absent must not read as a
 * match and join elements of unrelated turnouts.
 */
export function elementBelongsToSwitch(el, sw) {
  return el.switchId != null && el.switchId === sw.switchId
}

/** The fields a record needs to be one of the current model, for a new record. */
export function newSwitchFields(kind = DEFAULT_SWITCH_KIND) {
  return { switchId: newSwitchId(), kind, formVersion: SWITCH_FORM_VERSION }
}

/** Does this record carry what the model requires of it? */
export function isModelledSwitch(sw) {
  return Boolean(sw?.switchId) && Boolean(sw?.kind) && sw?.formVersion != null
}
