/**
 * A measured track axis kept in the project (AP 12.3, Entscheidung 132): the
 * axis points a trace found in the point clouds, shared with the record like
 * any other object — unlike the clouds, which stay on the device they were
 * read on (Entscheidung 119). A survey belongs to no track: its points lie in
 * a plane of their own (`epsg`), so changing the track it was traced along
 * leaves it as it is.
 *
 *   { id, name, epsg, rail, guide: { kind: 'track'|'line', trackId? },
 *     cloudNames, createdAt, step, gaps: [{ from, to }],
 *     points: { e0, n0, z0, st, de, dn, zl, zr, ga, q } }
 *
 * The points are packed as whole millimetres in parallel arrays: station along
 * the guide (`st`), easting and northing from (e0, n0) (`de`, `dn`), the two
 * head tops from z0 (`zl`, `zr`), the gauge (`ga`) and the quality (`q`, 1
 * good, 0 doubtful) — some 40 bytes of JSON a point, 80 kB a kilometre.
 */

const mm = (v) => Math.round(v * 1000)

/** A survey record from the result of a trace (railTrace.traceTrack). */
export function surveyFromTrace({ id, name, rail, guide, cloudNames = [], createdAt, step }, { points, gaps, epsg }) {
  const first = points[0]
  const e0 = first ? Math.round(first.easting) : 0
  const n0 = first ? Math.round(first.northing) : 0
  const z0 = first ? Math.round(Math.min(first.zLeft, first.zRight)) : 0
  return {
    id, name, epsg, rail, guide, cloudNames, createdAt, step,
    gaps: gaps.map(g => ({ from: g.from, to: g.to })),
    points: {
      e0, n0, z0,
      st: points.map(p => mm(p.station)),
      de: points.map(p => mm(p.easting - e0)),
      dn: points.map(p => mm(p.northing - n0)),
      zl: points.map(p => mm(p.zLeft - z0)),
      zr: points.map(p => mm(p.zRight - z0)),
      ga: points.map(p => mm(p.gauge)),
      q: points.map(p => (p.quality === 'good' ? 1 : 0)),
    },
  }
}

/** The points of a survey as a trace gives them: `[{ station, easting, northing, zLeft, zRight, cant, gauge, quality }]`. */
export function surveyPoints(survey) {
  const p = survey?.points
  if (!p?.st) return []
  return p.st.map((st, i) => {
    const zLeft = p.z0 + p.zl[i] / 1000, zRight = p.z0 + p.zr[i] / 1000
    return {
      station: st / 1000,
      easting: p.e0 + p.de[i] / 1000,
      northing: p.n0 + p.dn[i] / 1000,
      zLeft, zRight,
      cant: (p.zl[i] - p.zr[i]) / 1000,
      gauge: p.ga[i] / 1000,
      quality: p.q[i] ? 'good' : 'doubtful',
    }
  })
}

/**
 * The survey without the points at `indices` (their places in the arrays, as
 * surveyPoints numbers them) — taken out by hand where a trace went wrong.
 * The origin stays, so every other point keeps its coordinates to the mm.
 */
export function withoutPoints(survey, indices) {
  const drop = new Set(indices)
  const p = survey.points
  const keep = (a) => a.filter((_, i) => !drop.has(i))
  return {
    ...survey,
    points: { ...p, st: keep(p.st), de: keep(p.de), dn: keep(p.dn), zl: keep(p.zl), zr: keep(p.zr), ga: keep(p.ga), q: keep(p.q) },
  }
}

/** How many points a survey has, how many of them good, and the stretch of the guide they cover [m]. */
export function surveyStats(survey) {
  const p = survey?.points
  const n = p?.st?.length ?? 0
  return {
    points: n,
    good: n ? p.q.reduce((a, q) => a + q, 0) : 0,
    from: n ? p.st[0] / 1000 : 0,
    to: n ? p.st[n - 1] / 1000 : 0,
  }
}

/**
 * Whether a survey record holds together: a plane, and arrays of one length.
 * Returns the name of the first thing wrong, or null.
 */
export function surveyDefect(survey) {
  if (!survey?.id) return 'id'
  if (!Number.isFinite(Number(survey.epsg))) return 'epsg'
  const p = survey.points
  if (!p || !Array.isArray(p.st)) return 'points'
  for (const key of ['de', 'dn', 'zl', 'zr', 'ga', 'q']) {
    if (!Array.isArray(p[key]) || p[key].length !== p.st.length) return key
  }
  return null
}
