import { useState } from 'react'
import { exportVermEsn } from '../../../utils/exchange'
import { trackLabel, resolveRoute } from '../../../utils/track'
import { downloadBlob } from '../../../utils/common'
import { useI18n } from '../../../locales/i18nContext'
import { useProject, useRoutes, useSwitches, useTracks } from '../../../hooks/useStore'
import useMapPick from '../../../map/useMapPick'
import MessageList from '../../form/MessageList'
import RouteList from '../RouteList'
import InfoTip from '../../form/InfoTip'

/**
 * The project's tracks as Verm.ESN files — the tracks picked on the map, or
 * all of them where neither a track nor a route is: one zip with a TRA per
 * track, a GRA where it has heights, and a text naming plane and height datum,
 * which the files do not. Routes picked in the list go along, each as one
 * axis in its direction.
 */
export default function VermEsnExport() {
  const { t, fill } = useI18n()
  const project = useProject()
  const tracks = useTracks()
  const routes = useRoutes()
  const switches = useSwitches()
  const [routeIds, setRouteIds] = useState(() => new Set())
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [done, setDone] = useState(null)
  const [skipped, setSkipped] = useState([])

  const flip = (id) => (prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }
  const toggle = (id) => setSelectedIds(flip(id))
  useMapPick({ active: selecting, hover: 'element', onPick: ({ trackId }) => toggle(trackId) })

  const selected = tracks.filter(tr => selectedIds.has(tr.id))
  const chosenRoutes = routes.filter(r => routeIds.has(r.id))

  const exportIt = () => {
    const chosen = selected.length || chosenRoutes.length ? selected : tracks
    const { zip, files, skipped: none, routesSkipped } = exportVermEsn(chosen, {
      title: project.title, routes: chosenRoutes.map(r => resolveRoute(r, tracks, switches)),
    })
    if (files.length) {
      downloadBlob(new Blob([zip], { type: 'application/zip' }), `${project.title}_VermESN.zip`)
    }
    const routeFiles = files.filter(f => f.route)
    const trackFiles = files.filter(f => !f.route)
    setDone([
      trackFiles.length ? fill('data_exchange_vermesn_export_done', {
        tracks: trackFiles.length, gradients: trackFiles.filter(f => f.gra).length,
      }) : null,
      routeFiles.length ? fill('data_exchange_vermesn_export_done_routes', {
        routes: routeFiles.length, gradients: routeFiles.filter(f => f.gra).length,
      }) : null,
    ].filter(Boolean).join(' ') || null)
    setSkipped([
      ...(none.length ? [fill('data_exchange_vermesn_export_skipped', { names: none.join(', ') })] : []),
      ...routesSkipped.map(r => fill(`data_exchange_vermesn_route_${r.problem}`, { name: r.name })),
      ...routeFiles.filter(f => f.route.noGradient)
        .map(f => fill(`data_exchange_vermesn_route_no_gra_${f.route.noGradient}`, { name: f.name })),
    ])
  }

  const label = selected.length && chosenRoutes.length
    ? fill('data_exchange_vermesn_export_tracks_routes_n', { n: selected.length, m: chosenRoutes.length })
    : selected.length ? fill('data_exchange_vermesn_export_n', { n: selected.length })
      : chosenRoutes.length ? fill('data_exchange_vermesn_export_routes_n', { n: chosenRoutes.length })
        : t('data_exchange_vermesn_export_all')

  return (
    <>
      <hr className="divider" />
      <span className="create-element-section">{t('data_exchange_export')}<InfoTip text={t('data_exchange_vermesn_export_desc')} /></span>
      <div className="row">
        <button className={`panel-btn panel-btn-full grow ${selecting ? 'active' : ''}`} disabled={!project}
          onClick={() => setSelecting(s => !s)}>
          {t('data_exchange_select')}
        </button>
        <button className="panel-btn panel-btn-full grow" disabled={!project || !tracks.length} onClick={exportIt}>
          {label}
        </button>
      </div>
      {selected.length > 0 && (
        <div className="mt-4 stack-tight">
          {selected.map(tr => (
            <div key={tr.id} className="chip">
              <span>{trackLabel(tr)}</span>
              <button type="button" className="chip-remove" aria-label={t('btn_remove')} onClick={() => toggle(tr.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      {routes.length > 0 && (
        <div className="mt-4">
          <p className="msg-hint msg-small">{t('data_exchange_vermesn_routes_pick')} <InfoTip text={t('data_exchange_vermesn_routes_hint')} /></p>
          <RouteList activeIds={routeIds} onPick={(route) => setRouteIds(flip(route.id))} />
        </div>
      )}
      {done && <p className="msg-ok msg-small">{done}</p>}
      <MessageList items={skipped} kind="warn" />
    </>
  )
}
