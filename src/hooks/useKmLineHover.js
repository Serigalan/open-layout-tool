import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { kmAt } from '../utils/kmLineLayer'
import { formatKm } from '../utils/kmLineMath'
import { mapIsLive } from '../utils/mapConstants'

/**
 * Hook: reads the kilometrage off the DB kilometrage overlay wherever the
 * cursor is near one of its lines and shows it in a tooltip sitting on the
 * line. Runs only while the overlay is switched on — which is the only time
 * anyone is asking for a kilometrage.
 */
export default function useKmLineHover(map, enabled, t) {
  useEffect(() => {
    if (!enabled || !map?.current) return
    const m = map.current

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'km-tooltip',
      offset: 10,
      anchor: 'bottom',
    })
    let shown = false

    const hide = () => {
      if (!shown) return
      popup.remove()
      shown = false
    }

    const onMove = (e) => {
      const hit = kmAt(m, e)
      if (!hit) { hide(); return }
      // A line outside the DB network says so; the network's own lines speak
      // for themselves.
      const note = hit.inDb ? '' : ` · ${t('km_not_db')}`
      popup
        .setLngLat(hit.lngLat)
        .setText(`${t('km_line_short')} ${hit.strecke} · km ${formatKm(hit.km)}${note}`)
      if (!shown) {
        popup.addTo(m)
        shown = true
      }
    }

    m.on('mousemove', onMove)
    m.on('mouseout', hide)
    return () => {
      m.off('mousemove', onMove)
      m.off('mouseout', hide)
      if (mapIsLive(map, m)) hide()
    }
  }, [map, enabled, t])
}
