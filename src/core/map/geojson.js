/** An empty FeatureCollection — what a source holds while it shows nothing. */
export const EMPTY_FC = Object.freeze({ type: 'FeatureCollection', features: Object.freeze([]) })

/**
 * Whatever a preview is handed, as GeoJSON for a source: nothing (null,
 * undefined) is the empty collection, an array is a collection of those
 * features, a Feature or FeatureCollection is taken as it is.
 */
export function asGeoJSON(data) {
  if (data == null) return EMPTY_FC
  if (Array.isArray(data)) return { type: 'FeatureCollection', features: data }
  return data
}
