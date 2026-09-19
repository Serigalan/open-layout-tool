import { joinTracks, rebuildCoords, recalcAbsLengths, reverseTrack } from '../storage'
import {
  portsOf, switchRoutePorts, elementBelongsToSwitch, elementOnSwitchRoute, unmarkSwitchElement,
} from './switchModel'
import {
  computeCurvedValuesUtm, computeStraightValuesUtm, resolveEndBearing,
} from './elementUtils'
import { curvatureOf } from './clothoidUtils'
import { reconstructElements } from './elementReconstruct'
import { splitHeights, trackLength } from './heightUtils'

/**
 * The routes that stay as ordinary track when the switch goes: a route both of
 * whose ports carry track beyond the switch is a line running over it, and a
 * line is not deleted because a switch on it was.
 *
 * Routes are taken in the kind's own order, and one is only kept where none of
 * its ports is already claimed by a route before it. That single condition is
 * what tells the kinds apart: a turnout's two routes share the toe, so at most
 * one of them can stay, and the through route — first in the table — is the one
 * that does. A crossing's two routes share no port, so both stay where both are
 * lines; a slip's connecting curve shares its ports with both through routes
 * and therefore only stays where neither of them does, which is right — it is
 * the switch's own geometry, not a line.
 */
export function keptRoutes(sw, byPort) {
  const claimed = new Set()
  const kept = []
  for (const [route, ports] of Object.entries(switchRoutePorts(sw?.kind))) {
    if (ports.some(port => claimed.has(port))) continue
    if (!ports.every(port => byPort[port]?.occupied)) continue
    ports.forEach(port => claimed.add(port))
    kept.push(route)
  }
  return kept
}

/**
 * Deleting a turnout.
 *
 * A switch is not a record that happens to sit beside some tracks: it owns
 * elements on two of its three ports — the branch, which is a track of its own,
 * and the through route, which is carved into the track the switch was laid
 * into. Deleting the record alone would leave both marked as a switch that no
 * longer exists; deleting everything it touches would tear a hole in a running
 * line. Which of the two routes is a line and which is the switch's own
 * geometry cannot be read off the record — it follows from what still hangs on
 * the ports (see keptRoutes):
 *
 * | occupied ports        | what stays                                        |
 * |-----------------------|---------------------------------------------------|
 * | A and B2              | the through route — a line runs over it           |
 * | A and B1, but not B2  | the branch — the through route is a stub           |
 * | anything else         | neither: nothing of the switch carries a line      |
 *
 * which is the ToDo's table read through one rule. "Occupied" means track
 * beyond the switch's own elements at that port: one port, or B1 and B2 without
 * A, leaves nothing that a route could be part of, so the switch goes with all
 * of its elements. With all three occupied the through route stays and the
 * branch goes — the branch's own continuation survives as its own track, now
 * unconnected, which is what deleting the switch that connected it means.
 *
 * What stays loses its marks and is ordinary track again (unmarkSwitchElement),
 * and the two halves the switch parted at its toe are joined back into one
 * (storage.joinTracks). Where that leaves a run of elements that differ in
 * nothing but where they were cut, the run becomes one element again
 * (mergeChain) — the carve's inverse.
 *
 * Nothing here writes: planSwitchDeletion is a dry run the dialog shows and
 * storage.commitSwitchDeletion then carries out in one undo step.
 */

/** Two nodes are the same node below this [m] — chainInvariants' JOINT_TOL. */
const JOINT_TOL = 1e-3

/** Two tangents are the same tangent below this [°]. */
const BEARING_TOL = 1e-6

/** Two radii are the same radius below this [m]. */
const RADIUS_TOL = 1e-6

const bearingDelta = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

/**
 * Where an element sits and how it is drawn — derived from everything else, so
 * it says nothing about whether two elements are the same kind of element.
 * `radius`, the transition's `r1`/`r2` and the ramp's `cantStart`/`cantEnd` are
 * out because they are compared by their own rule below.
 */
const PLACEMENT_KEYS = new Set([
  'startNode', 'endNode', 'bearing', 'endBearing', 'length', 'absLength',
  'geometry', 'renderCoords', 'epsg', 'radius', 'r1', 'r2', 'cantStart', 'cantEnd',
])

