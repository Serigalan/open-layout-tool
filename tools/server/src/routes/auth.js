import { ApiError } from '../errors.js'
import { COOKIE, passwordAcceptable, publicUser, verifyPassword } from '../auth.js'

/** Signing in and out, who am I, my own password (AP 10.4). */
export default async function authRoutes(api) {
  const { auth } = api

  api.post('/login', async (req, reply) => {
    const { login, password } = req.body ?? {}
    const address = req.ip
    const wait = auth.braked(login, address)
    if (wait) throw new ApiError(429, 'too_many_attempts', { retryAfter: wait })
    const user = await auth.check(login, password, address)
    if (!user) {
      const after = auth.braked(login, address)
      throw new ApiError(after ? 429 : 401, after ? 'too_many_attempts' : 'invalid_credentials', after ? { retryAfter: after } : {})
    }
    api.sessionCookie(reply, auth.openSession(user.id))
    return { user: publicUser(auth.userById(user.id)) }
  })

  // Signing out ends every session of the user, on every device.
  api.post('/logout', async (req, reply) => {
    if (req.user) auth.closeAllSessions(req.user.id)
    else auth.closeSession(req.cookies?.[COOKIE])
    api.clearSessionCookie(reply)
    return reply.code(204).send()
  })

  // Also what Caddy's forward_auth asks before it lets a request through to
  // the optimizer, the tiles or the terrain: 200 signed in, 401 not.
  api.get('/me', async (req) => {
    if (!req.user) throw new ApiError(401, 'unauthenticated')
    return { user: publicUser(req.user) }
  })

  api.post('/me/password', async (req, reply) => {
    if (!req.user) throw new ApiError(401, 'unauthenticated')
    const { current, next } = req.body ?? {}
    if (!await verifyPassword(req.user.password_hash, String(current ?? ''))) throw new ApiError(403, 'wrong_password')
    if (!passwordAcceptable(next)) throw new ApiError(422, 'password_too_short')
    if (next === current) throw new ApiError(422, 'password_unchanged')
    await auth.setPassword(req.user.id, next, { mustChange: false })
    return reply.code(204).send()
  })
}
