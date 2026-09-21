import { useEffect, useRef, useState } from 'react'
import { loadTracks, loadSwitches, commitTrackEdit } from '../storage'
import { planElementChange, mergeElementEdits } from './panels/EditElementPanel/editGeometry'
import { transitionCantEnds } from '../utils/clothoidUtils'
import { crsLabel } from '../utils/coordinateUtils'
import { switchKindLabelKey, switchRouteLabelKey } from '../utils/switchModel'
import { elementStations } from '../utils/platformUtils'
import useTrackPick from '../hooks/useTrackPick'
import {
  cantSign, cantDefLevel, cantExceedsLimit, cantExceptionOf, cantLimit, computeCantDefSigned,
  computeMaxSpeed, designCantDef, limitCantDef, roundCant, filterForElement, FILTER_NONE,
  CANT_STEP, MAX_SWITCH_CANT_DEF, VMAX_CANT_DEF, mapIsLive,
} from '../utils/mapConstants'

const SELECTED_LAYER = 'tracks-selected-layer'

// Fields that reshape the element geometry (and the downstream chain).
const GEOM_KEYS = new Set(['length', 'bearing', 'radius'])

const isTransition = (el) => el.elementType === 2

// Speed is designed in 5 km/h steps, like cant is in 5 mm ones.
const SPEED_STEP = 5

// Line speed the table starts with — clearing the field lifts it again.
const DEFAULT_SPEED_CAP = 160

/**
 * Radius (m) and signed cant (mm) that govern an element's cant physics.
 * An arc carries both itself. Across a transition both ramp, so the tighter end
 * governs — and its cant is the one of the neighbouring element on that side,
 * or the ramp value a cut transition keeps there (transitionCantEnds, the same
 * rule the exchange export uses for the ramp ends). A straight has neither,
 * hence null: no deficiency, no curvature-imposed speed limit.
 */
function governing(elements, i) {
  const el = elements[i]
  // The radius comes back signed: cant that follows the curve helps, cant
  // against it (a bent switch's second route) adds to the deficiency, so the
  // sign has to survive as far as the deficiency and the speed limit.
  if (el.radius) return { radius: el.radius, cant: el.cant ?? 0 }
  if (isTransition(el)) {
    const r1 = el.r1 ? Math.abs(el.r1) : Infinity   // a null end runs into a straight
    const r2 = el.r2 ? Math.abs(el.r2) : Infinity
    if (!Number.isFinite(Math.min(r1, r2))) return null
    const ends = transitionCantEnds(elements, i)
    return r1 <= r2
      ? { radius: el.r1, cant: ends.start }
      : { radius: el.r2, cant: ends.end }
  }
  return null
}

/**
 * Every element's speed raised to what its geometry admits. A curved element —
 * an arc, or a transition, where the tighter end governs — is capped by the cant
 * deficiency its radius and cant leave room for, rounded DOWN onto the 5 km/h
 * design step so the limit is never overshot. A straight has no curvature of its
 * own to limit it: it takes the faster of the curves it runs between, looking
 * past any straights in between since those carry no limit either. An element
 * with no curve on either side keeps the speed it had — nothing bounds it.
 *
 * `cap` is the line speed, the ceiling nothing may exceed. It is applied last,
 * so it also trims an element the geometry leaves unbounded; null means the
 * geometry alone decides.
 */
function maxSpeeds(elements, cap) {
  // Pass one: the curves. null marks an element the curvature does not limit.
  const curved = elements.map((el, i) => {
    const g = governing(elements, i)
    if (!g) return null
    const v = computeMaxSpeed(g.radius, g.cant, designCantDef(el))
    return v == null ? null : Math.floor(v / SPEED_STEP) * SPEED_STEP
  })

  // Pass two: the straights, from the nearest curve on either side.
  return elements.map((el, i) => {
    let v = curved[i]
    if (v == null) {
      for (let j = i - 1; j >= 0; j--) if (curved[j] != null) { v = curved[j]; break }
      for (let j = i + 1; j < elements.length; j++) if (curved[j] != null) { v = Math.max(v ?? 0, curved[j]); break }
    }
    // Nothing bounds this one: it keeps its speed, and only the cap may trim it.
    if (v == null) return cap != null && el.speed > cap ? { ...el, speed: cap } : el
    const speed = cap == null ? v : Math.min(v, cap)
    return el.speed === speed ? el : { ...el, speed }
  })
}

