import { useEffect, useState } from 'react'
import { loadTracks, replaceAllTracks } from '../storage'
import { applyElementChange } from './panels/EditElementPanel/editGeometry'
import {
  cantSign, computeCantDefSigned, computeMaxSpeed, roundCant, filterForElement, FILTER_NONE, CANT_STEP, MAX_CANT, MAX_CANT_DEF, MAX_SWITCH_CANT_DEF, mapIsLive,
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
 * governs — and its cant is the one of the neighbouring element on that side
 * (same rule the OSRD export uses for the ramp ends). A straight has neither,
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
    return r1 <= r2
      ? { radius: el.r1, cant: elements[i - 1]?.cant ?? 0 }
      : { radius: el.r2, cant: elements[i + 1]?.cant ?? 0 }
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
    const v = computeMaxSpeed(g.radius, g.cant, el.switchBranch ? MAX_SWITCH_CANT_DEF : MAX_CANT_DEF)
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

export default function TrackTableOverlay({ track, project, map, onClose, onSaved, t }) {
  // Keep the full track set as working state — a geometry edit propagates to
  // connected following elements/tracks, so we edit and persist all of them.
  const [tracks, setTracks] = useState(() => loadTracks(project.id))
  const [draft, setDraft]   = useState(null)   // { row, key, value } – the cell being typed in
  // Row whose element the map highlights — picking a track starts on its first.
  const [activeRow, setActiveRow] = useState(0)
  // Line speed: the ceiling no element may exceed, kept as typed text so a
  // half-entered number does not read as a cap of 1. Empty = geometry only;
  // it starts at the 160 km/h most of the network is built for.
  const [cap, setCap] = useState(String(DEFAULT_SPEED_CAP))
  const capValue = Number(cap) > 0 ? Number(cap) : null

  // The panel behind the overlay lists every track, so another one can be picked
  // while this stays mounted. A half-typed cell of the previous track must not
  // carry over into the same row/column of the new one, and the highlight moves
  // to the new track's first element.
  const [draftTrackId, setDraftTrackId] = useState(track.id)
  if (draftTrackId !== track.id) {
    setDraftTrackId(track.id)
    setDraft(null)
    setActiveRow(0)
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

  const current  = tracks.find(tr => tr.id === track.id) ?? track
  const elements = current.elements ?? []

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
      setTracks(prev => applyElementChange(prev, track.id, row, { [key]: value }))
    } else {
      const value = isEmpty ? undefined : clampMeta(key, Number(raw), elements[row])
      if (value != null && !Number.isFinite(value)) return
      setTracks(prev => prev.map(tr => tr.id !== track.id ? tr : {
        ...tr,
        elements: (tr.elements ?? []).map((el, idx) => idx === row ? { ...el, [key]: value } : el),
      }))
    }
  }

  // Speed and cant follow the same bounds the create/connect forms enforce: no
  // negative speed, cant on the 5 mm design step, within ±170 mm and signed by
  // the curve it sits in.
  function clampMeta(key, value, el) {
    if (!Number.isFinite(value)) return value
    if (key === 'speed') return Math.min(Math.max(0, value), capValue ?? Infinity)
    if (key === 'cant') {
      const magnitude = Math.min(MAX_CANT, roundCant(Math.abs(value)))
      return el?.radius ? cantSign(el.radius) * magnitude : Math.sign(value) * magnitude
    }
    return value
  }

  // Speed column filled with the highest value the geometry allows. Only the
  // metadata changes, so the element chain stands as it is; Save persists it.
  function handleMaxSpeeds() {
    setTracks(prev => prev.map(tr => tr.id !== track.id
      ? tr
      : { ...tr, elements: maxSpeeds(tr.elements ?? [], capValue) }))
  }

  function handleSave() {
    // Write back only the tracks this table holds, onto the store as it stands
    // now: other edit forms stay open alongside the table, so tracks added or
    // deleted meanwhile must not be resurrected or wiped by a stale snapshot.
    const edited = new Map(tracks.map(tr => [tr.id, tr]))
    replaceAllTracks(project.id, loadTracks(project.id).map(tr => edited.get(tr.id) ?? tr))
    onSaved?.()
  }

  // A transition is neither straight nor arc — it is named by its own curvature
  // profile (clothoid or Bloss), which is what the element chain stores.
  const typeLabel = (el) => isTransition(el)
    ? t(el.transitionType === 'bloss' ? 'table_type_bloss' : 'table_type_transition')
    : t(el.radius ? 'table_type_arc' : 'table_type_straight')

  // A transition has no single radius: it runs from r1 to r2 (∞ on the straight
  // end), so the column shows that ramp instead of an empty, uneditable cell.
  const radiusText = (el) => {
    const r = (v) => (v ? String(Math.round(v * 100) / 100) : '∞')
    return `${r(el.r1)} → ${r(el.r2)}`
  }

  // Read-only cell, styled like the editable ones; `wide` for text that does not
  // fit a number column (type label, radius ramp).
  const textCell = (value, { wide = false } = {}) => (
    <input className={`track-table-input${wide ? ' track-table-input-wide' : ''}`}
      disabled readOnly value={value} />
  )

  // Editable numeric cell with a typing draft committed on blur / Enter.
  const numCell = (i, key, rawValue, { disabled = false, step } = {}) => {
    const editing = draft && draft.row === i && draft.key === key
    return (
      <input
        className="track-table-input"
        type="number"
        disabled={disabled}
        step={step}
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
        <span className="track-table-title">{current.name || current.id.slice(0, 8)}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="track-table-cap" title={t('table_speed_cap_hint')}>
            {t('table_speed_cap')}
            <input className="track-table-input track-table-cap-input"
              type="number" min="0" step={SPEED_STEP} placeholder="–"
              value={cap} onChange={e => setCap(e.target.value)} />
          </label>
          <button className="track-table-vmax-btn" onClick={handleMaxSpeeds}
            title={t('table_set_max_speeds_hint')}>{t('table_set_max_speeds')}</button>
          <button className="track-table-save-btn" onClick={handleSave}>{t('btn_save')}</button>
          <button className="track-table-close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="track-table-scroll">
        <table className="track-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('table_type')}</th>
              <th>{t('table_bearing')} (°)</th>
              <th>{t('table_end_bearing')} (°)</th>
              <th>{t('table_length')} (m)</th>
              <th>{t('table_radius')} (m)</th>
              <th>{t('table_speed')} (km/h)</th>
              <th>{t('table_cant')} (mm)</th>
              <th>{t('table_cant_def')} (mm)</th>
              <th>{t('table_max_speed')} (km/h)</th>
            </tr>
          </thead>
          <tbody>
            {elements.map((el, i) => {
              // Derived, read-only: both follow the speed/cant/radius cells live.
              const g       = governing(elements, i)
              const cantDef = g ? computeCantDefSigned(el.speed ?? 0, g.radius, g.cant) : 0
              const limit   = el.switchBranch ? MAX_SWITCH_CANT_DEF : MAX_CANT_DEF
              const vMax    = g ? computeMaxSpeed(g.radius, g.cant, limit) : null
              return (
                // Clicking anywhere in the row activates it; onFocus covers
                // tabbing into one of its cells (React focus events bubble).
                <tr key={i}
                  className={i === activeRow ? 'track-table-row-active' : undefined}
                  onClick={() => setActiveRow(i)}
                  onFocus={() => setActiveRow(i)}>
                  <td>{i + 1}</td>
                  <td>{textCell(typeLabel(el), { wide: true })}</td>
                  <td>{numCell(i, 'bearing', el.bearing)}</td>
                  <td>{textCell(el.endBearing != null ? el.endBearing.toFixed(2) : '–')}</td>
                  <td>{numCell(i, 'length', el.length)}</td>
                  <td>
                    {isTransition(el)
                      ? textCell(radiusText(el), { wide: true })
                      : numCell(i, 'radius', el.radius, { disabled: !el.radius })}
                  </td>
                  <td>{numCell(i, 'speed', el.speed)}</td>
                  {/* Cant ramps across a transition — its ends belong to the
                      neighbouring elements, so there is nothing to edit here. */}
                  <td>{isTransition(el) ? textCell('–') : numCell(i, 'cant', el.cant, { step: CANT_STEP })}</td>
                  <td>{textCell(cantDef)}</td>
                  <td>{textCell(vMax != null ? vMax : '–')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
