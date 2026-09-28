import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUNDLED_KATALOG_VERSION, evalFormel, flattenPhysics, GRENZWERTE, optimizerLimitRows, PHYSICS,
} from './constraintsView'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf-8'))
const physics = readJson('src/constraints/physics.json')
const katalog = readJson('src/constraints/db-ril-800-0110.json')

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
      koeff: { wert: 11.8, einheit: '-', formel_calc: 'sqrt(R*(u+uf)/k)', formel_mathml: '<math></math>', herleitung: 'weil', warum: 'wofür' },
      uebergangsbogenprofile: { clothoid: { name: 'Klothoide', kruemmung_calc: 'kappa1', warum: 'wofür' } },
    })
    expect(konstanten).toEqual([{
      path: 'koeff', wert: 11.8, einheit: '-', formelCalc: 'sqrt(R*(u+uf)/k)', formelMathml: '<math></math>',
      herleitung: 'weil', warum: 'wofür', woVerwendet: 'Optimierer',
    }])
    expect(profile).toEqual([{
      key: 'clothoid', name: 'Klothoide', kruemmung: '', kruemmungCalc: 'kappa1',
      kruemmungMathml: '', warum: 'wofür',
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
    expect(coeff.formelCalc).toContain('sqrt')
    expect(coeff.herleitung).not.toBe('')
  })

  it('finds both transition curve profiles with their curvature function', () => {
    expect(profile.map(p => p.key)).toEqual(['clothoid', 'bloss'])
    for (const p of profile) {
      expect(p.name).not.toBe('')
      expect(p.kruemmungCalc).toContain('kappa1')
    }
  })
})

describe('evalFormel', () => {
  it('evaluates a bare arithmetic expression against named variables', () => {
    expect(evalFormel('a + b * 2', { a: 1, b: 3 })).toBe(7)
  })

  it('has sqrt available without it being passed as a variable', () => {
    expect(evalFormel('sqrt(a)', { a: 9 })).toBe(3)
  })
})

// formel_calc/kruemmung_calc exist so a test can hold the file to the same
// arithmetic the kernel runs — not just eyeball that the strings look like the
// right formula. tests/verify.py runs the matching check against geometry.py
// itself; there is no JS reimplementation of the kernel left to check against
// here (AP 7.1, decision 14: Python is the only optimizer), so this checks
// evalFormel against the closed forms worked out by hand instead.
describe('formel_calc/kruemmung_calc, evaluated against physics.json', () => {
  const { konstanten, profile } = flattenPhysics(physics)

  it('formel_calc reproduces permissible_speed for R=700, u=120, uf=130', () => {
    const koeff = konstanten[0]
    const v = evalFormel(koeff.formelCalc, { R: 700, u: 120, uf: 130, k: koeff.wert })
    expect(v).toBeCloseTo(Math.sqrt(700 * (120 + 130) / koeff.wert), 12)
  })

  it("clothoid's kruemmung_calc is linear in s (its own kruemmung_text says so)", () => {
    const clothoid = profile.find(p => p.key === 'clothoid')
    const [kappa1, kappa2, L] = [-0.01, 0.02, 120]
    for (const s of [0, 30, 120]) {
      const got = evalFormel(clothoid.kruemmungCalc, { kappa1, kappa2, L, s })
      const expected = kappa1 + (kappa2 - kappa1) * (s / L)     // by hand, not from the file
      expect(got).toBeCloseTo(expected, 12)
    }
    // Linear also means the midpoint sits exactly between the two ends —
    // an independent check the shape really is what "linear" claims.
    const mid = evalFormel(clothoid.kruemmungCalc, { kappa1, kappa2, L, s: L / 2 })
    expect(mid).toBeCloseTo((kappa1 + kappa2) / 2, 12)
  })

  it("bloss's kruemmung_calc is the cubic Hermite ease (its own kruemmung_text says so)", () => {
    const bloss = profile.find(p => p.key === 'bloss')
    const [kappa1, kappa2, L] = [-0.01, 0.02, 120]
    for (const s of [0, 45, 120]) {
      const t = s / L
      const got = evalFormel(bloss.kruemmungCalc, { kappa1, kappa2, L, s })
      const expected = kappa1 + (kappa2 - kappa1) * (3 * t ** 2 - 2 * t ** 3)   // by hand
      expect(got).toBeCloseTo(expected, 12)
    }
    // The point of Bloss over the clothoid: curvature change is zero at both
    // ends (the Hermite ease's own defining property), unlike the clothoid's
    // constant slope. Checked numerically, not by trusting the algebra above.
    const h = 1e-4
    for (const s of [0, L]) {
      const derivative = (
        evalFormel(bloss.kruemmungCalc, { kappa1, kappa2, L, s: s + h })
        - evalFormel(bloss.kruemmungCalc, { kappa1, kappa2, L, s: s - h })
      ) / (2 * h)
      expect(derivative).toBeCloseTo(0, 3)
    }
  })
})