/** Do these two agree in everything that is not placement — cant, speed, type? */
function sameFields(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter(k => !PLACEMENT_KEYS.has(k)))
  for (const key of keys) if (a[key] !== b[key]) return false
  return true
}

/** The curvature a clothoid gains per metre — equal for pieces of one curve. */
const curvatureRate = (el) => (el.length > 0
  ? (curvatureOf(el.r2 ?? null) - curvatureOf(el.r1 ?? null)) / el.length : 0)

/**
 * May this run of elements be a single element — is it one element that was cut
 * into these, or a chain that is indistinguishable from one?
 *
 * The run has to agree in everything that is not placement (`sameFields`:
 * element type, cant, speed, transition type, …), meet node to node and run on
 * tangentially. On top of that, per kind:
 *
 * - straights: none of them curved;
 * - arcs: the same signed radius, and a combined sweep under half a turn —
 *   past that a chord and a radius no longer name one arc, and the merge would
 *   silently give back its complement;
 * - transitions: clothoids only, chained (`r2` of each is `r1` of the next) and
 *   at one curvature rate, which is what makes them pieces of *one* clothoid
 *   rather than two that meet. A Bloss curve is never cut in the first place
 *   (splitClothoid refuses it), so two of them are two curves, never one.
 *
 * An element that carries a switch mark is never merged: it is some turnout's
 * own geometry, and that turnout's dimension is what its element boundaries
 * say.
 */
export function mergeableRun(els, epsg = null) {
  if (!Array.isArray(els) || els.length < 2) return false
  if (els.some(el => !el || el.switchBranch || !el.startNode || !el.endNode)) return false

  const [first] = els
  for (const el of els) if (!sameFields(first, el)) return false

  if (first.elementType === 2) {
    if (first.transitionType === 'bloss' || first.r1 === undefined) return false
    const rate = curvatureRate(first)
    for (const el of els) {
      if (Math.abs(curvatureRate(el) - rate) > 1e-9 * Math.max(Math.abs(rate), 1e-9)) return false
    }
    for (let i = 0; i < els.length - 1; i++) {
      if (curvatureOf(els[i].r2 ?? null) !== curvatureOf(els[i + 1].r1 ?? null)) return false
      if ((els[i].cantEnd ?? null) !== (els[i + 1].cantStart ?? null)) return false
    }
  } else if (first.radius != null) {
    for (const el of els) {
      if (el.radius == null || Math.abs(el.radius - first.radius) > RADIUS_TOL) return false
    }
    const sweep = els.reduce((sum, el) => sum + (el.length ?? 0), 0) / Math.abs(first.radius)
    if (!(sweep < Math.PI)) return false
  } else {
    for (const el of els) if (el.radius != null) return false
  }

  for (let i = 0; i < els.length - 1; i++) {
    const a = els[i], b = els[i + 1]
    if (Math.hypot(a.endNode[0] - b.startNode[0], a.endNode[1] - b.startNode[1]) > JOINT_TOL) return false
    if (bearingDelta(resolveEndBearing(a, epsg), b.bearing) > BEARING_TOL) return false
  }
  return true
}

/**
 * The run as the one element it may be (mergeableRun has said so). It runs from
 * the first's start node to the last's end node — both are stored plane nodes,
 * so the joins with the neighbours are exactly the ones that were there. Length
 * and bearings come from the same calls that built the pieces; the display
 * geometry from reconstructElements, the one path a reload takes anyway.
 */
export function mergeRun(els, epsg) {
  const first = els[0]
  const last  = els[els.length - 1]
  const startUtm = { easting: first.startNode[0], northing: first.startNode[1], zone: epsg }
  const endUtm   = { easting: last.endNode[0],    northing: last.endNode[1],    zone: epsg }
  const { endBearing: _eb, absLength: _al, geometry: _g, renderCoords: _rc, ...base } = first

  let merged
  if (first.elementType === 2) {
    merged = {
      ...base,
      r1: first.r1 ?? null, r2: last.r2 ?? null,
      endNode: last.endNode,
      length: els.reduce((sum, el) => sum + (el.length ?? 0), 0),
      ...(last.endBearing != null ? { endBearing: last.endBearing } : {}),
      ...(first.cantStart !== undefined || last.cantEnd !== undefined
        ? { cantStart: first.cantStart ?? null, cantEnd: last.cantEnd ?? null } : {}),
    }
  } else if (first.radius != null) {
    const v = computeCurvedValuesUtm(startUtm, endUtm, first.radius)
    merged = {
      ...base,
      endNode: v.endNode, bearing: v.bearing, endBearing: v.endBearing,
      length: v.length, radius: first.radius,
    }
  } else {
    const v = computeStraightValuesUtm(startUtm, endUtm)
    merged = {
      ...base,
      endNode: v.endNode, bearing: v.bearing, length: v.length,
      ...(last.endBearing != null ? { endBearing: last.endBearing } : {}),
    }
  }
  return reconstructElements([merged], epsg)[0]
}

