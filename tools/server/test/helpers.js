import { openDatabase } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { createAuth } from '../src/auth.js'

export const PW = 'correct horse battery'

/**
 * A server on a database in memory with a clock the test turns, and an admin
 * and a user who have changed their start passwords already.
 */
export async function setup({ routes } = {}) {
  const clock = { t: Date.parse('2026-10-01T08:00:00Z') }
  const now = () => clock.t
  const db = openDatabase(':memory:')
  const auth = createAuth(db, { now })
  await auth.createUser({ login: 'ada', name: 'Ada Admin', password: PW, role: 'admin', mustChangePassword: false })
  await auth.createUser({ login: 'max', name: 'Max Muster', password: PW, role: 'user', mustChangePassword: false })
  const app = buildApp({ db, secureCookie: false, now, routes })
  await app.ready()
  return { app, db, clock }
}

/** Sign in and return a request function carrying the session. */
export async function signIn(app, login, password = PW) {
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { login, password } })
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`)
  const cookie = res.cookies.find(c => c.name === 'olt_session')
  return as(app, cookie.value)
}

export function as(app, token) {
  const call = (method, url, payload) => app.inject({
    method, url,
    cookies: token ? { olt_session: token } : {},
    ...(payload !== undefined ? { payload } : method === 'GET' ? {} : { payload: {} }),
  })
  call.token = token
  return call
}
