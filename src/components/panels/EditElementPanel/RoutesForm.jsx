import { useMemo, useState } from 'react'
import { deleteRoute, saveRoute } from '../../../storage'
import { useRoutes, useSwitches, useTracks } from '../../../hooks/useStore'
import { closeGaps, extendRoute, nextRouteName, resolveRoute } from '../../../utils/routes'
import { generateId } from '../../../utils/identifierUtils'
import { trackListLabel } from '../../../utils/trackGroups'
import { fitToTracks } from '../../../utils/mapRenderUtils'
import { useI18n } from '../../../locales/i18nContext'
import { useMap } from '../../../map/MapContext'
import useMapPick from '../../../map/useMapPick'
import useRouteOnMap from '../../../map/useRouteOnMap'
import MessageList from '../../form/MessageList'

/** What a gap in a route is called, in the list of its parts. */
const gapKey = (g) => (g.kind === 'missing' ? 'route_gap_missing' : 'route_gap_disconnected')

/**
 * Routes (Bearbeiten › Routen, Paket RT): a route is a named run of connected
 * tracks with stations of its own, chosen in the height profile, the cross
 * section and the 3D track view.
 *
 * The list shows every route with its length, its number of tracks and
 * whether it is whole; one picked is drawn on the map with its direction and
 * can be edited, turned round or deleted — a click on the map picks the route
 * a track belongs to. A new or edited route is picked on the map track by
 * track in the direction it runs; a track further on brings the shortest
 * connected run to it (decision 250), and "remove last" takes back what one
 * click brought. Gaps — tracks deleted, or two that do not meet — are named
 * between the parts and can be closed over the tracks between where there are any.
 */
