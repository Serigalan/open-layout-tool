import { useEffect, useMemo } from 'react'
import { axisOutline } from '../utils/referenceAxis'
import { utmToWgs84 } from '../utils/coordinateUtils'
import { PALETTE } from '../styles/palette'
import usePreview from './usePreview'

const layersFor = (id) => [{
  sourceId: `${id}-source`,
  layer: {
    id: `${id}-layer`, type: 'line',
    paint: { 'line-color': PALETTE.referenceAxis, 'line-width': 2, 'line-dasharray': [2, 1.5] },
  },
}]

/**
 * The reference axes (Paket V) on the map while the component that asks for
 * them is mounted: `axes` drawn as thin dashed lines, a vertex every metre.
 * `id` names the preview, one per component — two panels may show them at once.
 */
export default function useReferenceAxesOnMap(id, axes) {
  const layers = useMemo(() => layersFor(id), [id])
  const preview = usePreview(layers)
  useEffect(() => {
    preview.set(`${id}-source`, {
      type: 'FeatureCollection',
      features: (axes ?? []).map(a => ({
        type: 'Feature', properties: { axisId: a.id },
        geometry: { type: 'LineString', coordinates: axisOutline(a, 1).map(([e, n]) => utmToWgs84(e, n, a.epsg)) },
      })),
    })
  }, [preview, id, axes])
}
