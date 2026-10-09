import { PayloadError, SCHEMA_VERSION, dehydrateProjects, parseProjectsPayload } from '../../../src/core/utils/persistenceUtils.js'
import { newFindings, validateProject } from '../../../src/core/utils/validateProject.js'
import { ApiError } from './errors.js'

/**
 * A record coming in, taken through the browser's own door (decision 91):
 * parseProjectsPayload refuses what is not this tool's, dehydrateProjects
 * strips whatever derived geometry rode along, validateProject says what holds.
 * The server trusts the browser in none of it.
 *
 * Returns { record, errors, warnings }.
 */
export function checkRecord(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ApiError(422, 'invalid_payload')
  let parsed
  try {
    parsed = parseProjectsPayload({ version: SCHEMA_VERSION, projects: [payload] })
  } catch (err) {
    throw new ApiError(422, err instanceof PayloadError ? err.code : 'invalid_payload')
  }
  const [record] = dehydrateProjects(parsed.projects)
  const { errors, warnings } = validateProject(record)
  return { record, errors, warnings }
}

/**
 * A stored record as checkRecord would hand it on today — parsed and
 * dehydrated, not validated — so a part of it compares with a record coming
 * in even where the parsing has since filled in more.
 */
export function normalizedRecord(payload) {
  try {
    return dehydrateProjects(parseProjectsPayload({ version: SCHEMA_VERSION, projects: [payload] }).projects)[0]
  } catch {
    return payload
  }
}

/** The errors of `errors` a revision with `knownKeys` did not have. */
export const freshErrors = (errors, knownKeys) => newFindings(errors, knownKeys.map(key => ({ key })))

/** JSON with the keys of every object sorted — two records' parts compared as values. */
const canonical = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]]))
  : x))

/**
 * Whether the measured axes of `record` are other than its parents have them
 * (decision 216): each one — and each one gone — must be as the base or the
 * merge parent has it. Saving or deleting a measured axis is changing point
 * clouds; a merge only carries over what one side already had.
 */
export function axisSurveysChanged(record, base, mergeParent = null) {
  const byId = (r) => new Map((r?.axisSurveys ?? []).map(s => [s?.id, canonical(s)]))
  const now = byId(record), parents = [byId(base), ...(mergeParent ? [byId(mergeParent)] : [])]
  const ids = new Set([...now.keys(), ...parents.flatMap(p => [...p.keys()])])
  return [...ids].some(id => !parents.some(p => p.get(id) === now.get(id)))
}
