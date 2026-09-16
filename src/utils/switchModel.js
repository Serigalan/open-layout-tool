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
 * Does this element belong to that switch? The id decides wherever both carry
 * one. An element or a record from before the id existed falls back on the name
 * comparison it was written with, so data that has not been through
 * migrateProjectSwitches still reads correctly — an import builds its records
 * before anything migrates them.
 */
export function elementBelongsToSwitch(el, sw) {
  if (el.switchId && sw.switchId) return el.switchId === sw.switchId
  return !el.switchName || !sw.name || el.switchName === sw.name
}

/** The fields a record needs to be one of the current model, for a new record. */
export function newSwitchFields(kind = DEFAULT_SWITCH_KIND) {
  return { switchId: newSwitchId(), kind, formVersion: SWITCH_FORM_VERSION }
}

/**
 * Bring a project's switches up to the current model, in place: every record
 * gets its `switchId`, `kind` and `formVersion`, and the elements of its routes
 * get that id. Elements are matched by the name they were written with — the
 * only link the old records had — so this runs on load, before anything reads a
 * route back from the tracks.
 *
 * Idempotent: a record that already carries the fields keeps them, and an
 * element that already carries an id is left alone.
 */
export function migrateProjectSwitches(project) {
  const switches = project?.switches
  if (!switches?.length) return project

  const byName = new Map()
  for (const sw of switches) {
    if (!sw.switchId) sw.switchId = newSwitchId()
    if (!sw.kind) sw.kind = DEFAULT_SWITCH_KIND
    if (sw.formVersion == null) sw.formVersion = SWITCH_FORM_VERSION
    // Two records sharing a name is the very thing the id ends. While migrating
    // off the name there is nothing left to tell them apart by, so the first of
    // them takes the elements and the second comes out with none — visible, and
    // repairable, rather than silently splitting a turnout between both.
    if (sw.name && !byName.has(sw.name)) byName.set(sw.name, sw)
  }

  for (const track of project.tracks ?? []) {
    for (const el of track.elements ?? []) {
      if (!el.switchBranch || el.switchId) continue
      const sw = el.switchName ? byName.get(el.switchName) : null
      if (sw) el.switchId = sw.switchId
    }
  }
  return project
}
