// Height points and the vertical datums heights are stated in.

/**
 * Height points of the vertical alignment: an element up to HEIGHT_SPLIT_MIN
 * long carries one at each end, a longer one evenly spaced points at most
 * HEIGHT_POINT_SPACING apart in between (see heightUtils).
 */
export const HEIGHT_SPLIT_MIN     = 200   // m
export const HEIGHT_POINT_SPACING = 100   // m
// Vertical datum the heights are stated in unless the track says otherwise:
// DHHN2016 (EPSG 7837), what the BKG's DGM5 delivers.
export const DEFAULT_HEIGHT_EPSG = 7837

/** Vertical datums the heights may be stated in (EPSG codes of the height CRS). */
export const HEIGHT_DATUMS = [
  { epsg: 7837, label: 'DHHN2016' },
  { epsg: 5783, label: 'DHHN92' },
  { epsg: 5773, label: 'EGM96' },
  { epsg: 3855, label: 'EGM2008' },
]
