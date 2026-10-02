import { useEffect, useRef, useState } from 'react'
import { loadTracks, loadSwitches, commitTrackEdit } from '../storage'
import { useTracks, useProject } from '../hooks/useStore'
import { planElementChange, mergeElementEdits } from '../utils/editGeometry'
import { elementStations } from '../utils/platformUtils'
import { checkTrack } from '../utils/trassierungCheck'
import { cantSign, cantLimit, roundCant } from '../utils/rules/cant'
import { maxSpeeds } from '../utils/rules/speed'
import { filterForElement, FILTER_NONE, mapIsLive } from '../map/pick'
import { useMap } from '../map/MapContext'
import { TRACKS_SELECTED_LAYER } from '../map/layerIds'
import useMapPick from '../map/useMapPick'
import TrackTableRow from './trackTable/TrackTableRow'
import { TrackTableBar, TrackTableHead } from './trackTable/TrackTableHeader'

// Fields that reshape the element geometry (and the downstream chain).
const GEOM_KEYS = new Set(['length', 'bearing', 'radius'])

// Line speed the table starts with — clearing the field lifts it again.
const DEFAULT_SPEED_CAP = 160

/**
 * The element table of one track (R5.2: the rows, cells and bar are their own
 * components, the speed rules live in utils/rules/speed). It edits a working
 * copy of every track — a geometry edit reaches the tracks connected behind
 * the element — and writes it back on Save.
 */
