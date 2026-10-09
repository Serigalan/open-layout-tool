import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REGELWERK_ID, MAX_SWITCH_CANT, MAX_SWITCH_CANT_DEF, CANT_DEFICIENCY_COEFF } from './regelwerkDefaults'

// Keeps regelwerkDefaults.js honest against the files it reads from — straight
// off disk, not through a build step, so there is nothing between a changed
// number there and a failing test here.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf-8'))

describe('regelwerkDefaults, against the files it reads', () => {
  it('names the catalogue the optimizer applies too, and takes the switch limits from its rules', () => {
    const katalog = readJson(`src/core/constraints/${REGELWERK_ID}.json`)
    expect(katalog.catalog.id).toBe(REGELWERK_ID)
    const rule = (id) => katalog.rules.find(r => r.id === id)
    expect(MAX_SWITCH_CANT).toBe(Number(rule('LP.KB.05').thresholds.reg.expr))
    expect(MAX_SWITCH_CANT_DEF).toBe(Number(rule('LP.KB.06').thresholds.max.expr))
  })

  it('has no copy of the catalogue beside the optimizer any more — it reads this one', () => {
    // tools/optimizer/olt_optimizer/constraints is a symlink to src/core/constraints.
    const linked = fs.realpathSync(path.join(repoRoot, 'tools/optimizer/olt_optimizer/constraints'))
    expect(linked).toBe(fs.realpathSync(path.join(repoRoot, 'src/core/constraints')))
    expect(fs.existsSync(path.join(repoRoot, 'tools/optimizer/olt_optimizer/regelwerke'))).toBe(false)
  })

  it('matches src/core/constraints/physics.json', () => {
    const physics = readJson('src/core/constraints/physics.json')
    expect(CANT_DEFICIENCY_COEFF).toBe(physics.ueberhoehungsfehlbetrag_koeffizient.wert)
  })
})