/**
 * The chain with every run that may be one element merged into one. Returns
 * `{ elements, mergedFrom, mergedInto }` — how many elements went into merges
 * and how many came out, which is what the dialog's preview counts.
 */
export function mergeChain(elements, epsg) {
  const out = []
  let mergedFrom = 0, mergedInto = 0
  let i = 0
  while (i < elements.length) {
    let j = i + 1
    while (j < elements.length && mergeableRun(elements.slice(i, j + 1), epsg)) j++
    if (j - i > 1) {
      out.push(mergeRun(elements.slice(i, j), epsg))
      mergedFrom += j - i
      mergedInto += 1
    } else {
      out.push(elements[i])
    }
    i = j
  }
  return { elements: recalcAbsLengths(out), mergedFrom, mergedInto }
}

/**
 * What hangs on each port of a switch: the elements the switch itself owns
 * there — counted from the port's own end of the track inwards, for as long as
 * they carry its mark for that route — and what lies beyond them.
 *
 * A port is **occupied** when something does: track that is not this switch's
 * own geometry and that would be severed if the switch took everything it
 * touches with it. Port A carries no elements of the switch at all (the toe is
 * a node, not a stretch), so everything on its track lies beyond it — an
 * unoccupied A means there is no track behind the toe at all.
 *
 * `mine` and `beyond` are in the track's own element order, whichever end the
 * port sits at.
 */
export function switchParts(sw, tracks) {
  const byId = tracks instanceof Map ? tracks : new Map((tracks ?? []).map(t => [t.id, t]))
  const ports = portsOf(sw).map(({ port, trackKey, endKey, route }) => {
    const trackId  = sw?.[trackKey] ?? null
    const endpoint = sw?.[endKey] ?? null
    const track    = trackId ? byId.get(trackId) ?? null : null
    const els      = track?.elements ?? []
    const atEnd    = endpoint === 'END'
    const ordered  = atEnd ? [...els].reverse() : els
    let n = 0
    while (n < ordered.length && elementOnSwitchRoute(ordered[n], sw, route)) n++
    return {
      port, route, trackId, endpoint, track,
      mine:   atEnd ? els.slice(els.length - n) : els.slice(0, n),
      beyond: atEnd ? els.slice(0, els.length - n) : els.slice(n),
      occupied: Boolean(track) && (atEnd || endpoint === 'BEGIN') && els.length > n,
    }
  })
  return { ports, byPort: Object.fromEntries(ports.map(p => [p.port, p])) }
}

/**
 * The track with the switch's own elements taken off one of its ends. The
 * vertical alignment is stationed along the track, so the stretch over them
 * goes with them and what is left restarts at 0 where the track now begins.
 */
function trimTrack(track, endpoint, drop) {
  const els  = track.elements ?? []
  const keep = endpoint === 'END' ? els.slice(0, els.length - drop.length) : els.slice(drop.length)
  const cut  = drop.reduce((sum, el) => sum + (el.length ?? 0), 0)
  const heights = endpoint === 'END'
    ? splitHeights(track.heights, Math.max(0, trackLength(track) - cut))[0]
    : splitHeights(track.heights, cut)[1]
  const elements = recalcAbsLengths(keep)
  const { heights: _h, ...rest } = track
  return {
    ...rest,
    elements,
    coordinates: rebuildCoords(elements),
    ...(heights?.length ? { heights } : {}),
  }
}

/**
 * The track with this switch's marks taken off — every element of it, whichever
 * route it was on. Another switch's elements on the same track keep theirs.
 */
function unmarkOn(track, sw) {
  const elements = (track.elements ?? []).map(el => (
    el.switchBranch && elementBelongsToSwitch(el, sw) ? unmarkSwitchElement(el) : el))
  return { ...track, elements }
}

