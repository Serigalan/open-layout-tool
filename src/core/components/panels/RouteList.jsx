import { useMemo } from 'react'
import { useRoutes, useSwitches, useTracks } from '../../hooks/useStore'
import { resolveRoute } from '../../utils/routes'
import { useI18n } from '../../locales/i18nContext'

/**
 * The project's routes (Paket RT) above a track list: one button each, with
 * its length and number of tracks and a mark where it has gaps — what the
 * height profile and the cross section offer besides single tracks. Nothing
 * where the project has none.
 */
export default function RouteList({ activeId, onPick }) {
  const { t, fill, num } = useI18n()
  const routes = useRoutes()
  const tracks = useTracks()
  const switches = useSwitches()
  const resolved = useMemo(
    () => routes.map(r => ({ route: r, res: resolveRoute(r, tracks, switches) })),
    [routes, tracks, switches])
  if (!routes.length) return null
  return (
    <div className="route-list">
      <span className="create-element-section">{t('routes')}</span>
      {resolved.map(({ route, res }) => {
        const on = route.id === activeId
        return (
          <button key={route.id} type="button" disabled={!res.parts.length}
            className={`create-element-btn track-group-item route-item${on ? ' active' : ''}`}
            aria-pressed={on} onClick={() => onPick(route, res)}>
            <span className="route-item-name">{route.name}</span>
            <span className="msg-hint msg-small">
              {fill('route_summary', { length: num(res.length, { digits: 0, unit: 'm' }), n: res.parts.length })}
              {res.gaps.length > 0 && <span className="msg-warn">{` · ${fill('route_gaps', { n: res.gaps.length })}`}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