// The formulas are drawn from the file's own MathML — the popup renders it as
// markup, so a broken tag would not fail loudly, it would quietly draw
// nothing. These are the checks that make it fail loudly instead.
describe('the MathML physics.json states', () => {
  const { konstanten, profile } = flattenPhysics(physics)
  const formulas = [
    ['ueberhoehungsfehlbetrag_koeffizient', konstanten[0].formelMathml],
    ...profile.map(p => [p.key, p.kruemmungMathml]),
  ]

  it('states one formula for the coefficient and one per profile', () => {
    expect(formulas.map(([key]) => key)).toEqual([
      'ueberhoehungsfehlbetrag_koeffizient', 'clothoid', 'bloss',
    ])
    for (const [key, xml] of formulas) expect(xml, key).not.toBe('')
  })

  for (const [key, xml] of formulas) {
    it(`${key}: is one <math> element in the MathML namespace, every tag closed`, () => {
      expect(xml.startsWith('<math ')).toBe(true)
      expect(xml.endsWith('</math>')).toBe(true)
      expect(xml).toContain('xmlns="http://www.w3.org/1998/Math/MathML"')
      // Not an XML parser — Node has none — but enough of one to catch the
      // way this breaks in practice: a tag left open or closed out of order.
      const stack = []
      for (const [, slash, name, , selfClose] of xml.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
        if (slash) expect(stack.pop(), `</${name}> closes the wrong element`).toBe(name)
        else if (!selfClose) stack.push(name)
      }
      expect(stack, 'left open').toEqual([])
    })
  }

  it('draws the cant deficiency formula over its own symbols', () => {
    const [, xml] = formulas[0]
    for (const part of ['<mi>v</mi>', '<mi>R</mi>', '<mi>u</mi>', '<msqrt>', '<mn>11,8</mn>']) {
      expect(xml).toContain(part)
    }
  })

  it('draws both curvature functions over kappa, s and L', () => {
    for (const [key, xml] of formulas.slice(1)) {
      for (const part of ['<mi>\u03ba</mi>', '<mi>s</mi>', '<mi>L</mi>', '<mfrac>']) {
        expect(xml, key).toContain(part)
      }
    }
    // The Bloss profile is the cubic one — its exponents are what says so.
    const bloss = formulas[2][1]
    expect(bloss).toContain('<mn>2</mn></msup>')
    expect(bloss).toContain('<mn>3</mn></msup>')
  })
})

describe('optimizerLimitRows', () => {
  // What GET /regelwerke/db-ril-800-0110 answers from a service built from
  // this commit (tools/optimizer, grenzen.py: Grenzen.describe) — JSON floats,
  // as Python sends them.
  const served = {
    id: 'db-ril-800-0110', name: katalog.catalog.title, version: katalog.catalog.katalog_version,
    grenzwerte: {
      reg: {
        stufe: 'reg', schlechtesteStufe: 'hint', geschwindigkeiten: [40.0, 300.0],
        uMax: 160.0, uMaxWeiche: 100.0, uStep: 5.0, ufMax: [130.0], ufMaxWeiche: [110.0],
        uebergangsbogen: ['clothoid'],
      },
      discretion: {
        stufe: 'discretion', schlechtesteStufe: 'warning', geschwindigkeiten: [40.0, 300.0],
        uMax: 160.0, uMaxWeiche: 120.0, uStep: 5.0, ufMax: [130.0, 150.0], ufMaxWeiche: [110.0],
        uebergangsbogen: ['clothoid', 'bloss'],
      },
    },
  }

  it('reads the same limits out of the bundled catalogue as the service does — no row disagrees', () => {
    const rows = optimizerLimitRows(served)
    expect(rows).toHaveLength(8)
    for (const row of rows) {
      for (const level of Object.keys(GRENZWERTE)) {
        expect(row[level].mismatch, `${row.label} ${level}`).toBe(false)
      }
    }
  })

  it('tells the two levels apart where the Ril does', () => {
    const byLabel = Object.fromEntries(optimizerLimitRows(served).map(r => [r.label, r]))
    expect(byLabel.constraints_limit_u_switch.reg.app).toBe(100)
    expect(byLabel.constraints_limit_u_switch.discretion.app).toBe(120)
    expect(byLabel.constraints_limit_uf.reg.app).toEqual([130])
    expect(byLabel.constraints_limit_uf.discretion.app).toEqual([130, 150])
    expect(byLabel.constraints_limit_worst.reg.app).toBe('hint')
    // LP.UB.02 calls a Bloss curve on this app's straight ramp a Sonderfall —
    // worse than the Regelwert admits; the Ermessensgrenze lets it past.
    expect(byLabel.constraints_limit_forms.reg.app).toEqual(['clothoid'])
    expect(byLabel.constraints_limit_forms.discretion.app).toEqual(['clothoid', 'bloss'])
  })

  it('flags a service that computes with other numbers', () => {
    const stale = structuredClone(served)
    stale.grenzwerte.discretion.uMaxWeiche = 100.0
    const row = optimizerLimitRows(stale).find(r => r.label === 'constraints_limit_u_switch')
    expect(row.discretion.mismatch).toBe(true)
    expect(row.reg.mismatch).toBe(false)
  })

  it('has nothing to compare where the service sent nothing', () => {
    const rows = optimizerLimitRows({ id: 'x' })
    expect(rows.every(r => r.reg.served === null && !r.reg.mismatch)).toBe(true)
  })

  it('names the catalogue version the app bundles', () => {
    expect(BUNDLED_KATALOG_VERSION).toBe(katalog.catalog.katalog_version)
  })
})