/**
 * What deleting a crossing or crossing switch does — the same dry-run contract
 * as the turnout's plan below it (planSwitchDeletion), read over the kind's
 * own four ports.
 *
 * A crossing's two routes share no port, so both stay where both carry a line
 * (keptRoutes); what stays is unmarked and is ordinary track again. There is no
 * toe to join back together — the routes cross, they never parted — so `joined`
 * is always false and no merge runs: the legs meet at the crossing point at the
 * crossing angle, which is a kink, not a cut.
 *
 * A through route runs over its own legs — they are part of the line that stays.
 * A slip arcs between two ports without touching the crossing point, so where a
 * slip is the line, its legs are dead stubs into the point and go with the
 * switch; the curve itself stays, unmarked, as the line it turned out to be.
 * The slip tracks hang on none of the ports, so no port's `mine` reaches them:
 * they are collected by their mark instead, over every track that is not one
 * of the legs.
 */
function planCrossingDeletion(sw, tracks) {
  const { byPort } = switchParts(sw, tracks)
  const routes = keptRoutes(sw, byPort)
  const keptSlips = new Set(routes.filter(r => r !== 'main' && r !== 'cross'))
  const keptPorts = new Set(
    routes.filter(r => r === 'main' || r === 'cross')
      .flatMap(route => switchRoutePorts(sw.kind)[route]))

  const updates = new Map()
  const removeTrackIds = []
  const removedTracks = []
  let removedElements = 0
  const current = (port) => (port.trackId ? updates.get(port.trackId) ?? port.track : null)

  for (const port of Object.values(byPort)) {
    if (!port.track || port.mine.length === 0) continue
    if (keptPorts.has(port.port)) {
      // What stays is ordinary track again.
      updates.set(port.trackId, unmarkOn(current(port), sw))
      continue
    }
    removedElements += port.mine.length
    if (port.beyond.length === 0) {
      removeTrackIds.push(port.trackId)
      removedTracks.push(port.track.name ?? port.trackId)
    } else {
      updates.set(port.trackId, trimTrack(current(port), port.endpoint, port.mine))
    }
  }

  // The slip curves: tracks of this switch marked 'slip1'/'slip2' that no port
  // names. A kept one is unmarked and stays as the line it carries; the rest
  // go with the switch.
  const legTrackIds = new Set(Object.values(byPort).map(p => p.trackId))
  const byId = tracks instanceof Map ? tracks : new Map((tracks ?? []).map(t => [t.id, t]))
  for (const track of byId.values()) {
    if (legTrackIds.has(track.id) || removeTrackIds.includes(track.id)) continue
    const mine = (track.elements ?? []).filter(el => elementBelongsToSwitch(el, sw)
      && (el.switchRoute === 'slip1' || el.switchRoute === 'slip2'))
    if (!mine.length) continue
    if (keptSlips.has(mine[0].switchRoute)) {
      updates.set(track.id, unmarkOn(track, sw))
      continue
    }
    removedElements += mine.length
    if (mine.length === (track.elements ?? []).length) {
      removeTrackIds.push(track.id)
      removedTracks.push(track.name ?? track.id)
    } else {
      updates.set(track.id, {
        ...track,
        elements: (track.elements ?? []).filter(el => !mine.includes(el)),
      })
    }
  }

  return {
    switchId: sw.switchId,
    reason: keptSlips.size > 0 ? 'crossing_slip'
      : routes.length === 2 ? 'crossing_both' : routes.length === 1 ? 'crossing_one' : 'all',
    removeTrackIds,
    updateTracks: [...updates.values()].filter(t => !removeTrackIds.includes(t.id)),
    remap: [],
    removedElements,
    removedTracks,
    mergedElements: 0, mergedInto: 0, joined: false,
  }
}

/**
 * What deleting this switch would do, without doing it — the dry run the dialog
 * previews and storage.commitSwitchDeletion carries out.
 *
 * Returns
 *   {
 *     switchId,
 *     reason,          'through' | 'branch' | 'all' — which route stays, if any
 *     removeTrackIds,  tracks that were nothing but this switch's geometry
 *     updateTracks,    tracks rewritten in place (same ids)
 *     remap,           remapSwitches entries for every other switch
 *     removedElements, how many elements go
 *     removedTracks,   their names, for the preview
 *     mergedElements,  how many elements a merge absorbed …
 *     mergedInto,      … and how many came out of it
 *     joined,          whether the toe's two halves were joined back into one
 *   }
 * or null where the record cannot be read.
 */