export default function TrackTableOverlay({
  track, project, map, storeVersion, initialRow, onPickTrack, onDirtyChange, onClose, onSaved, t,
}) {
  // Keep the full track set as working state — a geometry edit propagates to
  // connected following elements/tracks, so we edit and persist all of them.
  const [tracks, setTracks] = useState(() => loadTracks(project.id))
  const [draft, setDraft]   = useState(null)   // { row, key, value } – the cell being typed in
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
  const [seenVersion, setSeenVersion] = useState(storeVersion)
  if (seenVersion !== storeVersion) {
    setSeenVersion(storeVersion)
    setTracks(loadTracks(project.id))
    setChanged([])
    setReached({ trackIds: [], switchIds: [] })
    setReachError(null)
    setDraft(null)
    setNotice(dirty ? 'table_edits_dropped' : null)
  }

  if (draftTrackId !== track.id) {
    setDraftTrackId(track.id)
    setDraft(null)
    setActiveRow(pendingRow ?? 0)
    setPendingRow(null)
    setReachError(null)
  }

  // Draw the active row's element in red on the map — the tracks-selected-layer
  // is the app's own selection highlight, the same one the edit forms drive.
  // It is released again when the table closes or the row changes.
  useEffect(() => {
    const m = map?.current
    if (!m?.getLayer(SELECTED_LAYER)) return
    m.setFilter(SELECTED_LAYER, activeRow == null ? FILTER_NONE : filterForElement(track.id, activeRow))
    return () => { if (mapIsLive(map, m) && m.getLayer(SELECTED_LAYER)) m.setFilter(SELECTED_LAYER, FILTER_NONE) }
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
    const el = loadTracks(project.id).find(tr => tr.id === track.id)?.elements?.[activeRow]
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
  useTrackPick(map, true, ({ trackId, elementIndex }) => {
    if (trackId === track.id) {
      pickedOnMap.current = elementIndex
      setActiveRow(elementIndex)
      return
    }
    const picked = loadTracks(project.id).find(tr => tr.id === trackId)
    if (!picked || !onPickTrack) return
    pickedOnMap.current = elementIndex
    setPendingRow(elementIndex)
    onPickTrack(picked)
  }, { prefer: track.id })

  const current  = tracks.find(tr => tr.id === track.id) ?? track
  const elements = current.elements ?? []
  // Where each element starts along the track, and how long the whole of it is
  // — from the working copy, so both follow an unsaved length straight away.
  const stations = elementStations(current)
  const trackLength = stations.length ? stations[stations.length - 1].end : 0

  // Every switch of the project by its id: an element of a switch route is
  // named by the record, which is where the kind and the form it was built from
  // stand. Read on each render rather than held — a name can change under an
  // open table.
  const switchById = new Map(loadSwitches(project.id).map(sw => [sw.switchId, sw]))

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
      const plan = planElementChange(tracks, loadSwitches(project.id), track.id, row, { [key]: value })
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

  // What the cant cell says about itself: over its limit it is an error — the
  // element is not buildable until the cant comes down or a reason is written
  // for it — and on a standing exception it carries that reason as its note.
  const cantNote = (el) => {
    if (cantExceedsLimit(el)) return t('table_cant_over_limit').replace('{{mm}}', String(cantLimit(el)))
    const reason = cantExceptionOf(el)
    return reason ? t('table_cant_exception_note').replace('{{text}}', reason) : undefined
  }

  // Over the limit reads as an error, a standing exception as a mark, and the
  // ordinary case as nothing at all.
  const cantClass = (el) => (cantExceedsLimit(el) ? 'input-error'
    : cantExceptionOf(el) ? 'track-table-input-exception' : '')

  // An element the MDB import found a switch on but could not build into one
  // says so on its type — the alignment is there, the switch is not, and the
  // track must not read as plain running line.
  const hintNote = (el) => (el.switchHint
    ? t('table_switch_hint').replace('{{text}}', el.switchHint) : undefined)

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
    const next = mergeElementEdits(loadTracks(project.id), tracks,
      { changed, reshaped: reached.trackIds })
    commitTrackEdit(project.id, next, reached.switchIds)
    // Start again from what was written: the working copy is the store's again,
    // with no old field of a track left over from before it was opened.
    setTracks(loadTracks(project.id))
    setChanged([])
    setNotice(null)
    setReached({ trackIds: [], switchIds: [] })
    onSaved?.()
  }

  // A transition is neither straight nor arc — it is named by its own curvature
  // profile (clothoid or Bloss), which is what the element chain stores.
  const geometryLabel = (el) => isTransition(el)
    ? t(el.transitionType === 'bloss' ? 'table_type_bloss' : 'table_type_transition')
    : t(el.radius ? 'table_type_arc' : 'table_type_straight')

  /**
   * What the type column says. An element of a switch route is named by the
   * switch — a turnout, a crossing or a crossing switch, and the form it was
   * built to — because that is what lies there: a row reading "straight" over a
   * turnout's through route says nothing about the turnout. The geometry has
   * not gone anywhere; it stands in the radius and length columns, and in the
   * cell's tooltip beside the switch's name and the route this is.
   */
  const typeLabel = (el) => {
    if (!el.switchBranch) return geometryLabel(el)
    const sw   = switchById.get(el.switchId)
    const kind = t(switchKindLabelKey(sw?.kind))
    const form = sw?.label ?? el.switchLabel
    return form ? `${kind} ${form}` : kind
  }

  // Which switch this is, which of its routes, and the geometry the switch's
  // name stands in front of.
  const switchNote = (el) => {
    if (!el.switchBranch) return undefined
    const sw       = switchById.get(el.switchId)
    const routeKey = switchRouteLabelKey(sw?.kind, el.switchRoute)
    return [sw?.name || el.switchName, routeKey && t(routeKey), geometryLabel(el)]
      .filter(Boolean).join(' · ')
  }

  /**
   * What the deficiency of a row says about it, as a cell class and a note:
   * past the limit the element may be built with it is an error, past what its
   * speed should have been designed against it is marked but not refused — the
   * same two levels, and the same colours, the cant column already uses.
   * Both cells that are about it say it: the deficiency, and the speed that
   * made it.
   */
  const defLevel = (el, cantDef) => cantDefLevel(el, cantDef)

  const defClass = (level) => (level === 'over' ? 'input-error'
    : level === 'design' ? 'track-table-input-exception' : '')

  const defNote = (el, level, cantDef, vMax) => {
    if (!level) return undefined
    const key = level === 'over' ? 'table_cant_def_over' : 'table_cant_def_design'
    return t(key)
      .replace('{{mm}}', String(level === 'over' ? limitCantDef(el) : designCantDef(el)))
      .replace('{{is}}', String(cantDef))
      .replace('{{v}}', String(vMax ?? '–'))
  }

  // A bearing is shown, never typed: an element starts where the one before it
  // ended, and the chain is what sets that. Typing one here would turn a single
  // cell into a rotation of everything behind it.
  const degText = (deg) => (Number.isFinite(deg) ? deg.toFixed(2) : '–')

  // A length that is read rather than typed is shown to the millimetre — it is
  // a dimension of the turnout's form, not a number anyone has to match.
  const lengthText = (m) => (Number.isFinite(m) ? String(Math.round(m * 1000) / 1000) : '–')

  // A transition has no single radius: it runs from r1 to r2 (∞ on the straight
  // end), so the column shows that ramp instead of an empty, uneditable cell.
  const radiusText = (el) => {
    const r = (v) => (v ? String(Math.round(v * 100) / 100) : '∞')
    return `${r(el.r1)} → ${r(el.r2)}`
  }

  // Read-only cell, styled like the editable ones; `wide` for text that does not
  // fit a number column (type label, radius ramp). What such a cell has to say
  // about itself is titled on the <td> around it, not here: a disabled input
  // takes no pointer events (it would swallow the row's click), so a tooltip on
  // it would never open.
  const textCell = (value, { wide = false, className = '' } = {}) => (
    <input className={`track-table-input${wide ? ' track-table-input-wide' : ''}${className ? ` ${className}` : ''}`}
      disabled readOnly value={value} />
  )

  // Editable cell with a typing draft committed on blur / Enter. Numeric unless
  // told otherwise — the justification is the one text column among them.
  const editCell = (i, key, rawValue, {
    disabled = false, step, type = 'number', wide = false, className = '', placeholder,
  } = {}) => {
    const editing = draft && draft.row === i && draft.key === key
    return (
      <input
        className={`track-table-input${wide ? ' track-table-input-wide' : ''}${className ? ` ${className}` : ''}`}
        type={type}
        disabled={disabled}
        step={step}
        placeholder={placeholder}
        value={editing ? draft.value : (rawValue ?? '')}
        onFocus={() => setDraft({ row: i, key, value: rawValue == null ? '' : String(rawValue) })}
        onChange={e => setDraft(d => (d ? { ...d, value: e.target.value } : d))}
        onBlur={() => {
          // Only a real change is committed — merely tabbing through a cell must
          // not rebuild the element and re-chain everything behind it.
          if (editing && draft.value !== String(rawValue ?? '')) commit(i, key, draft.value)
          setDraft(null)
        }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      />
    )
  }

  return (
    <div className="track-table-overlay">
      <div className="track-table-header">
        <span className="track-table-title">
          {current.name || current.id.slice(0, 8)}
          <span className="track-table-subtitle">{lengthText(trackLength)} m</span>
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="track-table-cap" title={t('table_speed_cap_hint')}>
            {t('table_speed_cap')}
            <input className="track-table-input track-table-cap-input"
              type="number" min="0" step={SPEED_STEP} placeholder="–"
              value={cap} onChange={e => setCap(e.target.value)} />
          </label>
          <button className="track-table-vmax-btn" onClick={handleMaxSpeeds}
            title={t('table_set_max_speeds_hint')}>{t('table_set_max_speeds')}</button>
          {reachError && <span className="track-table-reach-error">{t(reachError)}</span>}
          {!reachError && notice && <span className="track-table-reach">{t(notice)}</span>}
          {!reachError && !notice && reached.trackIds.length > 1 && (
            <span className="track-table-reach">
              {t('table_edit_reach')
                .replace('{{tracks}}', String(reached.trackIds.length))
                .replace('{{switches}}', String(reached.switchIds.length))}
            </span>
          )}
          {/* Nothing here is written until this is pressed, so it says whether
              anything is waiting — and on how many tracks, since an edit reaches
              past the one on screen. */}
          <button className={`track-table-save-btn${dirty ? ' track-table-save-btn-dirty' : ''}`}
            onClick={handleSave} disabled={!dirty}
            title={dirty ? t('table_unsaved').replace('{{tracks}}', String(changed.length)) : undefined}>
            {dirty ? `${t('btn_save')} •` : t('btn_save')}
          </button>
          <button className="track-table-close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="track-table-scroll">
        <table className="track-table">
          <thead>
            <tr>
              <th>#</th>
              <th title={t('table_station_hint')}>{t('table_station')} (m)</th>
              <th>{t('table_type')}</th>
              <th>{t('table_bearing')} (°)</th>
              <th>{t('table_end_bearing')} (°)</th>
              <th>{t('table_length')} (m)</th>
              <th>{t('table_radius')} (m)</th>
              <th>{t('table_speed')} (km/h)</th>
              <th>{t('table_cant')} (mm)</th>
              <th>{t('table_cant_exception')}</th>
              <th>{t('table_cant_def')} (mm)</th>
              <th title={t('table_max_speed_hint')
                .replace('{{mm}}', String(VMAX_CANT_DEF))
                .replace('{{sw}}', String(MAX_SWITCH_CANT_DEF))}>{t('table_max_speed')} (km/h)</th>
              <th title={t('table_crs_hint')}>{t('table_crs')}</th>
            </tr>
          </thead>
          <tbody>
            {elements.map((el, i) => {
              // Derived, read-only: both follow the speed/cant/radius cells live.
              const g       = governing(elements, i)
              const cantDef = g ? computeCantDefSigned(el.speed ?? 0, g.radius, g.cant) : 0
              const vMax    = g ? computeMaxSpeed(g.radius, g.cant, designCantDef(el)) : null
              const level   = defLevel(el, cantDef)
              const defTip  = defNote(el, level, cantDef, vMax)
              return (
                // Clicking anywhere in the row activates it; onFocus covers
                // tabbing into one of its cells (React focus events bubble).
                <tr key={i}
                  className={i === activeRow ? 'track-table-row-active' : undefined}
                  onClick={() => setActiveRow(i)}
                  onFocus={() => setActiveRow(i)}>
                  <td>{i + 1}</td>
                  <td>{textCell(lengthText(stations[i]?.start))}</td>
                  <td title={hintNote(el) ?? switchNote(el)}>{textCell(typeLabel(el), {
                    wide: true,
                    className: el.switchHint ? 'track-table-input-exception' : '',
                  })}</td>
                  <td>{textCell(degText(el.bearing))}</td>
                  <td>{textCell(degText(el.endBearing))}</td>
                  {/* A switch route's length is its form's dimension: retyping
                      it would move the turnout's ends while the record that
                      states them stands still. */}
                  <td title={el.switchBranch ? t('table_switch_dimension') : undefined}>
                    {el.switchBranch
                      ? textCell(lengthText(el.length))
                      : editCell(i, 'length', el.length)}
                  </td>
                  <td title={el.switchBranch && !isTransition(el) && el.radius ? t('table_switch_dimension') : undefined}>
                    {isTransition(el)
                      ? textCell(radiusText(el), { wide: true })
                      : el.switchBranch
                        ? textCell(el.radius ? lengthText(el.radius) : '–')
                        : editCell(i, 'radius', el.radius, { disabled: !el.radius })}
                  </td>
                  {/* The speed is the cell to change when the deficiency it
                      makes is too high, so it carries the same mark. */}
                  <td title={defTip}>{editCell(i, 'speed', el.speed, { className: defClass(level) })}</td>
                  {/* Cant ramps across a transition — its ends belong to the
                      neighbouring elements, so there is nothing to edit here. */}
                  <td title={cantNote(el)}>{isTransition(el)
                    ? textCell('–', { className: cantClass(el) })
                    : editCell(i, 'cant', el.cant, {
                      step: CANT_STEP, className: cantClass(el),
                    })}</td>
                  {/* Only a switch route knows the 100 mm limit, so only there is
                      there anything to justify — including a route laid into a
                      cant ramp, whose own cant cell is not editable. */}
                  <td title={el.switchBranch ? cantNote(el) : undefined}>{el.switchBranch
                    ? editCell(i, 'cantException', el.cantException, {
                      type: 'text', wide: true, placeholder: '–',
                      className: cantClass(el),
                    })
                    : textCell('–')}</td>
                  <td title={defTip}>{textCell(cantDef, { className: defClass(level) })}</td>
                  <td>{textCell(vMax != null ? vMax : '–')}</td>
                  {/* The plane the whole track is stated in — one code per
                      track, so the column reads the same all the way down and
                      says which frame these eastings and northings are in. */}
                  <td title={crsLabel(current.epsg)}>{textCell(current.epsg ?? '–')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
