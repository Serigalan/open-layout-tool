import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { openDatabase, schemaVersion } from '../src/db.js'

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))

let dir
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

describe('the database', () => {
  it('is brought up to date once and opened again without applying anything twice', () => {
    dir = mkdtempSync(join(tmpdir(), 'olt-db-'))
    const file = join(dir, 'olt.sqlite')
    const a = openDatabase(file)
    const v = schemaVersion(a)
    expect(v).toBeGreaterThanOrEqual(1)
    expect(a.pragma('journal_mode', { simple: true })).toBe('wal')
    a.close()
    const b = openDatabase(file)
    expect(schemaVersion(b)).toBe(v)
    expect(b.prepare('SELECT COUNT(*) FROM schema_migration').pluck().get()).toBe(v)
    b.close()
  })

  it('writes a consistent backup', async () => {
    dir = mkdtempSync(join(tmpdir(), 'olt-db-'))
    const db = openDatabase(join(dir, 'olt.sqlite'))
    await db.backup(join(dir, 'copy.sqlite'))
    db.close()
    expect(existsSync(join(dir, 'copy.sqlite'))).toBe(true)
    const copy = openDatabase(join(dir, 'copy.sqlite'))
    expect(schemaVersion(copy)).toBeGreaterThanOrEqual(1)
    copy.close()
  })

  it('keeps whoever already worked on a project on it when members come in (migration 005)', () => {
    dir = mkdtempSync(join(tmpdir(), 'olt-db-'))
    const file = join(dir, 'olt.sqlite')
    // The database as it was before 005, with a project of Ada's that Max
    // checked into and Eva branched off, and one Max has not touched.
    const old = new Database(file)
    old.exec('CREATE TABLE schema_migration (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
    for (const f of readdirSync(MIGRATIONS).filter(f => /^00[1-4]_.*\.sql$/.test(f)).sort()) {
      old.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
      old.prepare('INSERT INTO schema_migration VALUES (?, ?, ?)').run(Number.parseInt(f, 10), f, 'x')
    }
    const t = '2026-10-01T00:00:00Z'
    for (const [id, login] of [[1, 'ada'], [2, 'max'], [3, 'eva'], [4, 'tom']]) {
      old.prepare("INSERT INTO user (id, login, name, password_hash, role, created_at) VALUES (?, ?, ?, 'x', 'user', ?)").run(id, login, login, t)
    }
    for (const p of ['p1', 'p2']) old.prepare('INSERT INTO project (id, title, created_by, created_at) VALUES (?, ?, 1, ?)').run(p, p, t)
    const rev = old.prepare("INSERT INTO revision (id, project_id, number, variant_id, author_id, created_at, schema_version, payload) VALUES (?, ?, ?, ?, ?, ?, 2, x'00')")
    rev.run(1, 'p1', 1, 'v1', 1, t)
    rev.run(2, 'p1', 2, 'v1', 2, t)
    rev.run(3, 'p2', 1, 'v3', 1, t)
    const variant = old.prepare('INSERT INTO variant (id, project_id, name, head_revision_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    variant.run('v1', 'p1', 'Bestand', 2, 1, t)
    variant.run('v2', 'p1', '2030', 1, 3, t)
    variant.run('v3', 'p2', 'Bestand', 3, 1, t)
    old.close()

    const db = openDatabase(file)
    const members = db.prepare('SELECT project_id, user_id FROM project_member ORDER BY project_id, user_id').all()
    expect(members).toEqual([{ project_id: 'p1', user_id: 2 }, { project_id: 'p1', user_id: 3 }])
    db.close()
  })
})
