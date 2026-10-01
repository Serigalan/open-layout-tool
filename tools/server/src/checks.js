import { PayloadError, dehydrateProjects, parseProjectsPayload } from '../../../src/utils/persistenceUtils.js'
import { newFindings, validateProject } from '../../../src/utils/validateProject.js'
import { ApiError } from './errors.js'
import { SCHEMA_VERSION } from './store.js'

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

/** The errors of `errors` a revision with `knownKeys` did not have. */
export const freshErrors = (errors, knownKeys) => newFindings(errors, knownKeys.map(key => ({ key })))
