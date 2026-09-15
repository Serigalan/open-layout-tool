import { loadTracks, loadSwitches, loadPlatforms, loadProjects } from '../storage'
import {
  exact, round3, buildCoords, totalLength,
  horizontalElements, startAnchor, endAnchor, switchesToPorts,
  platformsToOperationalPoints,
} from './alignmentCodec'

// The OSRD instance this tool's exports are meant for — used by the Data
// Exchange and Info panels.
export const OSRD_URL = 'https://osrd.open-layout-tool.org/'

/**
 * DB alignment extension: the design data OSRD's own track_section fields
 * cannot carry — native CRS anchor, gon bearings, and the element chain with
 * signed radii and cants. Read back by osrdImport.
 */
function dbAlignment(track) {
  const els = track.elements ?? []
  if (!els.length) return null
  const start = startAnchor(track), end = endAnchor(track)
  return {
    length_m: exact(totalLength(track)),
    horizontal_reference: {
      epsg: start.epsg,
      easting_m:  start.easting,
      northing_m: start.northing,
      bearing_start_gon: start.bearing_gon,
      bearing_end_gon:   end.bearing_gon,
    },
    horizontal_elements: horizontalElements(track),
  }
}

/** RailJSON schema this exporter writes. */
export const RAILJSON_VERSION = '3.5.4'

// Infra-level objects the app does not model. An imported file's originals are
// kept on the project (see osrdImport) and handed back here unchanged.
const EMPTY_INFRA = {
  signals: [], speed_sections: [], detectors: [], extended_switch_types: [],
  buffer_stops: [], routes: [], operational_points: [], level_crossings: [],
  electrifications: [], neutral_sections: [],
}

/** RailJSON for OSRD: what it models in its own fields, the rest in extensions.db. */
export function exportToOsrd(projectId) {
  const tracks    = loadTracks(projectId)
  const switches  = loadSwitches(projectId)
  const platforms = loadPlatforms(projectId)
  const project   = loadProjects().find(p => p.id === projectId)
  const trackMap = Object.fromEntries(tracks.map(t => [t.id, t]))

  // ── track_sections ──────────────────────────────────────────────────────
  const trackSections = tracks.map(track => {
    const curves = []
    ;(track.elements ?? []).forEach((el, i) => {
      if (el.elementType === 1) {
        const begin = i > 0 ? (track.elements[i - 1].absLength ?? 0) : 0
        curves.push({ end: round3(el.absLength ?? 0), begin: round3(begin), radius: Math.abs(el.radius) })
      }
    })

    // Anything carried over from an import (loading gauge, foreign extensions)
    // sits underneath; the regenerated fields win.
    const kept = track.osrd ?? {}
    return {
      slopes: [],
      loading_gauge_limits: [],
      ...kept,
      id: track.id,
      geo: { type: 'LineString', coordinates: buildCoords(track) },
      length: round3(totalLength(track)),
      curves,
      extensions: {
        source: null,
        ...(kept.extensions ?? {}),
        sncf: {
          ...(kept.extensions?.sncf ?? {}),
          line_code:    Number(track.lineNumber) || 9900,
          line_name:    String(track.lineName  ?? '').trim() || 'default_name',
          track_name:   String(track.name      ?? '').trim() || 'default_track',
          track_number: Number(track.trackNumber) || 1,
        },
        db: { alignment: dbAlignment(track) },
      },
    }
  })

  return {
    ...EMPTY_INFRA,
    ...(project?.osrd ?? {}),
    // Stated after what an import brought along, not before it: the file being
    // written is this exporter's, whatever schema the one it came from was.
    version: RAILJSON_VERSION,
    track_sections: trackSections,
    switches:       switchesToPorts(switches, trackMap, project?.osrd?.switches ?? []),
    // Platforms become the stations' operational points; ones an imported file
    // brought along stay unless a generated point takes their id.
    operational_points: platformsToOperationalPoints(
      platforms, trackMap, project?.osrd?.operational_points ?? []),
  }
}