export function planSwitchDeletion(sw, tracks) {
  if (!sw?.switchId) return null
  // The crossing kinds part no track at a toe and may keep both of their
  // routes; their plan follows the same rule as the turnout's, read over the
  // kind's own ports (keptRoutes).
  if (sw.kind && sw.kind !== 'turnout') return planCrossingDeletion(sw, tracks)
  const { byPort } = switchParts(sw, tracks)
  const { A, B1, B2 } = byPort

  // Which route is a line, and which is the switch's own geometry.
  const routes      = keptRoutes(sw, byPort)
  const keepThrough = routes.includes('main')
  const keepBranch  = routes.includes('branch')
  const kept    = keepThrough ? B2 : keepBranch ? B1 : null
  const reason  = keepThrough ? 'through' : keepBranch ? 'branch' : 'all'

  const updates        = new Map()
  const removeTrackIds = []
  const removedTracks  = []
  const remap          = []
  let removedElements  = 0
  const current = (port) => (port.trackId ? updates.get(port.trackId) ?? port.track : null)

  // The routes that do not stay lose their elements. A track that was nothing
  // else goes with them; one that carries more keeps that, trimmed back to it.
  for (const port of [B1, B2]) {
    if (port === kept || !port.track || port.mine.length === 0) continue
    if (removeTrackIds.includes(port.trackId)) continue
    removedElements += port.mine.length
    if (port.beyond.length === 0) {
      removeTrackIds.push(port.trackId)
      removedTracks.push(port.track.name ?? port.trackId)
    } else {
      updates.set(port.trackId, trimTrack(current(port), port.endpoint, port.mine))
    }
  }

  if (!kept) {
    return {
      switchId: sw.switchId, reason,
      removeTrackIds,
      updateTracks: [...updates.values()].filter(t => !removeTrackIds.includes(t.id)),
      remap, removedElements, removedTracks,
      mergedElements: 0, mergedInto: 0, joined: false,
    }
  }

  // What stays is ordinary track again.
  updates.set(kept.trackId, unmarkOn(current(kept), sw))

  // The toe parted one track into two when the switch was built; with the
  // switch gone they are one track again. The piece that meets the toe
  // backwards is reversed — always the switch's route, never the line behind
  // it, so what the user drew keeps its direction.
  let joined = false
  let keepId = kept.trackId
  if (A.trackId && A.trackId !== kept.trackId && A.track) {
    const keptTrack   = current(kept)
    const aTrack      = current(A)
    // head ends at the toe, tail begins there; whichever meets it the other way
    // round is the one that gets reversed.
    const reversed    = reverseTrack(keptTrack)
    const keptAtEnd   = kept.endpoint === 'END'
    const aAtEnd      = A.endpoint === 'END'
    const flippedKept = aAtEnd === keptAtEnd
    const head = aAtEnd ? aTrack : (keptAtEnd ? keptTrack : reversed)
    const tail = aAtEnd ? (keptAtEnd ? reversed : keptTrack) : aTrack
    const result = joinTracks(head, tail)
    const goneId = result.id === A.trackId ? kept.trackId : A.trackId
    updates.delete(goneId)
    updates.set(result.id, result)
    removeTrackIds.push(goneId)
    remap.push({ oldId: goneId, newId: result.id, flip: goneId === kept.trackId && flippedKept })
    if (result.id === kept.trackId && flippedKept) {
      remap.push({ oldId: kept.trackId, newId: kept.trackId, flip: true })
    }
    keepId = result.id
    joined = true
  }

  // Where the carve cut an element only because the switch ended there, the
  // pieces are one element again.
  const merging = updates.get(keepId)
  const chain   = mergeChain(merging.elements ?? [], merging.epsg)
  updates.set(keepId, {
    ...merging, elements: chain.elements, coordinates: rebuildCoords(chain.elements),
  })

  return {
    switchId: sw.switchId, reason,
    removeTrackIds,
    updateTracks: [...updates.values()].filter(t => !removeTrackIds.includes(t.id)),
    remap, removedElements, removedTracks,
    mergedElements: chain.mergedFrom, mergedInto: chain.mergedInto, joined,
  }
}
