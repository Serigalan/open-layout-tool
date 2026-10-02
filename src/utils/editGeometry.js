// Geometry of an element edit: plan, apply and merge length/bearing/radius changes.
import { rebuildCoords, recalcAbsLengths } from './trackModel'
import { nodeUtm } from './elementUtils'
import { truncateHeights } from './heightUtils'
import { switchParts } from './switchDelete'
import { arcFrom, straightFrom, transitionElement } from './elementFactory'

/**
 * How far a single change in the track editor may reach before it is refused
 * (AP 5.1, Entscheidung 3). A geometry edit re-shapes everything hanging off the
 * element's end, across track and project boundaries, and that is the point of
 * it — but past a certain reach nobody can hold in their head what a typed
 * number is about to move. Both limits are exclusive and joined by OR: a change
 * that rebuilds five tracks without touching a switch is as hard to oversee as
 * one that moves two switches.
 */
export const MAX_EDIT_SWITCHES = 1
export const MAX_EDIT_TRACKS   = 3

function nodesApproxEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  return Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001
}

const norm360 = (deg) => ((deg % 360) + 360) % 360

/**
 * End bearing a straight keeps when its own direction changes by `newBearing`.
 * A straight may carry a kink at its end (Verm.ESN type 5): a stored end bearing
 * that differs from the direction it runs in. That deflection angle belongs to
 * the element and cannot be re-derived — so it travels with the element instead
 * of being dropped. A straight without a kink keeps no end bearing.
 */
function shiftedKink(el, newBearing) {
  if (el.radius != null || el.elementType === 2 || el.endBearing == null) return undefined
  return norm360(newBearing + (el.endBearing - el.bearing))
}

/**
 * Rebuild an element from a start point in the track's plane and its design
 * scalars — the given ones, else its own. Nodes, end bearing and the WGS84
 * geometry all follow from that; nothing is read back from WGS84.
 * A transition is defined by its curvature ends (r1/r2), not by a radius:
 * length and bearing reshape the spiral, they never turn it into a straight.
 */
function buildElement(el, startUtm, { bearing = el.bearing, length = el.length, radius = el.radius } = {}) {
  if (el.elementType === 2 && el.r1 !== undefined) {
    return { ...el, ...transitionElement(startUtm, bearing, length, el.r1, el.r2 ?? null, { transitionType: el.transitionType }).element }
  }
  // The bearing and length stay as given; the factory derives the rest.
  if (radius != null) return { ...el, ...arcFrom(startUtm, bearing, length, radius), bearing, length }
  return {
    ...el, ...straightFrom(startUtm, bearing, length), bearing, length, radius: null,
    endBearing: shiftedKink(el, bearing),
    // An arc cleared to a straight would otherwise keep drawing its old curve
    // in the track polyline (rebuildCoords prefers renderCoords).
    renderCoords: undefined,
  }
}

const endUtmOf = (el, epsg) => ({ easting: el.endNode[0], northing: el.endNode[1], zone: epsg })

// Move every element that started at `oldNode` onto the new end (start point
// and tangent), and on down the chain. Nodes are plane coordinates, so only
// tracks in the same plane can share one. Every track and every switch route it
// reaches is recorded in `touched` — that reach is what AP 5.1 bounds.
function propagate(tracks, epsg, oldNode, fromEl, touched) {
  const queue = [{ oldNode, start: endUtmOf(fromEl, epsg), bearing: fromEl.endBearing ?? fromEl.bearing }]
  while (queue.length > 0) {
    const { oldNode: node, start, bearing } = queue.shift()
    for (const t of tracks) {
      if (Number(t.epsg) !== Number(epsg)) continue
      for (let i = 0; i < (t.elements?.length ?? 0); i++) {
        const e = t.elements[i]
        if (!nodesApproxEqual(e.startNode, node)) continue
        const shifted = buildElement(e, start, { bearing })
        queue.push({ oldNode: e.endNode, start: endUtmOf(shifted, epsg), bearing: shifted.endBearing ?? shifted.bearing })
        t.elements[i] = shifted
        touched.trackIds.add(t.id)
        if (e.switchId) touched.switchIds.add(e.switchId)
      }
    }
  }
}

const finish = (tracks) => tracks.map(t => {
  const elems = recalcAbsLengths(t.elements ?? [])
  return { ...t, elements: elems, coordinates: rebuildCoords(elems) }
})

