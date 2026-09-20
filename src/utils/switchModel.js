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
 * The routes each kind has, as its elements mark themselves, with the ports each
 * route runs between.
 *
 * A turnout's two routes share the toe: they part there, which is what makes it
 * a turnout. The crossing kinds instead have four ports and routes that cross
 * without sharing an end — `main` from A to C, `cross` from B to D — and a slip
 * adds the connecting curves between them, one for the single slip and two for
 * the double. That the routes of a crossing share no port is why both of them
 * can outlive it as ordinary track, which the turnout's pair never can (see
 * switchDelete).
 */
const ROUTE_PORTS = {
  turnout:     { main: ['A', 'B2'], branch: ['A', 'B1'] },
  crossing:    { main: ['A', 'C'],  cross: ['B', 'D'] },
  single_slip: { main: ['A', 'C'],  cross: ['B', 'D'], slip1: ['A', 'D'] },
  double_slip: { main: ['A', 'C'],  cross: ['B', 'D'], slip1: ['A', 'D'], slip2: ['B', 'C'] },
}

/** The ports each route of this kind runs between, as { route: [port, port] }. */
export const switchRoutePorts = (kind) => ROUTE_PORTS[kind] ?? ROUTE_PORTS[DEFAULT_SWITCH_KIND]

/** The routes of a kind, in the order a shared port is claimed (see switchDelete). */
export const switchRoutes = (kind) => Object.keys(switchRoutePorts(kind))

/** The routes a turnout has — the pair everything built so far marks itself with. */
export const SWITCH_ROUTES = switchRoutes(DEFAULT_SWITCH_KIND)

/**
 * What a kind and its routes are called, as locale keys — a turnout is a
 * Weiche, a crossing a Kreuzung, both slips a Kreuzungsweiche, and each route
 * carries the name the dialogs give it. The element table reads them so a
 * turnout's elements say what they are instead of reading as plain running
 * line; an unknown kind falls back to the turnout's names, the same way
 * switchRoutePorts does.
 */
const KIND_LABEL_KEY = {
  turnout:     'table_type_switch',
  crossing:    'table_type_crossing',
  single_slip: 'table_type_crossing_switch',
  double_slip: 'table_type_crossing_switch',
}

const ROUTE_LABEL_KEY = {
  turnout:  { main: 'table_route_stem',    branch: 'table_route_branch' },
  crossing: { main: 'table_route_through', cross:  'table_route_cross',
    slip1: 'table_route_slip', slip2: 'table_route_slip' },
}

/** Locale key naming this kind of switch. */
export const switchKindLabelKey = (kind) =>
  KIND_LABEL_KEY[kind] ?? KIND_LABEL_KEY[DEFAULT_SWITCH_KIND]

/**
 * Locale key naming one route of this kind — null for a route it does not have.
 * The crossing kinds share their route names: a slip is a crossing with the
 * connecting curves added, so its two crossing roads are called the same.
 */
export const switchRouteLabelKey = (kind, route) => {
  const names = kind !== DEFAULT_SWITCH_KIND && ROUTE_PORTS[kind]
    ? ROUTE_LABEL_KEY.crossing
    : ROUTE_LABEL_KEY.turnout
  return names[route] ?? null
}

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

/**
 * The ports of each kind: the track each names, which end of that track the
 * switch sits at, and which of the switch's routes carries the elements marked
 * there. A port is a pair of fields on the record rather than a record of its
 * own — that is the shape the store, the exchange format and the OSRD codec all
 * read, and the one place that pairs the two field names is here.
 *
 * A turnout has three, and port A is its toe: the switch owns no elements there
 * — the toe is a node, not a stretch — so `route` says which route *would* run
 * into it. The crossing kinds have four, one per end of the two crossing
 * routes, and every one of them carries elements.
 *
 * Everything that walks a record's ports walks the list for its kind, so a kind
 * with more of them is a further entry here and nothing else.
 */
const PORTS_BY_KIND = {
  turnout: [
    { port: 'A',  trackKey: 'portA_trackId',  endKey: 'portA_endpoint',  route: 'main' },
    { port: 'B1', trackKey: 'portB1_trackId', endKey: 'portB1_endpoint', route: 'branch' },
    { port: 'B2', trackKey: 'portB2_trackId', endKey: 'portB2_endpoint', route: 'main' },
  ],
  crossing: [
    { port: 'A', trackKey: 'portA_trackId', endKey: 'portA_endpoint', route: 'main' },
    { port: 'B', trackKey: 'portB_trackId', endKey: 'portB_endpoint', route: 'cross' },
    { port: 'C', trackKey: 'portC_trackId', endKey: 'portC_endpoint', route: 'main' },
    { port: 'D', trackKey: 'portD_trackId', endKey: 'portD_endpoint', route: 'cross' },
  ],
}
PORTS_BY_KIND.single_slip = PORTS_BY_KIND.crossing
PORTS_BY_KIND.double_slip = PORTS_BY_KIND.crossing

/** The ports of a kind, as the field pairs a record carries them in. */
export const switchPorts = (kind) => PORTS_BY_KIND[kind] ?? PORTS_BY_KIND[DEFAULT_SWITCH_KIND]

/** The ports of this record, by its own kind. */
export const portsOf = (sw) => switchPorts(sw?.kind)

/** The ports of a turnout — what every record built so far carries. */
export const SWITCH_PORTS = switchPorts(DEFAULT_SWITCH_KIND)

/** Does this element carry `sw`'s mark for `route`? */
export const elementOnSwitchRoute = (el, sw, route) => Boolean(el?.switchBranch)
  && elementBelongsToSwitch(el, sw)
  && (!el.switchRoute || el.switchRoute === route)

/**
 * The element without any of the marks that tied it to a switch — what a route
 * becomes when the switch over it is deleted and the geometry stays as ordinary
 * track. The cant justification goes with them: it was written for a switch
 * route's 100 mm limit, and on a line element (limit 170) it would claim an
 * exception nothing needs any more.
 */
export function unmarkSwitchElement(el) {
  const {
    switchBranch: _b, switchRoute: _r, switchId: _i, switchName: _n, switchLabel: _l,
    cantException: _c, ...rest
  } = el
  return rest
}
