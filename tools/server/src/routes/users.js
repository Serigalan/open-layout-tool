import { ApiError } from '../errors.js'

/** Most users one search answers with. */
export const SEARCH_LIMIT = 20

/**
 * Finding a user to add to a project (decision 127). Any signed-in user may
 * search, and sees what the project lists show anyway — name and login of
 * active users, never role, state or anything else.
 */
export default async function userRoutes(api) {
  const search = api.db.prepare(`SELECT id, login, name FROM user
    WHERE active = 1 AND (login LIKE @q ESCAPE '\\' OR name LIKE @q ESCAPE '\\')
    ORDER BY name COLLATE NOCASE LIMIT ${SEARCH_LIMIT}`)

  api.get('/users', { preHandler: api.requireUser }, async (req) => {
    const text = String(req.query?.q ?? '').trim()
    if (text.length < 2) throw new ApiError(422, 'query_too_short')
    const q = `%${text.slice(0, 100).replace(/[\\%_]/g, c => `\\${c}`)}%`
    return { users: search.all({ q }) }
  })
}
