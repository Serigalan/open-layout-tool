import { wgs84ToUTM } from './coordinateUtils'

/**
 * Referencing a point against a kilometrage line.
 *
 * A project keeps the lines its tracks name in `project.kmLines`, each as the
 * stretch around the project with a kilometrage on every vertex (see
 * kmLineSource). They are stored in WGS84 — unlike everything the app
 * calculates with, and deliberately: this is foreign reference data, not
 * design geometry, and one line serves tracks whose `epsg` may differ, so
 * there is no one projected plane it could be kept in.
 *
 * The calculation still happens in a plane. A line is converted into the
 * track's CRS once and kept that way for as long as the project is open; only
 * then is anything measured. What that conversion costs is far below what the
 * answer can express anyway: the source states its kilometrage in whole
 * metres, so every kilometrage read out of it is a ±0.5 m statement, four
 * orders above the millimetre a datum conversion moves things by.
 */

// Keyed by the stored line object, which is replaced whenever a project is
// loaded — so the converted copies go with it instead of outliving it.
const planeCache = new WeakMap()

/** The runs of `kmLine` in the plane of `epsg`: [[easting, northing, km], …]. */
export function planeRuns(kmLine, epsg) {
  let byEpsg = planeCache.get(kmLine)
  if (!byEpsg) {
    byEpsg = new Map()
    planeCache.set(kmLine, byEpsg)
  }
  const key = String(epsg)
  if (!byEpsg.has(key)) {
    byEpsg.set(key, (kmLine.runs ?? []).map((run) => run.map(([lon, lat, km]) => {
      const { easting, northing } = wgs84ToUTM([lon, lat], epsg)
      return [easting, northing, km]
    })))
  }
  return byEpsg.get(key)
}

/**
 * The kilometrage of `point` on the nearest of `runs`, by dropping a
 * perpendicular onto it — the way a kilometrage is read off an axis.
 *
 * `offset` is how far the point lies from that axis, which is what tells a
 * caller whether the answer means anything: a few metres is a track beside the
 * line it is stationed against, a few hundred is the wrong line.
 *
 * A run is a stretch of continuous kilometrage, so a jump needs no handling
 * here: the nearer run answers, and in the jump point itself — where two runs
 * meet — both answers are equally true.
 */
export function kmOnRuns(runs, point) {
  const [px, py] = point
  let best = null

  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const [ax, ay, akm] = run[i - 1]
      const [bx, by, bkm] = run[i]
      const dx = bx - ax
      const dy = by - ay
      const squared = dx * dx + dy * dy
      if (squared === 0) continue
      // Clamped, so a point past either end of the line projects onto that end
      // and reports the distance to it — which is what makes it rejectable.
      const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / squared))
      const offset = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
      if (best && offset >= best.offset) continue
      best = { km: akm + t * (bkm - akm), offset }
    }
  }
  return best
}

/**
 * The kilometrage of a plane point of `track`, out of the lines the project
 * holds: the one the track names if it names one, else whichever runs closest.
 *
 * Station tracks carry no line number of their own — in a station they are
 * stationed against the line running through it, which is exactly what the
 * closest line is.
 */
export function kmForTrackPoint(kmLines, track, point) {
  const named = (kmLines ?? []).filter(
    (l) => track.lineNumber && String(l.lineNumber) === String(track.lineNumber))
  const candidates = named.length ? named : (kmLines ?? [])

  let best = null
  for (const kmLine of candidates) {
    const hit = kmOnRuns(planeRuns(kmLine, track.epsg), point)
    if (!hit) continue
    if (best && hit.offset >= best.offset) continue
    best = { ...hit, lineNumber: kmLine.lineNumber }
  }
  return best
}
