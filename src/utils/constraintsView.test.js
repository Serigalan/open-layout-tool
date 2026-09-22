import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { flattenPhysics, appValueFor, PHYSICS } from './constraintsView'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf-8'))
const physics = readJson('tools/optimizer/physics.json')
const dbRil800 = readJson('tools/optimizer/olt_optimizer/regelwerke/db-ril-800.json')

describe('the bundled physics file', () => {
  // The point of the build-time import is that the popup shows the one file in
  // the repo, not a transcription of it. A copy pasted into src/ would still
  // render — and would be stale the first time the file changes — so the
  // identity is worth stating.
  it('is tools/optimizer/physics.json itself, not a copy of it', () => {
    expect(PHYSICS).toEqual(physics)
  })
})

describe('flattenPhysics', () => {
  it('takes one row per { wert, ... } entry and leaves groups alone', () => {
    const { konstanten, profile } = flattenPhysics({
      beschreibung: 'Text, kein Wert',
      koeff: { wert: 11.8, einheit: '-', formel_text: 'v = …', herleitung: 'weil', warum: 'wofür' },
      uebergangsbogenprofile: { clothoid: { name: 'Klothoide', kruemmung_text: 'kappa(s) = …', warum: 'wofür' } },
    })
    expect(konstanten).toEqual([{
      path: 'koeff', wert: 11.8, einheit: '-', formelText: 'v = …', formelLatex: '',
      herleitung: 'weil', warum: 'wofür', woVerwendet: 'Optimierer',
    }])
    expect(profile).toEqual([{
      key: 'clothoid', name: 'Klothoide', kruemmung: '', kruemmungText: 'kappa(s) = …',
      kruemmungLatex: '', warum: 'wofür',
    }])
  })

  it('answers empty for a file that states nothing', () => {
    expect(flattenPhysics({})).toEqual({ konstanten: [], profile: [] })
    expect(flattenPhysics(null)).toEqual({ konstanten: [], profile: [] })
  })
})

describe('flattenPhysics against the real physics.json', () => {
  const { konstanten, profile } = flattenPhysics(physics)

  it('finds all three constants, in file order, with their units', () => {
    expect(konstanten.map(r => r.path)).toEqual([
      'ueberhoehungsfehlbetrag_koeffizient', 'wirksame_spurweite', 'erdbeschleunigung',
    ])
    expect(konstanten.map(r => r.wert)).toEqual([11.8, 1.5, 9.81])
    expect(konstanten.map(r => r.einheit)).toEqual(['-', 'm', 'm/s^2'])
  })

  it('has a specific "wo verwendet" label for every constant, not the generic fallback', () => {
    expect(konstanten.filter(r => r.woVerwendet === 'Optimierer')).toEqual([])
  })

  it('carries the coefficient with its formula and its derivation', () => {
    const coeff = konstanten[0]
    expect(coeff.formelText).toContain('sqrt')
    expect(coeff.herleitung).not.toBe('')
  })

  it('finds both transition curve profiles with their curvature function', () => {
    expect(profile.map(p => p.key)).toEqual(['clothoid', 'bloss'])
    for (const p of profile) {
      expect(p.name).not.toBe('')
      expect(p.kruemmungText).toContain('kappa(s)')
    }
  })
})

describe('appValueFor', () => {
  // The column only has something to say where the app really does hold the
  // value itself; everywhere else it stays empty rather than repeating the
  // service's number as if it were a second source.
  it('answers with the app copy for the switch limits, and null elsewhere', () => {
    expect(appValueFor('weiche.u_max')).toBe(dbRil800.weiche.u_max.wert)
    expect(appValueFor('weiche.uf_max')).toBe(dbRil800.weiche.uf_max.wert)
    expect(appValueFor('ueberhoehung.u_max')).toBeNull()
    expect(appValueFor('nicht.vorhanden')).toBeNull()
  })
})