export default function RoutesForm() {
  const { t, fill, num } = useI18n()
  const map = useMap()
  const routes = useRoutes()
  const tracks = useTracks()
  const switches = useSwitches()
  const [selectedId, setSelectedId] = useState(null)
  // The route being made or edited: { id, name, trackIds, steps } — `steps` how many tracks each click brought.
  const [draft, setDraft] = useState(null)
  const [notes, setNotes] = useState([])

  const resolvedById = useMemo(
    () => new Map(routes.map(r => [r.id, resolveRoute(r, tracks, switches)])),
    [routes, tracks, switches])
  const draftResolved = useMemo(
    () => (draft ? resolveRoute({ trackIds: draft.trackIds }, tracks, switches) : null),
    [draft, tracks, switches])
  const selected = routes.find(r => r.id === selectedId) ?? null
  const shown = draft ? draftResolved : selected ? resolvedById.get(selected.id) : null
  useRouteOnMap('route-edit', shown)

  const byId = useMemo(() => new Map(tracks.map(tr => [tr.id, tr])), [tracks])
  const label = (id) => (byId.has(id) ? trackListLabel(byId.get(id)) : t('route_track_gone'))
  const lengthLabel = (m) => num(m, { digits: 0, unit: 'm' })

  // ── Picking on the map ────────────────────────────────────────────────────
  const add = (trackId) => {
    setNotes([])
    if (draft.trackIds.includes(trackId)) {
      if (draft.trackIds[draft.trackIds.length - 1] !== trackId) setNotes([t('route_pick_twice')])
      return
    }
    const { trackIds, added } = extendRoute(draft.trackIds, trackId, tracks, switches)
    if (!added.length) { setNotes([fill('route_pick_unreachable', { name: label(trackId) })]); return }
    if (added.length > 1) setNotes([fill('route_pick_filled', { n: added.length - 1 })])
    setDraft(d => ({ ...d, trackIds, steps: [...d.steps, added.length] }))
  }
  // While editing a click adds a track; otherwise it picks the route the track is in.
  useMapPick({
    hover: 'track',
    onPick: ({ trackId }) => {
      if (draft) { add(trackId); return }
      const hit = routes.filter(r => r.trackIds.includes(trackId))
      if (!hit.length) return
      // Clicked again, the next route over that track.
      const i = hit.findIndex(r => r.id === selectedId)
      setSelectedId(hit[(i + 1) % hit.length].id)
    },
  })

  const startNew = () => {
    setSelectedId(null)
    setNotes([])
    setDraft({ id: generateId(), name: nextRouteName(routes, t('route_default_name')), trackIds: [], steps: [], fresh: true })
  }
  const startEdit = (route) => {
    setNotes([])
    setDraft({ id: route.id, name: route.name, trackIds: [...route.trackIds], steps: route.trackIds.map(() => 1) })
  }
  const removeLast = () => setDraft(d => {
    const n = d.steps[d.steps.length - 1] ?? 1
    return { ...d, trackIds: d.trackIds.slice(0, -n), steps: d.steps.slice(0, -1) }
  })
  const reverseDraft = () => setDraft(d => ({ ...d, trackIds: [...d.trackIds].reverse(), steps: d.trackIds.map(() => 1) }))
  const closeDraftGaps = () => {
    const r = closeGaps(draft.trackIds, tracks, switches)
    setNotes(r.open ? [fill('route_gaps_left', { n: r.open })] : [])
    setDraft(d => ({ ...d, trackIds: r.trackIds, steps: r.trackIds.map(() => 1) }))
  }
  const save = () => {
    const ids = draft.trackIds.filter(id => byId.has(id))
    if (!ids.length) return
    saveRoute({ id: draft.id, name: draft.name.trim() || nextRouteName(routes, t('route_default_name')), trackIds: ids })
    setSelectedId(draft.id)
    setDraft(null)
    setNotes([])
  }
  const zoomTo = (resolved) => fitToTracks(map?.current, resolved.parts.map(p => p.track), { maxZoom: 17 })

  /** The parts of a route in order, with its gaps between them. */
  const partList = (resolved) => (
    <ol className="route-parts">
      {resolved.gaps.filter(g => g.after < 0).map((g, i) => <li key={`g-${i}`} className="route-gap">{t(gapKey(g))}</li>)}
      {resolved.parts.map((p, i) => [
        <li key={`${p.trackId}-${i}`}>
          <span className="route-dir" aria-hidden="true">{p.reversed ? '◀' : '▶'}</span>
          {trackListLabel(p.track)}
          <span className="msg-hint msg-small">{` ${lengthLabel(p.length)}`}</span>
        </li>,
        ...resolved.gaps.filter(g => g.after === i).map((g, k) => (
          <li key={`g${i}-${k}`} className="route-gap">{t(gapKey(g))}</li>
        )),
      ])}
    </ol>
  )

  // ── Making or editing one ─────────────────────────────────────────────────
  if (draft) {
    const gaps = draftResolved.gaps.filter(g => g.kind === 'disconnected').length
    return (
      <>
        <div className="form-field">
          <label>{t('route_name')}</label>
          <input type="text" value={draft.name} maxLength={120} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
        </div>
        <p className="selecting-hint">{t('route_pick_hint')}</p>
        {draftResolved.parts.length ? (
          <>
            <p className="msg-hint msg-small">{fill('route_summary', {
              length: lengthLabel(draftResolved.length), n: draftResolved.parts.length,
            })}</p>
            {partList(draftResolved)}
          </>
        ) : <p className="msg-hint">{t('route_parts_empty')}</p>}
        <MessageList items={notes} kind="warn" className="mt-2" />
        <div className="row mt-4">
          <button type="button" className="panel-btn grow" disabled={!draft.trackIds.length} onClick={removeLast}>
            {t('route_remove_last')}
          </button>
          <button type="button" className="panel-btn grow" disabled={draft.trackIds.length < 2} onClick={reverseDraft}
            title={t('route_reverse_hint')}>
            {t('route_reverse')}
          </button>
        </div>
        {gaps > 0 && (
          <button type="button" className="panel-btn panel-btn-full mt-2" onClick={closeDraftGaps}>
            {fill('route_close_gaps', { n: gaps })}
          </button>
        )}
        <div className="row mt-4">
          <button type="button" className="panel-btn panel-btn-full grow" disabled={!draftResolved.parts.length} onClick={save}>
            {t('route_save')}
          </button>
          <button type="button" className="panel-btn panel-btn-full grow secondary" onClick={() => { setDraft(null); setNotes([]) }}>
            {t('btn_cancel')}
          </button>
        </div>
      </>
    )
  }

  // ── The list ──────────────────────────────────────────────────────────────
  const selectedResolved = selected ? resolvedById.get(selected.id) : null
  return (
    <>
      <p>{t('route_hint')}</p>
      <button type="button" className="panel-btn panel-btn-full" disabled={!tracks.length} onClick={startNew}>
        {t('route_new')}
      </button>
      {!routes.length && <p className="msg-hint mt-4">{t('route_none')}</p>}
      <div className="mt-4 stack-tight">
        {routes.map(r => {
          const res = resolvedById.get(r.id)
          const on = r.id === selectedId
          return (
            <button key={r.id} type="button" className={`create-element-btn track-group-item route-item${on ? ' active' : ''}`}
              aria-pressed={on} onClick={() => { setSelectedId(on ? null : r.id); if (!on) zoomTo(res) }}>
              <span className="route-item-name">{r.name}</span>
              <span className="msg-hint msg-small">
                {fill('route_summary', { length: lengthLabel(res.length), n: res.parts.length })}
                {res.gaps.length > 0 && <span className="msg-warn">{` · ${fill('route_gaps', { n: res.gaps.length })}`}</span>}
              </span>
            </button>
          )
        })}
      </div>
      {selected && (
        <div className="mt-4">
          {partList(selectedResolved)}
          <div className="row mt-4">
            <button type="button" className="panel-btn grow" onClick={() => startEdit(selected)}>{t('route_edit')}</button>
            <button type="button" className="panel-btn grow" disabled={selected.trackIds.length < 2}
              title={t('route_reverse_hint')}
              onClick={() => saveRoute({ ...selected, trackIds: [...selected.trackIds].reverse() })}>
              {t('route_reverse')}
            </button>
            <button type="button" className="panel-btn grow danger"
              onClick={() => { deleteRoute(selected.id); setSelectedId(null) }}>
              {t('route_delete')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