/**
 * What changing an element's length, bearing and/or radius would do — worked out
 * without writing anything (AP 5.1). The element is rebuilt from its start node
 * in the track's plane and everything hanging off its end follows, across track
 * and project boundaries, which is the point of the edit and also its danger:
 * `project.switches` is not carried along, so a change that walks over a
 * turnout's own elements takes its geometry apart while the record still claims
 * the old one.
 *
 * So the reach is measured and, past the limits above, refused:
 *
 *   tracks            the new track array — always built, so a preview can show
 *                     what the change would do even where it is refused
 *   touchedTrackIds   every track whose elements it re-shaped, the edited one included
 *   touchedSwitchIds  every switch it reaches: those whose own route elements
 *                     moved, and those standing with a port on a moved track
 *   error             the locale key of the refusal, or null
 *
 * `switches` may be left empty where the caller only wants the geometry (see
 * applyElementChange) — then there is nothing to count and nothing to protect.
 */
export function planElementChange(tracks, switches, trackId, elIdx, { length, bearing, radius }) {
  const newTracks = tracks.map(t => ({ ...t, elements: (t.elements ?? []).map(e => ({ ...e })) }))
  const touched = { trackIds: new Set(), switchIds: new Set() }
  const track = newTracks.find(t => t.id === trackId)
  const el    = track?.elements?.[elIdx]
  if (!el) return { tracks: newTracks, touchedTrackIds: [], touchedSwitchIds: [], error: null }

  const epsg     = track.epsg
  const startUtm = nodeUtm(el.startNode, el.geometry?.coordinates?.[0], epsg)
  const newEl = buildElement(el, startUtm, {
    bearing: bearing !== undefined ? bearing : el.bearing,
    length:  length  !== undefined ? length  : el.length,
    radius:  radius  !== undefined ? radius  : el.radius,
  })
  // A new length re-stations the track from that element on, so the vertical
  // alignment is cut there — what lies before it keeps its height points, the
  // rest has no gradient until it is read on request (see elevationFill).
  if (newEl.length !== el.length && track.heights) {
    const cutAt = track.elements.slice(0, elIdx).reduce((sum, e) => sum + (e.length ?? 0), 0)
    const kept  = truncateHeights(track.heights, cutAt)
    if (kept) track.heights = kept; else delete track.heights
  }
  track.elements[elIdx] = newEl
  touched.trackIds.add(track.id)
  if (el.switchId) touched.switchIds.add(el.switchId)

  propagate(newTracks, epsg, el.endNode, newEl, touched)

  // A switch also stands on the tracks its ports name, even where none of its
  // own elements moved: the track it was laid into was re-stationed under it.
  const byId = new Map(newTracks.map(t => [t.id, t]))
  for (const sw of switches ?? []) {
    if (!sw?.switchId || touched.switchIds.has(sw.switchId)) continue
    const { ports } = switchParts(sw, byId)
    if (ports.some(p => p.trackId && touched.trackIds.has(p.trackId))) touched.switchIds.add(sw.switchId)
  }

  const touchedTrackIds  = [...touched.trackIds]
  const touchedSwitchIds = [...touched.switchIds]
  const error = touchedSwitchIds.length > MAX_EDIT_SWITCHES || touchedTrackIds.length > MAX_EDIT_TRACKS
    ? 'table_edit_too_wide' : null

  return { tracks: finish(newTracks), touchedTrackIds, touchedSwitchIds, error }
}

/**
 * The track array to commit after edits in the element table: the store as it
 * stands now, with the edited elements laid over it.
 *
 * The table holds a copy of every track from the moment it was opened — the
 * first geometry change rebuilds them all (see above) — so writing that copy
 * back whole would also write back every track it never touched, and with it
 * undo whatever the store has learned since. What the table owns is the
 * elements and the display geometry derived from them; and, where it re-shaped
 * a track, that track's height points, because a new length re-stations the
 * track and the change truncates them on purpose. Heights filled in the
 * background on a track the table only re-typed a speed on are not its
 * business and stay.
 */
export function mergeElementEdits(storeTracks, edited, { changed = [], reshaped = [] } = {}) {
  const changedIds  = new Set(changed)
  const reshapedIds = new Set(reshaped)
  const byId = new Map((edited ?? []).map(tr => [tr.id, tr]))
  return (storeTracks ?? []).map(tr => {
    const edit = changedIds.has(tr.id) ? byId.get(tr.id) : null
    if (!edit) return tr
    const merged = { ...tr, elements: edit.elements, coordinates: edit.coordinates ?? tr.coordinates }
    if (!reshapedIds.has(tr.id)) return merged
    if (edit.heights) merged.heights = edit.heights
    else delete merged.heights
    return merged
  })
}

