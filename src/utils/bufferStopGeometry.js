import { pointAtStation, offsetEdgeCoords } from './platformUtils'
import { utmToWgs84 } from './coordinateUtils'
import { trackLength } from './heightUtils'
import { BUFFER_STOP, bufferStopStations } from './trackEndMarks'

/**
 * Half the width of the bar drawn across the track at the buffer face [m]: a
 * little wider than the gauge, so it reads as standing across the rails.
 */
export const FACE_HALF_WIDTH = 1.75

const DEG = Math.PI / 180

/** Points (WGS84) `half` metres either side of the track at a station. */
function barAt(track, station, half) {
  const at = pointAtStation(track, station)
  if (!at) return null
  const rad = at.bearing * DEG
  const { easting: e, northing: n } = at.utm
  // Right-hand perpendicular of the running direction, as offsetEdgeCoords.
  const dx = half * Math.cos(rad), dy = -half * Math.sin(rad)
  return [utmToWgs84(e - dx, n - dy, track.epsg), utmToWgs84(e + dx, n + dy, track.epsg)]
}

/**
 * What a buffer stop looks like on the map, in WGS84: the bar across the track
 * at its face, the body behind it along the centreline, and the brake length
 * from there to the track end. Parts that come to nothing (a brake length of
 * 0) are null.
 */
export function bufferStopShape(track, mark) {
  const total = trackLength(track)
  if (!(total > 0) || !track?.epsg) return null
  const st = bufferStopStations(total, mark)
  return {
    face:  barAt(track, st.face, FACE_HALF_WIDTH),
    body:  offsetEdgeCoords(track, st.body[0], st.body[1], 0),
    brake: offsetEdgeCoords(track, st.brake[0], st.brake[1], 0),
  }
}

/**
 * The buffer stops of a project as GeoJSON line features, `part` telling the
 * face and body (drawn solid) from the brake length (drawn dashed). Each
 * carries its mark id and track, which is what a click picks it by.
 */
export function bufferStopFeatures(tracks, marks) {
  const byId = new Map((tracks ?? []).map(t => [t.id, t]))
  const features = []
  for (const mark of marks ?? []) {
    if (mark.kind !== BUFFER_STOP) continue
    const track = byId.get(mark.trackId)
    const shape = track && bufferStopShape(track, mark)
    if (!shape) continue
    const properties = { markId: mark.id, trackId: mark.trackId }
    const push = (part, coords) => {
      if (coords?.length >= 2) {
        features.push({ type: 'Feature', properties: { ...properties, part }, geometry: { type: 'LineString', coordinates: coords } })
      }
    }
    push('face', shape.face)
    push('body', shape.body)
    push('brake', shape.brake)
  }
  return features
}
