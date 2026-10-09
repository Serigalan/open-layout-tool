import { SWITCH_FILLS_LAYER, TRACKS_LAYER } from './layerIds'

// Asking the map what lies under a point, and the filters that pick out a
// track, an element or a switch on the hover and selection layers.

/**
 * Whether `m` is still the map the ref holds — what an effect cleanup has to
 * ask before it touches the map it captured when it ran.
 *
 * Going back to the start page unmounts the map and the open panel in one
 * commit, and React detaches the container ref (which calls map.remove())
 * before the panels' effect cleanups run. A removed map has no style left —
 * MapLibre's remove() drops it — so every call that goes through it
 * (setFilter, getLayer, removeSource, …) throws, and a throw in a cleanup
 * takes the whole React root down with it. Once the map is gone there is also
 * nothing left to reset, so the cleanup simply stops here.
 */
export const mapIsLive = (map, m) => !!m && map?.current === m

/** Filter that matches no feature – used to "clear" a MapLibre layer filter */
export const FILTER_NONE = ['all', ['==', ['get', 'trackId'], ''], ['==', ['get', 'elementIndex'], -1]]

/** Filter that matches a specific track element */
export const filterForElement = (trackId, elementIndex) =>
  ['all', ['==', ['get', 'trackId'], trackId], ['==', ['get', 'elementIndex'], elementIndex]]

/** Filter that matches a set of elements of one track */
export const filterForElements = (trackId, elementIndexes) =>
  ['all', ['==', ['get', 'trackId'], trackId], ['in', ['get', 'elementIndex'], ['literal', elementIndexes]]]

/** Filter that matches every element of one track */
export const filterForTrack = (trackId) => ['==', ['get', 'trackId'], trackId]

/**
 * Filter that matches every element a switch owns, wherever it lies: its branch
 * and the through route carved into the track it was laid into are on two
 * tracks, so the id on the element is what picks them out, not the track.
 */
export const filterForSwitch = (switchId) => ['==', ['get', 'switchId'], switchId ?? '']

/** Pixel tolerance for click/hover hit detection */
export const HIT_TOLERANCE = 10

/**
 * What of the project lies under a point on the map (R3.1): the first feature
 * of `layers` (asked in that order, each within HIT_TOLERANCE of the point)
 * that `accept(properties)` takes, as
 *   { trackId, elementIndex, switchId, switchBranch, layer, properties }
 * — or null where there is none, or the layers are not on the map yet.
 *
 * `prefer` settles an overlap: where two tracks lie over each other — a
 * turnout's branch across the route it was laid into — that one is the one
 * meant, whichever order the renderer happens to return them in.
 */
export function pickAt(map, point, { layers = [TRACKS_LAYER], accept = null, prefer = null } = {}) {
  if (!map?.getLayer) return null
  const bbox = [
    [point.x - HIT_TOLERANCE, point.y - HIT_TOLERANCE],
    [point.x + HIT_TOLERANCE, point.y + HIT_TOLERANCE],
  ]
  for (const layer of layers) {
    if (!map.getLayer(layer)) continue
    const hits = map.queryRenderedFeatures(bbox, { layers: [layer] })
      .filter(f => !accept || accept(f.properties ?? {}))
    const hit = (prefer != null && hits.find(f => f.properties.trackId === prefer)) || hits[0]
    if (!hit) continue
    const p = hit.properties ?? {}
    return {
      trackId: p.trackId ?? null,
      elementIndex: p.elementIndex == null ? null : Number(p.elementIndex),
      switchId: p.switchId || null,
      switchBranch: p.switchBranch === true || p.switchBranch === 'true',
      layer,
      properties: p,
    }
  }
  return null
}

/** The track element under a point — { trackId, elementIndex } — or null (see pickAt). */
export function elementUnderPoint(map, point, prefer = null) {
  const hit = pickAt(map, point, { prefer })
  return hit ? { trackId: hit.trackId, elementIndex: hit.elementIndex } : null
}

/** Only the elements that are no switch's own branch. */
export const notSwitchBranch = (p) => !(p.switchBranch === true || p.switchBranch === 'true')

/**
 * Where a switch is picked: its body first — it is the switch itself — then
 * an element of one of its routes, which names it just as well. With
 * `accept: hasSwitch`.
 */
export const SWITCH_PICK_LAYERS = [SWITCH_FILLS_LAYER, TRACKS_LAYER]
export const hasSwitch = (p) => !!p.switchId
