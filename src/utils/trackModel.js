import { resolveEndBearing, reverseElement } from './elementUtils'
import { portsOf } from './switchModel'
import { joinHeights, reverseHeights, trackLength } from './heightUtils'
import { generateId } from './identifierUtils'

// The track model: pure functions on tracks and switch records. Nothing here
// reads or writes the project store (storage.js) — that is what lets the
// geometry utils, the importers and the server use them.

// A switch port names a track plus which end of it the switch sits at. The end
// is the track's own BEGIN (elements[0].startNode) or END (last endNode) — the
// axis that OSRD's track_section arrow and all length offsets refer to. How
// many ports a record has is its kind's business (switchModel.portsOf), so
// everything here walks the record rather than a fixed three.
export const portTracks    = (sw) => portsOf(sw).map(p => sw[p.trackKey]).filter(Boolean)
export const referencesTrack = (sw, trackId) => portsOf(sw).some(p => sw[p.trackKey] === trackId)

const flipEndpoint = (e) => (e === 'BEGIN' ? 'END' : e === 'END' ? 'BEGIN' : e)

export function remapSwitches(switches, remap) {
  // remap: [{ oldId, newId, flip }]
  //   newId array [firstHalf, secondHalf] – a track was split; the port's
  //     endpoint decides which half it stays on,
  //   flip – the track was folded into the new one backwards, so BEGIN/END swap.
  return (switches ?? []).map(sw => {
    const updated = { ...sw }
    portsOf(sw).forEach(({ trackKey, endKey }) => {
      const entry = remap.find(r => r.oldId === sw[trackKey])
      if (!entry) return
      if (Array.isArray(entry.newId)) {
        updated[trackKey] = sw[endKey] === 'BEGIN' ? entry.newId[0] : entry.newId[1]
      } else {
        updated[trackKey] = entry.newId
        if (entry.flip) updated[endKey] = flipEndpoint(sw[endKey])
      }
    })
    return updated
  })
}

/** Flip BEGIN/END on every switch port that references `trackId`. */
export function flipSwitchEndpoints(switches, trackId) {
  return (switches ?? []).map(sw => {
    if (!referencesTrack(sw, trackId)) return sw
    const updated = { ...sw }
    portsOf(sw).forEach(({ trackKey, endKey }) => {
      if (sw[trackKey] === trackId) updated[endKey] = flipEndpoint(sw[endKey])
    })
    return updated
  })
}

export function rebuildCoords(elements) {
  return elements.reduce((coords, el, i) => {
    const c = el.renderCoords ?? el.geometry?.coordinates ?? []
    return i === 0 ? [...c] : [...coords, ...c.slice(1)]
  }, [])
}

export function recalcAbsLengths(elements) {
  let running = 0
  return elements.map((el) => {
    running += el.length
    return { ...el, absLength: running }
  })
}

export function nextTrackName(prefix, existingNames) {
  const set = new Set(existingNames)
  for (let i = 1; i <= 999; i++) {
    const candidate = `${prefix}.${String(i).padStart(3, '0')}`
    if (!set.has(candidate)) return candidate
  }
  return `${prefix}.${Date.now()}`
}

export function makeTrack(base, elements, id, heights) {
  const elems = recalcAbsLengths(elements)
  const { elements: _e, coordinates: _c, id: _id, heights: _h, ...rest } = base
  return {
    ...rest,
    id:          id ?? generateId(),
    coordinates: rebuildCoords(elems),
    elements:    elems,
    ...(heights?.length ? { heights } : {}),
  }
}

/**
 * A track running the other way: its elements in the other order, each of them
 * flipped, the heights mirrored about its length. Its BEGIN and END swap with
 * it, so every switch port that names the track has to be flipped too — the
 * callers do that through `remapSwitches` (`flip: true`) resp.
 * flipSwitchEndpoints. Pure: nothing is written here.
 */
export function reverseTrack(track) {
  const elements = recalcAbsLengths([...(track.elements ?? [])].reverse().map(reverseElement))
  const heights  = reverseHeights(track.heights, trackLength(track))
  return {
    ...track,
    elements,
    coordinates: rebuildCoords(elements),
    ...(heights?.length ? { heights } : {}),
  }
}

/**
 * Join two tracks back into one at the node where `head` ends and `tail`
 * begins — the counterpart of splitElementAt / splitTrackAtJoint, which part a
 * track where a turnout is laid into it. Without it the halves outlive the
 * switch that made them: deleting the turnout would leave two fragments of one
 * line lying end to end, and the next one would part a fragment again.
 *
 * The two have to meet at that node and run the same way. Orienting them is the
 * caller's job, because only the caller knows which end of each the junction
 * was (see switchDelete.planSwitchDeletion, which reverses the piece that meets
 * it backwards). The elements are taken as they are: the joint may be a kink,
 * and merging what is continuous across it is a separate step
 * (switchDelete.mergeChain).
 *
 * The result keeps `head`'s id and metadata — `tail`'s id is the one that goes,
 * so every switch port naming it has to be repointed (`remapSwitches`). The
 * heights are the split's inverse (joinHeights): `tail`'s stations move up by
 * `head`'s length and the point they share at the joint is kept once.
 */
export function joinTracks(head, tail) {
  const elements = recalcAbsLengths([...(head.elements ?? []), ...(tail.elements ?? [])])
  const heights  = joinHeights(head.heights, tail.heights, trackLength(head))
  const { heights: _h, ...rest } = head
  return {
    ...rest,
    coordinates: rebuildCoords(elements),
    elements,
    ...(heights?.length ? { heights } : {}),
  }
}

/**
 * Where a track can be continued: the end of its last element — in its own
 * plane (`endUtm`, { easting, northing, zone }) and on the map (`endWgs`) —
 * with the bearing it leaves at and that element (`lastEl`, `lastIndex`).
 * Null for a track without elements.
 */
export function trackEndAnchor(track) {
  const lastIndex = (track?.elements?.length ?? 0) - 1
  if (lastIndex < 0) return null
  const lastEl = track.elements[lastIndex]
  const coords = lastEl.geometry?.coordinates
  const endWgs = coords?.length ? coords[coords.length - 1] : null
  if (!lastEl.endNode || !track.epsg) return null
  return {
    endUtm: { easting: lastEl.endNode[0], northing: lastEl.endNode[1], zone: track.epsg },
    endWgs,
    bearing: resolveEndBearing(lastEl, track.epsg),
    lastEl,
    lastIndex,
  }
}

/** How a dialog names a track: line / track number, else its name, else the start of its id. */
export function trackLabel(track) {
  if (!track) return '–'
  return [track.lineNumber, track.trackNumber].filter(Boolean).join(' / ') || track.name || track.id.slice(0, 8)
}
