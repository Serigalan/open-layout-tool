// The ids of the sources and layers the project is drawn with
// (map/trackLayers.js) — the ones more than one module reads, writes a filter
// on or asks for hits. A panel's own preview layers keep their ids beside the
// panel; the topology view's live in utils/topologyLayer.

export const TRACKS_SOURCE         = 'tracks-source'
/** One line per element: properties { trackId, elementIndex, switchBranch, switchId }. */
export const TRACKS_LAYER          = 'tracks-layer'
/** The track or element under the cursor; its filter belongs to whoever picks. */
export const TRACKS_HOVER_LAYER    = 'tracks-hover-layer'
/** What a panel has picked; its filter belongs to the open panel. */
export const TRACKS_SELECTED_LAYER = 'tracks-selected-layer'

export const TRACK_MARKERS_SOURCE  = 'tracks-markers-source'
export const TRACK_MARKERS_LAYER   = 'tracks-markers-layer'

export const SWITCH_FILLS_SOURCE   = 'switch-fills-source'
/** A switch's body: properties { switchId }. */
export const SWITCH_FILLS_LAYER    = 'switch-fills-layer'
export const SWITCH_LCS_SOURCE     = 'switch-lcs-source'
export const SWITCH_LCS_LAYER      = 'switch-lcs-layer'

export const PLATFORMS_SOURCE        = 'platforms-source'
export const PLATFORMS_FILL_LAYER    = 'platforms-fill-layer'
export const PLATFORMS_OUTLINE_LAYER = 'platforms-outline-layer'

export const BUFFER_STOPS_SOURCE      = 'buffer-stops-source'
export const BUFFER_STOPS_LAYER       = 'buffer-stops-layer'
export const BUFFER_STOPS_BRAKE_LAYER = 'buffer-stops-brake-layer'
