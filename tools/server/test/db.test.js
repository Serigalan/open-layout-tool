import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, schemaVersion } from '../src/db.js'

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
})
