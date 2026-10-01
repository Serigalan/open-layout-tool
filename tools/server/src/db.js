import Database from 'better-sqlite3'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))

/**
 * Open the database (a file, or ':memory:' for tests) in WAL mode with foreign
 * keys on, and bring its schema up to date. Every access goes through the
 * functions of this module and the route modules' prepared statements — no
 * SQL is built from request data.
 */
export function openDatabase(file) {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

/**
 * Apply the numbered SQL files under migrations/ that this database has not
 * seen, each in a transaction of its own, in order.
 */
export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  const done = new Set(db.prepare('SELECT version FROM schema_migration').pluck().all())
  const files = readdirSync(MIGRATIONS).filter(f => /^\d+_.*\.sql$/.test(f)).sort()
  for (const file of files) {
    const version = Number.parseInt(file, 10)
    if (done.has(version)) continue
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)')
        .run(version, file, new Date().toISOString())
    })()
  }
}

/** The schema version a database is at. */
export const schemaVersion = (db) => db.prepare('SELECT MAX(version) FROM schema_migration').pluck().get() ?? 0
