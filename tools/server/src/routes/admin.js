import { ApiError } from '../errors.js'
import { passwordAcceptable, publicUser } from '../auth.js'

const ROLES = new Set(['admin', 'user'])

/**
 * The user administration, admins only (AP 10.4, page in AP 10.9). Nobody
 * signs themselves up; a user is never deleted, only deactivated — which, like
 * a password reset, ends all their sessions. The last active admin cannot be
 * demoted or deactivated: the system would have nobody left to administer it.
 */
export default async function adminRoutes(api) {
  const { auth } = api
  const opts = { preHandler: api.requireAdmin }

  api.get('/admin/users', opts, async () => ({ users: auth.listUsers().map(publicUser) }))

  api.post('/admin/users', opts, async (req, reply) => {
    const { login, name, role = 'user', password } = req.body ?? {}
    if (!/^[\p{L}\p{N}._@-]{2,64}$/u.test(String(login ?? '').trim())) throw new ApiError(422, 'login_invalid')
    if (!ROLES.has(role)) throw new ApiError(422, 'role_invalid')
    if (!passwordAcceptable(password)) throw new ApiError(422, 'password_too_short')
    if (auth.userByLogin(login)) throw new ApiError(409, 'login_taken')
    const user = await auth.createUser({ login, name: String(name ?? '').trim() || String(login).trim(), password, role, mustChangePassword: true })
    return reply.code(201).send({ user: publicUser(user) })
  })

  api.patch('/admin/users/:id', opts, async (req) => {
    const user = auth.userById(Number(req.params.id))
    if (!user) throw new ApiError(404, 'not_found')
    const { name, role, active, password } = req.body ?? {}
    const losesAdmin = user.role === 'admin' && user.active
      && ((role !== undefined && role !== 'admin') || active === false)
    if (losesAdmin && auth.activeAdmins() <= 1) throw new ApiError(409, 'last_admin')
    if (role !== undefined && !ROLES.has(role)) throw new ApiError(422, 'role_invalid')
    if (password !== undefined && !passwordAcceptable(password)) throw new ApiError(422, 'password_too_short')

    api.db.transaction(() => {
      if (name !== undefined) api.db.prepare('UPDATE user SET name = ? WHERE id = ?').run(String(name).trim() || user.login, user.id)
      if (role !== undefined) api.db.prepare('UPDATE user SET role = ? WHERE id = ?').run(role, user.id)
      if (active !== undefined) api.db.prepare('UPDATE user SET active = ? WHERE id = ?').run(active ? 1 : 0, user.id)
    })()
    if (password !== undefined) await auth.setPassword(user.id, password, { mustChange: true })
    if (active === false || password !== undefined) auth.closeAllSessions(user.id)
    return { user: publicUser(auth.userById(user.id)) }
  })
}
