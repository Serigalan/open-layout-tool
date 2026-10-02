import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { COOKIE, SESSION_IDLE, createAuth } from './auth.js'
import { ApiError } from './errors.js'
import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import projectRoutes from './routes/projects.js'
import userRoutes from './routes/users.js'

/** Largest request body [bytes] — a large MDB import fits, a runaway does not fill the disk. */
export const BODY_LIMIT = 20 * 1024 * 1024

const WRITING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Whose X-Forwarded-For is believed: only the reverse proxy's (Caddy on the
 * same host). Believing anybody's would let a client that reaches the port
 * directly name its own address, and with it step around the login brake.
 * A Caddy elsewhere (a container) is named in OLT_SERVER_TRUST_PROXY.
 */
export const TRUSTED_PROXIES = ['127.0.0.1', '::1']

/**
 * The API under /api (phase 10). Same origin as the app, so no CORS: the
 * session is an HttpOnly, SameSite=Strict cookie, and a writing request has to
 * say it carries JSON — a form another site posts cannot, which closes the
 * cross-site way in together with SameSite.
 *
 * `secureCookie` is off only for plain-http tests and local runs.
 */
export function buildApp({
  db, secureCookie = true, now = () => Date.now(), logger = false, routes = [], trustProxy = TRUSTED_PROXIES,
} = {}) {
  const app = Fastify({ logger, bodyLimit: BODY_LIMIT, trustProxy })
  const auth = createAuth(db, { now })
  app.decorate('db', db)
  app.decorate('auth', auth)
  app.decorate('now', now)
  app.decorateRequest('user', null)

  app.register(cookie)

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send({ error: err.error, ...err.extra })
    if (err.statusCode === 413) return reply.code(413).send({ error: 'too_large' })
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'bad_request', message: err.message })
    req.log.error(err)
    return reply.code(500).send({ error: 'internal' })
  })

  app.addHook('onRequest', async (req) => {
    if (WRITING.has(req.method) && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      throw new ApiError(415, 'json_required')
    }
    req.user = auth.resolveSession(req.cookies?.[COOKIE])
  })

  app.decorate('sessionCookie', (reply, token) => reply.setCookie(COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'strict', secure: secureCookie, maxAge: SESSION_IDLE / 1000,
  }))
  app.decorate('clearSessionCookie', (reply) => reply.clearCookie(COOKIE, {
    path: '/', httpOnly: true, sameSite: 'strict', secure: secureCookie,
  }))

  /** preHandler: a signed-in user who may work (start password already changed). */
  app.decorate('requireUser', async (req) => {
    if (!req.user) throw new ApiError(401, 'unauthenticated')
    if (req.user.must_change_password) throw new ApiError(403, 'password_change_required')
  })
  app.decorate('requireAdmin', async (req) => {
    await app.requireUser(req)
    if (req.user.role !== 'admin') throw new ApiError(403, 'admin_only')
  })

  app.register(async (api) => {
    // For the deploy script and monitoring: the process answers and the
    // database can be read. Needs no session.
    api.get('/health', async () => {
      db.prepare('select 1').get()
      return { status: 'ok' }
    })
    api.register(authRoutes)
    api.register(adminRoutes)
    api.register(projectRoutes)
    api.register(userRoutes)
    for (const r of routes) api.register(r)
  }, { prefix: '/api' })

  return app
}
