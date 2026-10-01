import { createHash, randomBytes } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'

/** Shortest password accepted. */
export const PASSWORD_MIN = 12

/** A session lives this long without being used [ms]. */
export const SESSION_IDLE = 30 * 24 * 3600 * 1000

/** Failed logins per login and address before the brake … */
export const BRAKE_ATTEMPTS = 5
/** … holds for this long [ms]. */
export const BRAKE_MS = 60 * 1000

export const COOKIE = 'olt_session'

// argon2id with the library's defaults (19 MiB, 2 passes) — what OWASP names.
export const hashPassword = (password) => hash(password)

export async function verifyPassword(stored, password) {
  try { return await verify(stored, password) } catch { return false }
}

export const passwordAcceptable = (p) => typeof p === 'string' && [...p].length >= PASSWORD_MIN

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/** A fresh random password for a start password or a reset (20 characters). */
export const randomPassword = () => randomBytes(15).toString('base64url')

/** The user as the API shows it — never the hash. */
export function publicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    login: row.login,
    name: row.name,
    role: row.role,
    active: Boolean(row.active),
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  }
}

/**
 * Users and sessions on one database. `now` is injectable for tests.
 */
export function createAuth(db, { now = () => Date.now() } = {}) {
  const iso = (ms = now()) => new Date(ms).toISOString()
  const q = {
    userById:      db.prepare('SELECT * FROM user WHERE id = ?'),
    userByLogin:   db.prepare('SELECT * FROM user WHERE login = ?'),
    insertUser:    db.prepare(`INSERT INTO user (login, name, password_hash, role, active, must_change_password, created_at)
                               VALUES (@login, @name, @password_hash, @role, 1, @must_change_password, @created_at)`),
    listUsers:     db.prepare('SELECT * FROM user ORDER BY login COLLATE NOCASE'),
    activeAdmins:  db.prepare("SELECT COUNT(*) FROM user WHERE role = 'admin' AND active = 1").pluck(),
    setPassword:   db.prepare('UPDATE user SET password_hash = ?, must_change_password = ? WHERE id = ?'),
    setLastLogin:  db.prepare('UPDATE user SET last_login_at = ? WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO session (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    session:       db.prepare('SELECT * FROM session WHERE token_hash = ?'),
    touchSession:  db.prepare('UPDATE session SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?'),
    dropSession:   db.prepare('DELETE FROM session WHERE token_hash = ?'),
    dropSessions:  db.prepare('DELETE FROM session WHERE user_id = ?'),
    dropExpired:   db.prepare('DELETE FROM session WHERE expires_at < ?'),
  }

  // Failed logins by `login|address`: { count, until }.
  const failures = new Map()

  return {
    q,

    async createUser({ login, name, password, role = 'user', mustChangePassword = true }) {
      const row = {
        login: String(login).trim(), name: String(name ?? login).trim(),
        password_hash: await hashPassword(password), role,
        must_change_password: mustChangePassword ? 1 : 0, created_at: iso(),
      }
      const { lastInsertRowid } = q.insertUser.run(row)
      return q.userById.get(lastInsertRowid)
    },

    userById: (id) => q.userById.get(id),
    userByLogin: (login) => q.userByLogin.get(String(login ?? '').trim()),
    listUsers: () => q.listUsers.all(),
    activeAdmins: () => q.activeAdmins.get(),

    async setPassword(userId, password, { mustChange = false } = {}) {
      q.setPassword.run(await hashPassword(password), mustChange ? 1 : 0, userId)
    },

    /** Seconds until this login may be tried again from this address, or 0. */
    braked(login, address) {
      const f = failures.get(`${String(login).toLowerCase()}|${address}`)
      if (!f || !f.until) return 0
      const left = f.until - now()
      return left > 0 ? Math.ceil(left / 1000) : 0
    },

    /**
     * Check a login. Returns the user row, or null — the same null for an
     * unknown login, a wrong password and a deactivated user, so a caller
     * cannot tell them apart.
     */
    async check(login, password, address) {
      const key = `${String(login).toLowerCase()}|${address}`
      const user = q.userByLogin.get(String(login ?? '').trim())
      const ok = user && user.active && await verifyPassword(user.password_hash, String(password ?? ''))
      if (ok) { failures.delete(key); return user }
      const f = failures.get(key) ?? { count: 0, until: 0 }
      if (f.until && f.until <= now()) { f.count = 0; f.until = 0 }
      f.count += 1
      if (f.count >= BRAKE_ATTEMPTS) f.until = now() + BRAKE_MS
      failures.set(key, f)
      return null
    },

    /** Open a session; returns the token for the cookie. */
    openSession(userId) {
      const token = randomBytes(32).toString('base64url')
      const t = now()
      q.insertSession.run(sha256(token), userId, iso(t), iso(t), iso(t + SESSION_IDLE))
      q.setLastLogin.run(iso(t), userId)
      return token
    },

    /** The user behind a session token, the session renewed; null when none or expired. */
    resolveSession(token) {
      if (!token) return null
      const h = sha256(token)
      const s = q.session.get(h)
      if (!s) return null
      const t = now()
      if (s.expires_at < iso(t)) { q.dropSession.run(h); return null }
      const user = q.userById.get(s.user_id)
      if (!user?.active) { q.dropSessions.run(s.user_id); return null }
      q.touchSession.run(iso(t), iso(t + SESSION_IDLE), h)
      return user
    },

    closeSession(token) { if (token) q.dropSession.run(sha256(token)) },
    closeAllSessions(userId) { q.dropSessions.run(userId) },
    sweep() { q.dropExpired.run(iso()) },
  }
}
