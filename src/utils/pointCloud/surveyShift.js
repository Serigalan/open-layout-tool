import { cloudToPlane, planeToCloud } from './cloudCrs'
import { surveyPoints } from '../axisSurvey'

/**
 * Measured axes and the re-referencing of the clouds they were traced in
 * (AP 13.15). A survey remembers each server cloud it was read from with the
 * transformation in force then (`cloudRefs: [{ id, transform }]`); once a
 * cloud is read through another one, the survey is marked "taken before the
 * re-referencing" and can be carried along — every point read back into the
 * cloud's file the old way and out of it the new way — or traced anew.
 */

/** What a survey keeps of the clouds a trace read: the server's, with their transformation. */
export const cloudRefsOf = (clouds) => clouds.filter(c => c.server).map(c => ({
  id: c.id, crs: c.crs ?? null,
  transform: c.transform ? { id: c.transform.id, matrix: c.transform.matrix, crs: c.transform.crs } : null,
}))

/**
 * The clouds of a survey whose transformation changed since it was traced:
 * `[{ id, name, crs, old, now }]`, `rows` the project's clouds as the server
 * lists them. A cloud deleted since is left out; a survey from before the
 * clouds were remembered says nothing.
 */
export function surveyChanges(survey, rows) {
  const out = []
  for (const ref of survey?.cloudRefs ?? []) {
    const row = rows.find(r => r.id === ref.id)
    if (!row) continue
    if ((row.transform?.id ?? null) === (ref.transform?.id ?? null)) continue
    out.push({ id: row.id, name: row.name, crs: row.crs ?? ref.crs, old: ref.transform, now: row.transform })
  }
  return out
}

/**
 * The survey carried from transformation `old` to `now` of the cloud it was
 * traced in (one `change` of surveyChanges): each axis point read back into
 * the file as it was read, then out again through the transformation in
 * force; the heads move with the axis. The cloud's entry is brought up to date.
 */
export function shiftSurvey(survey, change) {
  const epsg = survey.epsg
  const back = planeToCloud({ crs: change.crs, transform: change.old }, epsg)
  const out = cloudToPlane({ crs: change.crs, transform: change.now }, epsg)
  const move = (e, n, z) => {
    const f = back ? back(e, n, z) : [e, n, z]
    return out ? out(...f) : f
  }
  const p = survey.points
  const pts = surveyPoints(survey)
  const mm = (v) => Math.round(v * 1000)
  const moved = pts.map((q) => {
    const z = Math.min(q.zLeft, q.zRight)
    const [e, n, z2] = move(q.easting, q.northing, z)
    return { e, n, dz: z2 - z }
  })
  return {
    ...survey,
    cloudRefs: survey.cloudRefs.map(r => (r.id === change.id
      ? { ...r, transform: change.now ? { id: change.now.id, matrix: change.now.matrix, crs: change.now.crs } : null }
      : r)),
    points: {
      ...p,
      de: moved.map(m => mm(m.e - p.e0)),
      dn: moved.map(m => mm(m.n - p.n0)),
      zl: p.zl.map((v, i) => v + mm(moved[i].dz)),
      zr: p.zr.map((v, i) => v + mm(moved[i].dz)),
    },
  }
}
