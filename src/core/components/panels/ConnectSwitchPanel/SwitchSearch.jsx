import { useState } from 'react'
import maplibregl from 'maplibre-gl'
import { switchMatches } from '../../../utils/search'
import { useI18n } from '../../../locales/i18nContext'
import { useMap } from '../../../map/MapContext'
import { useSwitches } from '../../../hooks/useStore'
import { useSelectedOnMap } from '../../../map/useMapPick'

/** How many hits are listed at most — more says only that the search is too wide. */
const MAX_HITS = 12

/**
 * Find a switch by its name or form (R10.6): the hits as a list, a click on
 * one shows it on the map — its body framed and marked.
 */
export default function SwitchSearch() {
  const { t, fill } = useI18n()
  const map = useMap()
  const switches = useSwitches()
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(null)   // switchId
  useSelectedOnMap(shown ? { switchId: shown } : null)
  const hits = query.trim() ? switches.filter(sw => switchMatches(sw, query)) : []

  const show = (sw) => {
    setShown(sw.switchId)
    const ring = (sw.fillCoords ?? []).flat(Array.isArray(sw.fillCoords?.[0]?.[0]) ? 1 : 0)
    if (!ring.length || !map?.current) return
    const box = ring.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(ring[0], ring[0]))
    map.current.fitBounds(box, { padding: 120, maxZoom: 19 })
  }

  return (
    <div className="track-search">
      <input type="search" value={query} placeholder={t('search_switches')} aria-label={t('search_switches')}
        onChange={e => { setQuery(e.target.value); setShown(null) }} />
      {query.trim() && (
        <span className="track-search-count">
          {hits.length ? fill('search_count', { n: hits.length, total: switches.length }) : t('search_none')}
        </span>
      )}
      {hits.length > 0 && (
        <div className="create-element-options track-search-hits">
          {hits.slice(0, MAX_HITS).map(sw => (
            <button key={sw.switchId} type="button" className={`create-element-btn track-group-item${shown === sw.switchId ? ' active' : ''}`}
              onClick={() => show(sw)}>
              {[sw.name, sw.label].filter(Boolean).join(' · ') || sw.switchId.slice(0, 8)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
