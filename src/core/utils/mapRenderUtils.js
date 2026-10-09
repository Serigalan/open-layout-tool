import maplibregl from 'maplibre-gl'

export function getColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#303383'
}

/** Solid grey a platform is filled with, and the darker grey of its outline. */
export const PLATFORM_FILL_COLOR    = '#8c8c8c'
export const PLATFORM_FILL_OPACITY  = 0.85
export const PLATFORM_OUTLINE_COLOR = '#5a5a5a'

/**
 * Zoom the map to a set of tracks — used after an import, where the new tracks
 * are usually nowhere near the current viewport. Tracks without a rendered
 * polyline contribute nothing; with no coordinates at all the view is left alone.
 */
export function fitToTracks(map, tracks, options = {}) {
  if (!map) return
  const coords = (tracks ?? []).flatMap(track => track.coordinates ?? [])
  if (coords.length === 0) return
  const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
  map.fitBounds(bounds, { padding: 80, maxZoom: 16, ...options })
}