export default function TrackTableOverlay({
  track, initialRow, onPickTrack, onDirtyChange, onClose}) {
  const map = useMap()
  const project = useProject()
  // Keep the full track set as working state — a geometry edit propagates to
  // connected following elements/tracks, so we edit and persist all of them.
  const [tracks, setTracks] = useState(() => loadTracks())
  // Row whose element the map highlights — picking a track starts on its first,
  // unless the pick itself named one (a click on the map): initialRow.
  const [activeRow, setActiveRow] = useState(() => initialRow ?? 0)
  // Line speed: the ceiling no element may exceed, kept as typed text so a
  // half-entered number does not read as a cap of 1. Empty = geometry only;
  // it starts at the 160 km/h most of the network is built for.
  const [cap, setCap] = useState(String(DEFAULT_SPEED_CAP))
  const capValue = Number(cap) > 0 ? Number(cap) : null

  // The panel behind the overlay lists every track, so another one can be picked
  // while this stays mounted. A half-typed cell of the previous track must not
  // carry over into the same row/column of the new one, and the highlight moves
  // to the new track's first element.
  // What the edits made so far have reached, and why the last one was refused.
  // Both are the editor's own reach (AP 5.1), not the table's content.
  const [reached, setReached] = useState({ trackIds: [], switchIds: [] })
  const [reachError, setReachError] = useState(null)
  // Every track whose elements the table has changed and not yet written. It is
  // what Save puts back — the working copy holds all of them, touched or not —
  // and what makes the table dirty.
  const [changed, setChanged] = useState([])
  // A one-off word to the user about something that happened to the table
  // rather than in it (so far: an undo took its edits away).
  const [notice, setNotice] = useState(null)

  const dirty = changed.length > 0
  // The close paths all sit outside this component (the ✕, the panel's back
  // button, another icon, the start page), so what is at stake there has to be
  // known there too.
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const [draftTrackId, setDraftTrackId] = useState(track.id)
  // The row a click on the map asked for. Which track the table shows is App's
  // to decide, so a click on another one leaves through onPickTrack and comes
  // back as a new `track` prop — the row it meant waits here for it.
  const [pendingRow, setPendingRow] = useState(null)
  // …and the row it picked, which the fit below reads to tell a row that came
  // off the map from one picked in the table. Opening the table itself from a
  // map click is the same case, so it starts out already holding that row.
  const pickedOnMap = useRef(initialRow ?? null)

  // An undo moves the store back under the table. The working copy is a snapshot
  // of every track (planElementChange rebuilds them all), so it would otherwise
  // go on showing the state that was just taken back — and write it out again on
  // the next Save. It is re-read instead, and unsaved edits are gone with the
  // step they were sitting on, which is said rather than left to be noticed.
  // The table's own Save is no such move: it notes what it wrote (`seen`).
  const storeTracks = useTracks()
  const [seen, setSeen] = useState(storeTracks)
  if (seen !== storeTracks) {
    setSeen(storeTracks)
    setTracks(storeTracks)
    setChanged([])
    setReached({ trackIds: [], switchIds: [] })
    setReachError(null)
    setNotice(dirty ? 'table_edits_dropped' : null)
  }

  if (draftTrackId !== track.id) {
    setDraftTrackId(track.id)
    setActiveRow(pendingRow ?? 0)
    setPendingRow(null)
    setReachError(null)
  }

  // Draw the active row's element in red on the map — the tracks-selected-layer
  // is the app's own selection highlight, the same one the edit forms drive.
  // It is released again when the table closes or the row changes.
  useEffect(() => {
    const m = map?.current
    if (!m?.getLayer(TRACKS_SELECTED_LAYER)) return
    m.setFilter(TRACKS_SELECTED_LAYER, activeRow == null ? FILTER_NONE : filterForElement(track.id, activeRow))
    return () => { if (mapIsLive(map, m) && m.getLayer(TRACKS_SELECTED_LAYER)) m.setFilter(TRACKS_SELECTED_LAYER, FILTER_NONE) }
  }, [map, track.id, activeRow])

  // …and frame it. The geometry comes from the store, not from the working copy:
  // the store is what the map draws, so the viewport matches the red line even
  // while unsaved geometry edits sit in the table. The overlay covers the lower
  // half of the map, so that much room is left free below the element.
  useEffect(() => {
    const m = map?.current
    if (!m || activeRow == null) return
    // Unless the row was picked on the map: the element is under the cursor
    // already, and flying to it would pull the view out from under the click.
    const picked = pickedOnMap.current
    pickedOnMap.current = null
    if (picked === activeRow) return
    const el = loadTracks().find(tr => tr.id === track.id)?.elements?.[activeRow]
    const coords = el?.geometry?.coordinates
    if (!coords?.length) return

    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
    for (const [lng, lat] of coords) {
      west = Math.min(west, lng); east = Math.max(east, lng)
      south = Math.min(south, lat); north = Math.max(north, lat)
    }

    // Padding is clamped so it never outgrows a small map pane — fitBounds has
    // no room left to compute a zoom from otherwise.
    const canvas = m.getCanvas()
    const bottom = Math.min(Math.round(canvas.clientHeight / 2) + 40, Math.max(0, canvas.clientHeight - 140))
    const side   = Math.min(60, Math.max(0, Math.floor(canvas.clientWidth / 2) - 40))
    m.fitBounds([[west, south], [east, north]], {
      padding: { top: Math.min(60, bottom), bottom, left: side, right: side },
      maxZoom: 18,
      duration: 400,
    })
  }, [map, project.id, track.id, activeRow])

  // While the table is up it takes the clicks on the map itself, because it is
  // the one that can tell a row from a track: a click on the track it shows
  // activates that element's row, a click on another one hands that track back
  // to App, which swaps the table over to it — carrying the row that was meant.
  // The hover layer is left alone here; App draws the whole open track on it.
  useMapPick({ prefer: track.id, onPick: ({ trackId, elementIndex }) => {
    if (trackId === track.id) {
      pickedOnMap.current = elementIndex
      setActiveRow(elementIndex)
      return
    }
    const picked = loadTracks().find(tr => tr.id === trackId)
    if (!picked || !onPickTrack) return
    pickedOnMap.current = elementIndex
    setPendingRow(elementIndex)
    onPickTrack(picked)
  } })

  const current  = tracks.find(tr => tr.id === track.id) ?? track
  const elements = current.elements ?? []

  // What the rule catalogue says about this chain (AP R.7). It belongs here of
  // all places: this table is where the speed, the cant and the radius a rule
  // reads are typed, so the verdict lands in the same row as its cause —
  // recomputed from the saved chain, which is what the rules are about. Left
  // to the React compiler to hold on to rather than memoised by hand: a manual
  // useMemo here is what makes it give up on the whole component.
  const check = checkTrack(elements)
  // Where each element starts along the track, and how long the whole of it is
  // — from the working copy, so both follow an unsaved length straight away.
  const stations = elementStations(current)
  const trackLength = stations.length ? stations[stations.length - 1].end : 0

  // Every switch of the project by its id: an element of a switch route is
  // named by the record, which is where the kind and the form it was built from
  // stand. Read on each render rather than held — a name can change under an
  // open table.
  const switchById = new Map(loadSwitches().map(sw => [sw.switchId, sw]))

  // Apply one cell edit. Geometry fields go through applyElementChange (which
  // recomputes coordinates/nodes/end bearing and re-chains); speed/cant are plain
  // metadata written straight onto the element. Values the geometry cannot carry
  // (length ≤ 0, radius 0 = infinite curvature) are rejected rather than stored.
  function commit(row, key, raw) {
    const isEmpty = raw === '' || raw == null
    if (GEOM_KEYS.has(key)) {
      let value
      if (key === 'radius') {
        value = isEmpty ? null : Number(raw)            // cleared radius → straight
        if (value != null && (!Number.isFinite(value) || value === 0)) return
      } else {
        if (isEmpty) return                             // length/bearing must stay numeric
        value = Number(raw)
        if (!Number.isFinite(value)) return
        if (key === 'length' && value <= 0) return
      }
      // A geometry edit reaches past its own element; how far is worked out
      // first, and a change that reaches too far is refused rather than written
      // (AP 5.1). The cell falls back to the stored value on its own, since the
      // tracks it reads from are the ones that did not change.
      const plan = planElementChange(tracks, loadSwitches(), track.id, row, { [key]: value })
      if (plan.error) { setReachError(plan.error); return }
      setReachError(null)
      setNotice(null)
      setReached(prev => ({
        trackIds:  [...new Set([...prev.trackIds, ...plan.touchedTrackIds])],
        switchIds: [...new Set([...prev.switchIds, ...plan.touchedSwitchIds])],
      }))
      // A geometry change re-shapes every track it reaches, not just this one.
      setChanged(prev => [...new Set([...prev, ...plan.touchedTrackIds])])
      setTracks(plan.tracks)
    } else if (key === 'cantException') {
      // The justification is a free text, and the text *is* the exception:
      // emptying the field takes the limit straight back to 100 mm, and the cant
      // that stands there is then marked as over it rather than quietly trimmed.
      setMeta(row, key, isEmpty ? undefined : String(raw).trim() || undefined)
    } else {
      const value = isEmpty ? undefined : clampMeta(key, Number(raw), elements[row])
      if (value != null && !Number.isFinite(value)) return
      setMeta(row, key, value)
    }
  }

  // Write one metadata field onto one element of the edited track.
  function setMeta(row, key, value) {
    setNotice(null)
    setChanged(prev => (prev.includes(track.id) ? prev : [...prev, track.id]))
    setTracks(prev => prev.map(tr => tr.id !== track.id ? tr : {
      ...tr,
      elements: (tr.elements ?? []).map((el, idx) => idx === row ? { ...el, [key]: value } : el),
    }))
  }

  // Speed and cant follow the same bounds the create/connect forms enforce: no
  // negative speed, cant on the 5 mm design step and signed by the curve it sits
  // in, within what the element may carry — the line's 170 mm, or a switch
  // route's 100, raised to 120 only by the justification already on the element.
  // So the reason is typed first and the cant second; the other order clamps.
  function clampMeta(key, value, el) {
    if (!Number.isFinite(value)) return value
    if (key === 'speed') return Math.min(Math.max(0, value), capValue ?? Infinity)
    if (key === 'cant') {
      const magnitude = Math.min(cantLimit(el), roundCant(Math.abs(value)))
      return el?.radius ? cantSign(el.radius) * magnitude : Math.sign(value) * magnitude
    }
    return value
  }

  // Speed column filled with the highest value the geometry allows. Only the
  // metadata changes, so the element chain stands as it is; Save persists it.
  function handleMaxSpeeds() {
    setNotice(null)
    setChanged(prev => (prev.includes(track.id) ? prev : [...prev, track.id]))
    setTracks(prev => prev.map(tr => tr.id !== track.id
      ? tr
      : { ...tr, elements: maxSpeeds(tr.elements ?? [], capValue) }))
  }

  function handleSave() {
    if (!dirty) return
    // Onto the store as it stands now, and only what this table changed —
    // mergeElementEdits says what that is. The working copy carries every track
    // of the project, so writing it back whole would take the store with it.
    // The switches the edits reached get their symbols rebuilt in the same step
    // — they are derived from these very tracks.
    const next = mergeElementEdits(loadTracks(), tracks,
      { changed, reshaped: reached.trackIds })
    commitTrackEdit(next, reached.switchIds)
    // Start again from what was written: the working copy is the store's again,
    // with no old field of a track left over from before it was opened.
    setSeen(loadTracks())
    setTracks(loadTracks())
    setChanged([])
    setNotice(null)
    setReached({ trackIds: [], switchIds: [] })
  }

  return (
    <div className="track-table-overlay">
      <TrackTableBar title={current.name || current.id.slice(0, 8)} length={trackLength}
        cap={cap} onCap={setCap} onMaxSpeeds={handleMaxSpeeds}
        reachError={reachError} notice={notice} reached={reached}
        dirty={dirty} changed={changed.length} onSave={handleSave} onClose={onClose} />
      <div className="track-table-scroll">
        <table className="track-table">
          <TrackTableHead />
          {/* Keyed by the track, so a half-typed cell of the previous one does
              not carry over into the same row of the next. */}
          <tbody key={track.id}>
            {elements.map((el, i) => (
              <TrackTableRow key={i} elements={elements} i={i} sw={switchById.get(el.switchId)}
                station={stations[i]?.start} rules={check.perElement[i]} epsg={current.epsg}
                active={i === activeRow} onActivate={() => setActiveRow(i)}
                onEdit={(key, raw) => commit(i, key, raw)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
