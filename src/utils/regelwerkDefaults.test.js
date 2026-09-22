import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REGELWERK_ID, MAX_SWITCH_CANT, MAX_SWITCH_CANT_DEF, CANT_DEFICIENCY_COEFF } from './regelwerkDefaults'

// The one test that keeps regelwerkDefaults.js honest against the Python files
// it is a copy of — reading them straight off disk, not through a build step,
// so there is nothing between a changed number there and a failing test here.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf-8'))

describe('regelwerkDefaults, against the files it is a copy of', () => {
  it('matches tools/optimizer/olt_optimizer/regelwerke/db-ril-800.json', () => {
    const rw = readJson(`tools/optimizer/olt_optimizer/regelwerke/${REGELWERK_ID}.json`)
    expect(rw.id).toBe(REGELWERK_ID)
    expect(MAX_SWITCH_CANT).toBe(rw.weiche.u_max.wert)
    expect(MAX_SWITCH_CANT_DEF).toBe(rw.weiche.uf_max.wert)
  })

  it('matches tools/optimizer/physics.json', () => {
    const physics = readJson('tools/optimizer/physics.json')
    expect(CANT_DEFICIENCY_COEFF).toBe(physics.ueberhoehungsfehlbetrag_koeffizient.wert)
  })
})
