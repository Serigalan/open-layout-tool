import { useEffect, useRef } from 'react'
import { useMap } from './MapContext'
import useMapEvents from './useMapEvents'
import { TRACKS_HOVER_LAYER, TRACKS_LAYER, TRACKS_SELECTED_LAYER } from './layerIds'
import { FILTER_NONE, filterForElement, filterForElements, filterForSwitch, filterForTrack, mapIsLive, notSwitchBranch, pickAt } from './pick'

/**
 * Picking on the map (R3.1) — the one way a panel asks the user to click a
 * track, an element or a switch. While `active`:
 *
 *   onPick(hit, event)  a click on something: hit as pickAt gives it
 *                       ({ trackId, elementIndex, switchId, … }); event.lngLat
 *                       is where exactly
 *   onMiss(event)       a click on nothing
 *
 * Options:
 *   layers         what is asked, in order (default: the tracks)
 *   accept(props)  which features count at all
 *   noSwitchBranch leave a switch's own branch elements out
 *   track          only this track's elements
 *   prefer         settle an overlap in favour of this track
 *   hover          'element' | 'track' | null — draw what is under the cursor
 *                  on the hover layer
 *   cursor         a pointer over what can be picked (default true)
 */
export default function useMapPick({
  active = true, onPick, onMiss, layers = [TRACKS_LAYER], accept = null,
  noSwitchBranch = false, track = null, prefer = null, hover = null, cursor = true,
}) {
  const mapRef = useMap()
  const test = (p) => (!noSwitchBranch || notSwitchBranch(p)) && (track == null || p.trackId === track) && (!accept || accept(p))
  const opts = { layers, accept: test, prefer }
  const pick = (e, m) => pickAt(m, e.point, opts)

  useMapEvents(active, {
    click: (e, m) => {
      const hit = pick(e, m)
      if (hit) onPick?.(hit, e)
      else onMiss?.(e)
    },
    ...(hover || cursor ? {
      mousemove: (e, m) => {
        const hit = pick(e, m)
        if (cursor) m.getCanvas().style.cursor = hit ? 'pointer' : ''
        if (hover && m.getLayer(TRACKS_HOVER_LAYER)) {
          m.setFilter(TRACKS_HOVER_LAYER, !hit?.trackId ? FILTER_NONE
            : hover === 'track' ? filterForTrack(hit.trackId) : filterForElement(hit.trackId, hit.elementIndex))
        }
      },
    } : {}),
  })

  // Give back what was borrowed once picking ends.
  useEffect(() => {
    const m = active ? mapRef.current : null
    if (!m) return undefined
    return () => {
      if (!mapIsLive(mapRef, m)) return
      if (cursor) m.getCanvas().style.cursor = ''
      if (hover && m.getLayer(TRACKS_HOVER_LAYER)) m.setFilter(TRACKS_HOVER_LAYER, FILTER_NONE)
    }
  }, [mapRef, active, cursor, hover])
}

/** The selection-layer filter for a selection: { switchId } | { trackId, elementIndex? } | null. */
function selectionFilter(sel) {
  if (!sel) return FILTER_NONE
  if (sel.switchId) return filterForSwitch(sel.switchId)
  if (sel.elements) {
    // Several elements, on one track or more.
    const byTrack = new Map()
    for (const { trackId, elementIndex } of sel.elements) byTrack.set(trackId, [...(byTrack.get(trackId) ?? []), elementIndex])
    return byTrack.size ? ['any', ...[...byTrack].map(([id, idx]) => filterForElements(id, idx))] : FILTER_NONE
  }
  if (sel.elementIndex != null) return filterForElement(sel.trackId, sel.elementIndex)
  if (sel.trackId) return filterForTrack(sel.trackId)
  return FILTER_NONE
}

/**
 * What a panel has picked, drawn on the selection layer (R3.1) — a switch,
 * a whole track, one element or several (`elements`: [{ trackId,
 * elementIndex }]) — for as long as the panel shows it, and
 * cleared once it does not or the panel closes.
 */
export function useSelectedOnMap(selection) {
  const mapRef = useMap()
  const key = selection ? JSON.stringify([selection.switchId ?? null, selection.trackId ?? null, selection.elementIndex ?? null, selection.elements ?? null]) : ''
  const sel = useRef(selection)
  useEffect(() => { sel.current = selection })
  useEffect(() => {
    const m = mapRef.current
    if (!m?.getLayer(TRACKS_SELECTED_LAYER)) return undefined
    m.setFilter(TRACKS_SELECTED_LAYER, selectionFilter(sel.current))
    return () => { if (mapIsLive(mapRef, m) && m.getLayer(TRACKS_SELECTED_LAYER)) m.setFilter(TRACKS_SELECTED_LAYER, FILTER_NONE) }
  }, [mapRef, key])
}
