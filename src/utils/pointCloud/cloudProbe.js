import { utmToWgs84 } from '../coordinateUtils'
import { projectBox } from '../kmLineSource'

// Before an import, on the page: which plane the tiles go into, and whether
// the chosen system puts the file anywhere near the project.

/**
 * The plane a project's tiles are kept in: the one most of its tracks are
 * laid out in. Null for a project without tracks — the cloud then stays in
 * its own system.
 */
export function projectPlane(tracks) {
  const counts = new Map()
  for (const t of tracks ?? []) if (t?.epsg) counts.set(Number(t.epsg), (counts.get(Number(t.epsg)) ?? 0) + 1)
  let best = null
  for (const [epsg, n] of counts) if (!best || n > best[1]) best = [epsg, n]
  return best?.[0] ?? null
}

/** Margin around the tracks inside which a cloud counts as theirs [m]. */
const PROBE_MARGIN = 200

/**
 * Whether the box a file states for itself, read in `crs`, lies near the
 * project's tracks — the check that catches a wrongly chosen system before an
 * hour of import (Entscheidung 118). `header.min/max` are in the file's
 * units. Returns `{ ok, box }` (box in WGS84), `ok` null for a project without
 * tracks, where nothing can be said.
 */
export function probeExtent(header, crs, tracks) {
  const [x0, y0] = header.min, [x1, y1] = header.max
  let box = null
  try {
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([e, n]) => utmToWgs84(e, n, crs))
    if (corners.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)
      && Math.abs(lon) <= 180 && Math.abs(lat) <= 90)) {
      box = [
        Math.min(...corners.map(c => c[0])), Math.min(...corners.map(c => c[1])),
        Math.max(...corners.map(c => c[0])), Math.max(...corners.map(c => c[1])),
      ]
    }
  } catch {
    box = null
  }
  const near = projectBox(tracks, PROBE_MARGIN)
  if (!near) return { ok: null, box }
  if (!box) return { ok: false, box }
  const ok = box[0] <= near[2] && box[2] >= near[0] && box[1] <= near[3] && box[3] >= near[1]
  return { ok, box }
}
