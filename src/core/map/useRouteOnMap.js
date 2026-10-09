import { useEffect, useMemo } from 'react'
import { routePointAt } from '../utils/routes'
import { utmToWgs84 } from '../utils/coordinateUtils'
import { ensureMarkerImages, ARROW_ICON_IMAGE } from '../utils/markerImages'
import { ZOOM_ICON_SIZE, lineWidthTimes } from './style'
import { PALETTE } from '../styles/palette'
import { useMap } from './MapContext'
import usePreview from './usePreview'

/** How many arrows a route carries at most, and how far apart at least [m]. */
const MAX_ARROWS = 12
const MIN_ARROW_GAP = 25

const layersFor = (id) => [{
  sourceId: `${id}-line-source`,
  layer: {
    id: `${id}-line-layer`, type: 'line',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': PALETTE.mapSelected, 'line-width': lineWidthTimes(3), 'line-opacity': 0.45 },
  },
}, {
  sourceId: `${id}-arrow-source`,
  layer: {
    id: `${id}-arrow-layer`, type: 'symbol',
    layout: {
      'icon-image': ARROW_ICON_IMAGE, 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true, 'icon-size': ZOOM_ICON_SIZE,
    },
    paint: { 'icon-color': PALETTE.mapSelected },
  },
}]

/** The display line of a part, in the direction the route runs it. */
const partLine = (p) => {
  const c = p.track.coordinates ?? []
  return p.reversed ? [...c].reverse() : c
}

/**
 * A route on the map while the component asking for it is mounted (Paket RT):
 * its tracks drawn broad in the colour of a selection, arrows along it in the
 * direction it runs, the last at its end. `resolved` as resolveRoute gives it
 * (on hydrated tracks), or null for nothing. `id` names the preview.
 */
export default function useRouteOnMap(id, resolved) {
  const map = useMap()
  const layers = useMemo(() => layersFor(id), [id])
  const preview = usePreview(layers)
  useEffect(() => { if (map?.current) ensureMarkerImages(map.current) }, [map])
  useEffect(() => {
    const parts = resolved?.parts ?? []
    if (!parts.length) { preview.clear(); return }
    preview.set(`${id}-line-source`, {
      type: 'Feature', properties: {},
      geometry: { type: 'MultiLineString', coordinates: parts.map(partLine).filter(c => c.length > 1) },
    })
    const n = Math.max(1, Math.min(MAX_ARROWS, Math.floor(resolved.length / MIN_ARROW_GAP)))
    const arrows = []
    for (let k = 1; k <= n; k++) {
      const p = routePointAt(resolved, (resolved.length * k) / n)
      if (!p) continue
      const track = parts.find(x => x.trackId === p.trackId)?.track
      arrows.push({
        type: 'Feature', properties: { bearing: p.bearing },
        geometry: { type: 'Point', coordinates: utmToWgs84(p.utm.easting, p.utm.northing, track.epsg) },
      })
    }
    preview.set(`${id}-arrow-source`, { type: 'FeatureCollection', features: arrows })
  }, [preview, id, resolved])
}
