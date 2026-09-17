import { loadTracks, loadSwitches, loadPlatforms, loadProjects } from '../storage'
import {
  exact, round3, round4, buildCoords, totalLength,
  horizontalElements, startAnchor, endAnchor, switchesToPorts, platformsToOperationalPoints,
} from './alignmentCodec'
import { tangentLength } from './heightUtils'
import { DEFAULT_HEIGHT_EPSG } from './mapConstants'
import { TYPE_NAMES, SIDE_NAMES } from './identifierUtils'

// The alignment exchange file: an infrastructure in the shape of RailJSON —
// version, track_sections and the infra-level object lists — where a track
// section carries the design data itself: the horizontal alignment as the
// element chain from a native-CRS anchor, and the vertical alignment as the
// height points along the track. Track_sections, switches and the platforms as
// operational points are written by the app; the other lists are placeholders
// for later work and for other programs, and hand back what an imported file
// carried in them.
//
// This is not OSRD's RailJSON — OSRD's own derived fields (curves, slopes) are
// not in it, and it will not load there. Writing that is what osrdExport is for.
export const FORMAT_VERSION = '4.0.0'

const INFRA_LISTS = [
  'signals', 'speed_sections', 'detectors', 'switches', 'extended_switch_types',
  'buffer_stops', 'routes', 'operational_points', 'level_crossings',
  'electrifications', 'neutral_sections',
]

/**
 * The horizontal alignment: where the track begins and ends in its own CRS
 * with gon bearings, and the element chain. The end values are check values —
 * the import chains the elements from the anchor and compares.
 */
function horizontalAlignment(track) {
  if (!(track.elements ?? []).length) return null
  const start = startAnchor(track), end = endAnchor(track)
  return {
    horizontal_reference: {
      epsg: start.epsg,
      start_easting:     start.easting,
      start_northing:    start.northing,
      bearing_start_gon: start.bearing_gon,
      end_easting:       end.easting,
      end_northing:      end.northing,
      bearing_end_gon:   end.bearing_gon,
    },
    horizontal_elements: horizontalElements(track),
  }
}

/**
 * The vertical alignment: the track's height points, stationed along it —
 * independent of the horizontal elements — each with the radius of its
 * vertical curve (null where the gradient simply breaks) and, where there is a
 * curve, the tangent length it needs.
 */
function verticalAlignment(track) {
  const points = track.heights ?? []
  return {
    vertical_reference: { epsg: Number(track.heightEpsg) || DEFAULT_HEIGHT_EPSG },
    vertical_points: points.map((p, i) => {
      const tangent = tangentLength(points, i)
      return {
        station_point_m: exact(p.station),
        elevation: exact(p.z),
        vertical_curve_radius_m: exact(p.rv),
        ...(tangent != null ? { tangential_length_m: round4(tangent) } : {}),
      }
    }),
  }
}

/** The track properties the sncf extension has no field for; empty values are left out. */
function oltExtension(track) {
  const fields = {
    owner:        track.owner ?? null,
    track_type:   TYPE_NAMES[track.trackType] ?? null,
    side:         SIDE_NAMES[track.side] ?? null,
    station_name: track.stationName ?? null,
    uic_station:  track.uicStation ?? null,
    // The superstructure, where the track states a stretch of its own; a track
    // built of the defaults from begin to end states nothing (crossSectionUtils).
    rails:        track.rails?.length ? track.rails : null,
    sleepers:     track.sleepers?.length ? track.sleepers : null,
  }
  const present = Object.entries(fields).filter(([, v]) => v != null && v !== '')
  return present.length ? Object.fromEntries(present) : null
}

/**
 * The exchange file for `tracks`, `switches` and `platforms`. `foreign` is what
 * an imported file carried at the infra level (see osrdImport) and is handed
 * back unchanged, apart from the objects regenerated here.
 */
export function buildInfra(tracks, switches, platforms = [], foreign = {}) {
  const trackMap = Object.fromEntries(tracks.map(t => [t.id, t]))

  // ── track_sections ──────────────────────────────────────────────────────
  const trackSections = tracks.map(track => {
    // Anything carried over from an import that this format does not
    // regenerate sits underneath; curves and slopes are OSRD's derived fields
    // and have no place here.
    const { curves: _c, slopes: _s, loading_gauge_limits, extensions: keptExt = {}, ...leftovers } = track.osrd ?? {}
    const { source = null, sncf: keptSncf = {}, olt: _o, db: _db, ...extLeftovers } = keptExt
    const olt = oltExtension(track)
    return {
      id: track.id,
      geo: { type: 'LineString', coordinates: buildCoords(track) },
      length: round3(totalLength(track)),
      horizontal_alignment: horizontalAlignment(track),
      vertical_alignment: verticalAlignment(track),
      loading_gauge_limits: loading_gauge_limits ?? [],
      ...leftovers,
      extensions: {
        source,
        sncf: {
          ...keptSncf,
          line_code:    Number(track.lineNumber) || 9900,
          line_name:    String(track.lineName  ?? '').trim() || 'default_name',
          track_name:   String(track.name      ?? '').trim() || 'default_track',
          track_number: Number(track.trackNumber) || 1,
        },
        ...(olt ? { olt } : {}),
        ...extLeftovers,
      },
    }
  })

  // ── the file, lists in their fixed order ────────────────────────────────
  const { version: _v, track_sections: _t, ...rest } = foreign
  const out = { version: FORMAT_VERSION, track_sections: trackSections }
  const generated = {
    switches: () => switchesToPorts(switches, trackMap, rest.switches ?? []),
    operational_points: () => platformsToOperationalPoints(platforms, trackMap, rest.operational_points ?? []),
  }
  for (const key of INFRA_LISTS) out[key] = generated[key] ? generated[key]() : (rest[key] ?? [])
  for (const [key, value] of Object.entries(rest)) if (!(key in out)) out[key] = value
  return out
}

export function exportExchange(projectId) {
  const project = loadProjects().find(p => p.id === projectId)
  return buildInfra(
    loadTracks(projectId), loadSwitches(projectId), loadPlatforms(projectId), project?.osrd ?? {})
}
