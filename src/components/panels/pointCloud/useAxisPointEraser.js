import { useEffect } from 'react'
import { saveAxisSurvey } from '../../../storage'
import { withoutPoints } from '../../../utils/axisSurvey'
import useMapEvents from '../../../map/useMapEvents'
import usePreview from '../../../map/usePreview'
import { HIT_TOLERANCE } from '../../../map/pick'
import { PALETTE } from '../../../styles/palette'

// The point a click would take out, ringed.
const RING_SOURCE = 'axis-erase-ring-source'
const RING_LAYERS = [{
  sourceId: RING_SOURCE,
  layer: {
    id: 'axis-erase-ring-layer', type: 'circle',
    paint: { 'circle-radius': 7, 'circle-color': 'transparent', 'circle-stroke-color': PALETTE.error, 'circle-stroke-width': 2 },
  },
}]

/**
 * The point of `surveyId` on `layer` nearest the cursor, within the pick
 * tolerance: { st, lngLat } — `st` its station in mm, as the survey packs it.
 */
function nearestPoint(m, point, layer, surveyId) {
  if (!m.getLayer(layer)) return null
  const r = HIT_TOLERANCE
  let best = null, bestD = Infinity
  for (const f of m.queryRenderedFeatures([[point.x - r, point.y - r], [point.x + r, point.y + r]], { layers: [layer] })) {
    if (f.properties?.surveyId !== surveyId) continue
    const q = m.project(f.geometry.coordinates)
    const d = (q.x - point.x) ** 2 + (q.y - point.y) ** 2
    if (d < bestD) { bestD = d; best = f }
  }
  return best ? { st: Number(best.properties.st), lngLat: best.geometry.coordinates } : null
}

/**
 * Taking single points out of a measured axis by hand — where a trace took
 * something else for a rail head. While `survey` is given, the point of it
 * under the cursor on `layer` is ringed, and a click deletes it: one undo
 * step each. The features on `layer` carry `{ surveyId, st }`; a point is
 * known by its station, not its place in the arrays, so a click on a map not
 * yet drawn anew after the last one still takes out the point it shows.
 */
export default function useAxisPointEraser({ survey, layer }) {
  const ring = usePreview(RING_LAYERS)
  const showRing = (hit) => ring.set(RING_SOURCE, hit
    ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: hit.lngLat } }
    : null)

  useMapEvents(!!survey, {
    mousemove: (e, m) => {
      const hit = nearestPoint(m, e.point, layer, survey.id)
      m.getCanvas().style.cursor = hit ? 'pointer' : ''
      showRing(hit)
    },
    click: (e, m) => {
      const hit = nearestPoint(m, e.point, layer, survey.id)
      const index = hit ? survey.points.st.indexOf(hit.st) : -1
      if (index < 0) return
      saveAxisSurvey(withoutPoints(survey, [index]))
      showRing(null)
    },
  }, { resetCursor: true })

  const active = !!survey
  useEffect(() => { if (!active) ring.set(RING_SOURCE, null) }, [active, ring])
}
