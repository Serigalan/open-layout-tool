import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KATALOG, CATALOG_ID, evaluateRule, evaluateRules, lookupPiecewise, lookupSpeedTable,
  ruleById, rulesForElement, rulesForScope, severityLabelKey, severityRank, worstSeverity,
  OutOfRange,
} from './regelkatalog'
import { parseExpr } from './ruleExpr'
import { CANT_DEFICIENCY_COEFF } from './regelwerkDefaults'
import { translations } from '../locales/i18n'
import {
  cantDefLimit, computeAutoC, MAX_CANT, MAX_SWITCH_CANT, MAX_SWITCH_CANT_DEF,
  MAX_SWITCH_CANT_EXCEPTION,
} from './mapConstants'

const here = path.dirname(fileURLToPath(import.meta.url))
const onDisk = JSON.parse(fs.readFileSync(
  path.join(here, '../regelkataloge/db-ril-800-0110.json'), 'utf-8'))

const PHYSICS = { u0_factor: CANT_DEFICIENCY_COEFF }
const physics = { physics: PHYSICS }

describe('the catalogue file', () => {
  // Bundled, not copied: what the module applies is the file itself, so there
  // is nothing here that could drift from what is maintained in the repo.
  it('is the file in the repo, not a transcription of it', () => {
    expect(KATALOG).toEqual(onDisk)
    expect(CATALOG_ID).toBe('db-ril-800-0110')
  })

  it('is DB Ril 800.0110 itself, in the version and from the date it holds', () => {
    expect(KATALOG.catalog.title).toBe('DB Ril 800.0110 | Linienführung')
    expect(KATALOG.catalog.version).toBe('3.0')
    expect(KATALOG.catalog.gueltig_ab).toBe('2021-02-01')
    // And the source it renders says the same — it is the same document.
    const source = KATALOG.sources.find(s => s.id === 'RIL_800_0110')
    expect(source.version).toBe(KATALOG.catalog.version)
    expect(source.gueltig_ab).toBe(KATALOG.catalog.gueltig_ab)
  })

  // The rules and the values the optimizer runs on are one rulebook under one
  // id — that is what makes the popup show them as one entry rather than two.
  it('carries the id the optimizer service serves the values of', () => {
    const served = JSON.parse(fs.readFileSync(path.join(here,
      '../../tools/optimizer/olt_optimizer/regelwerke/db-ril-800-0110.json'), 'utf-8'))
    expect(served.id).toBe(CATALOG_ID)
    expect(served.name).toBe(KATALOG.catalog.title)
    expect(served.version).toBe(KATALOG.catalog.version)
    expect(served.gueltig_ab).toBe(KATALOG.catalog.gueltig_ab)
  })
})

describe('every rule the catalogue states', () => {
  const rules = KATALOG.rules
  const severities = new Set(KATALOG.severity_levels.map(s => s.id))

  it('carries an id of the documented shape, once', () => {
    const ids = rules.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id, id).toMatch(/^LP\.(ALL|EL|KB|UB|KS)\.\d{2}$/)
  })

  it('ends its evaluation with an else, so no case is left unanswered', () => {
    for (const rule of rules) {
      const last = rule.evaluation[rule.evaluation.length - 1]
      expect(Object.keys(last), rule.id).toContain('else')
    }
  })

  it('only ever answers with a severity the catalogue defines', () => {
    for (const rule of rules) {
      for (const entry of rule.evaluation) {
        const severity = 'else' in entry ? entry.else : entry.severity
        expect(severities.has(severity), `${rule.id} → ${severity}`).toBe(true)
      }
    }
  })

  // Every expression is parsed here, so a typo in the file is a failing test
  // rather than a rule that quietly never fires.
  it('is written in expressions that parse', () => {
    const sources = rules.flatMap(rule => [
      ...Object.values(rule.inputs ?? {}).map(i => i.expr).filter(Boolean),
      ...Object.values(rule.thresholds ?? {}).map(t => t.expr),
      ...(rule.condition ? [rule.condition] : []),
      ...rule.evaluation.map(e => e.if).filter(Boolean),
    ])
    expect(sources.length).toBeGreaterThan(30)
    for (const src of sources) expect(() => parseExpr(src), src).not.toThrow()
    for (const table of Object.values(KATALOG.tables)) {
      for (const piece of table.pieces ?? []) expect(() => parseExpr(piece.expr)).not.toThrow()
      for (const mode of Object.values(table.key_mode ?? {})) {
        if (mode?.expr) expect(() => parseExpr(mode.expr)).not.toThrow()
      }
    }
  })

  it('only looks up tables, sources and open points that exist', () => {
    const openPoints = new Set(KATALOG.open_points.map(p => p.id))
    const sourceIds = new Set(KATALOG.sources.map(s => s.id))
    const tables = Object.keys(KATALOG.tables)
    const looked = []
    for (const rule of rules) {
      expect(sourceIds.has(rule.source.ref), rule.id).toBe(true)
      if (rule.open_point) expect(openPoints.has(rule.open_point), rule.id).toBe(true)
      for (const [, name] of JSON.stringify(rule).matchAll(/lookup\('([a-z_]+)'/g)) {
        looked.push(name)
        expect(tables, rule.id).toContain(name)
      }
    }
    // Both tables are actually reached by a rule — an unreferenced table would
    // be a limit nothing is ever measured against.
    expect(new Set(looked)).toEqual(new Set(tables))
    for (const table of Object.values(KATALOG.tables)) {
      if (table.open_point) expect(openPoints.has(table.open_point)).toBe(true)
      expect(severities.has(table.out_of_range)).toBe(true)
    }
  })

  it('is sorted into the three scopes the checker knows', () => {
    const scopes = new Set(rules.map(r => r.applies_to.scope))
    expect([...scopes].sort()).toEqual(['boundary', 'cant_ramp', 'element'])
    expect(rulesForScope('boundary').map(r => r.id)).toEqual(['LP.UB.01', 'LP.KS.01', 'LP.KS.02'])
    expect(rulesForScope('cant_ramp').map(r => r.id)).toEqual(['LP.UB.02'])
  })
})

describe('the severity ladder', () => {
  it('runs from ok up to error', () => {
    expect(severityRank('ok')).toBe(0)
    expect(severityRank('error')).toBe(5)
    expect(severityRank('warning')).toBeLessThan(severityRank('approval'))
  })

  it('takes the worst of what was said, and nothing where nothing was', () => {
    expect(worstSeverity(['ok', 'hint', 'warning'])).toBe('warning')
    expect(worstSeverity(['ok', 'error', 'approval'])).toBe('error')
    expect(worstSeverity([])).toBe(null)
    expect(worstSeverity([null, null])).toBe(null)
  })
})

describe('the minimum element length table', () => {
  const table = KATALOG.tables.min_element_length

  it('gives each step its own factor', () => {
    expect(lookupPiecewise(table, 40)).toBeCloseTo(4, 10)
    expect(lookupPiecewise(table, 70)).toBeCloseTo(7, 10)     // still 0.1 · v
    expect(lookupPiecewise(table, 75)).toBeCloseTo(11.25, 10) // 0.15 · v
    expect(lookupPiecewise(table, 100)).toBeCloseTo(15, 10)
    expect(lookupPiecewise(table, 120)).toBeCloseTo(24, 10)   // 0.2 · v
    expect(lookupPiecewise(table, 300)).toBeCloseTo(60, 10)
  })

  it('has no value outside the speeds the catalogue covers', () => {
    expect(() => lookupPiecewise(table, 39)).toThrow(OutOfRange)
    expect(() => lookupPiecewise(table, 301)).toThrow(OutOfRange)
  })
})

describe('the comparison radius table', () => {
  const table = KATALOG.tables.comparison_radius
  const formula = (v) => (PHYSICS.u0_factor * v * v) / 106.5

  it('gives a tabulated speed the tabulated value, in both columns', () => {
    expect(lookupSpeedTable(table, 100, 'reg', PHYSICS)).toBe(1370)
    expect(lookupSpeedTable(table, 100, 'discretion', PHYSICS)).toBe(1110)
    expect(lookupSpeedTable(table, 200, 'reg', PHYSICS)).toBe(10000)
  })

  it('takes the next higher row for the Regelwert in between', () => {
    expect(lookupSpeedTable(table, 95, 'reg', PHYSICS)).toBe(1370)
    expect(lookupSpeedTable(table, 155, 'reg', PHYSICS)).toBe(4825)
  })

  it('computes the Ermessensgrenze in between up to 100 km/h, and reads it above', () => {
    expect(lookupSpeedTable(table, 95, 'discretion', PHYSICS)).toBeCloseTo(formula(95), 6)
    expect(lookupSpeedTable(table, 105, 'discretion', PHYSICS)).toBe(1410)
  })

  // What OP.01 assumes: the tabulated Ermessensgrenze is the formula, rounded
  // up onto a readable value. If a row ever fell below its own formula the
  // interpolation would be discontinuous at that row.
  it('has every tabulated Ermessensgrenze at or just above its formula value', () => {
    for (const row of table.rows.filter(r => r.v <= 100)) {
      expect(row.discretion, `v=${row.v}`).toBeGreaterThanOrEqual(formula(row.v))
      expect(row.discretion, `v=${row.v}`).toBeLessThan(formula(row.v) + 3)
    }
  })

  it('has nothing to say above the last row', () => {
    expect(() => lookupSpeedTable(table, 205, 'reg', PHYSICS)).toThrow(OutOfRange)
  })
})

describe('applying a rule', () => {
  const at = (id, scope, options = physics) => evaluateRule(ruleById(id), scope, options)

  it('LP.EL.01 measures the element against the table', () => {
    expect(at('LP.EL.01', { 'element.design_speed': 100, 'element.length': 15 }).severity).toBe('ok')
    expect(at('LP.EL.01', { 'element.design_speed': 100, 'element.length': 14 }).severity).toBe('error')
  })

  it('LP.EL.01 answers a speed the table does not cover with the table\'s own verdict', () => {
    const out = at('LP.EL.01', { 'element.design_speed': 320, 'element.length': 400 })
    expect(out.severity).toBe('error')
    expect(out.outOfRange).toBe(true)
  })

  it('LP.KB.02 raises the deficiency limit above 150 km/h', () => {
    expect(at('LP.KB.02', { 'element.design_speed': 160, 'physics.u_f': 140 }).severity).toBe('ok')
    expect(at('LP.KB.02', { 'element.design_speed': 150, 'physics.u_f': 140 }).severity).toBe('error')
  })

  it('LP.KB.04 states the Regelüberhöhung and only hints at a departure from it', () => {
    const scope = { 'element.design_speed': 100, 'element.radius': 1000, 'element.cant': 65 }
    const ok = at('LP.KB.04', scope)
    expect(ok.values.u_reg).toBe(65)
    expect(ok.severity).toBe('ok')
    expect(at('LP.KB.04', { ...scope, 'element.cant': 60 }).severity).toBe('hint')
  })

  it('LP.KB.04 caps the Regelüberhöhung at 100 mm inside a turnout', () => {
    const scope = { 'element.design_speed': 100, 'element.radius': 300, 'element.cant': 100 }
    const inSwitch = { ...physics, inContext: (id) => id === 'switch_area' }
    // 6.5 · 100² / 300 = 216.7 mm, which no turnout may carry.
    expect(at('LP.KB.04', scope, inSwitch).values.u_reg).toBe(100)
    expect(at('LP.KB.04', scope, physics).values.u_reg).toBe(160)
  })

  it('LP.KB.05 keeps quiet outside a turnout and grades the cant inside one', () => {
    const inSwitch = { ...physics, inContext: (id) => id === 'switch_area' }
    expect(at('LP.KB.05', { 'element.cant': 130 }, physics).applied).toBe(false)
    expect(at('LP.KB.05', { 'element.cant': 100 }, inSwitch).severity).toBe('ok')
    expect(at('LP.KB.05', { 'element.cant': 110 }, inSwitch).severity).toBe('warning')
    expect(at('LP.KB.05', { 'element.cant': 130 }, inSwitch).severity).toBe('error')
  })

  it('LP.UB.03 walks the three steps of the ramp gradient', () => {
    const scope = { 'element.design_speed': 100, 'physics.delta_u': 100 }
    const l = (metres) => at('LP.UB.03', { ...scope, 'element.length': metres }).severity
    expect(l(100)).toBe('ok')        // 1:10·v
    expect(l(85)).toBe('warning')    // past 1:8·v
    expect(l(65)).toBe('approval')   // past 1:6·v
    expect(l(50)).toBe('error')
  })

  it('LP.UB.03 says nothing where there is no ramp', () => {
    expect(at('LP.UB.03', {
      'element.design_speed': 100, 'physics.delta_u': 0, 'element.length': 5,
    }).applied).toBe(false)
  })

  it('LP.KS.01 grades the comparison radius against the table', () => {
    const scope = { 'physics.curvature_jump': true, 'prev.design_speed': 100, 'next.design_speed': 100 }
    const rw = (r) => at('LP.KS.01', { ...scope, 'physics.r_w': r }).severity
    expect(rw(1370)).toBe('ok')
    expect(rw(1200)).toBe('warning')
    expect(rw(1000)).toBe('error')
  })

  it('LP.KS.01 takes the faster of the two elements that meet', () => {
    const out = at('LP.KS.01', {
      'physics.curvature_jump': true, 'prev.design_speed': 60, 'next.design_speed': 120,
      'physics.r_w': 2000,
    })
    expect(out.values.v).toBe(120)
    expect(out.severity).toBe('warning')       // 2170 reg, 1745 discretion
  })
})

describe('applying a list of rules', () => {
  it('leaves out what a rule excludes itself from', () => {
    const scope = {
      'prev.cant_end': 0, 'next.cant_start': 0, 'prev.design_speed': 100, 'next.design_speed': 100,
      'physics.curvature_jump': true, 'physics.r_w': 300,
    }
    const outside = evaluateRules(rulesForScope('boundary'), scope, physics)
    expect(outside.results.map(r => r.id)).toEqual(['LP.UB.01', 'LP.KS.01', 'LP.KS.02'])
    expect(outside.severity).toBe('error')

    const inside = evaluateRules(rulesForScope('boundary'), scope, { ...physics, excluded: ['switch_internal'] })
    expect(inside.results.map(r => r.id)).toEqual(['LP.UB.01'])
  })

  it('picks the element rules by type and form', () => {
    expect(rulesForElement('straight').map(r => r.id))
      .toEqual(['LP.ALL.01', 'LP.ALL.02', 'LP.EL.01', 'LP.EL.02'])
    expect(rulesForElement('circular_arc').map(r => r.id))
      .toEqual(['LP.ALL.01', 'LP.ALL.02', 'LP.EL.01', 'LP.KB.01', 'LP.KB.02', 'LP.KB.03',
        'LP.KB.04', 'LP.KB.05', 'LP.KB.06'])
    const clothoid = rulesForElement('transition_curve', 'clothoid').map(r => r.id)
    expect(clothoid).toContain('LP.UB.03')
    expect(clothoid).toContain('LP.UB.05')
    expect(clothoid).not.toContain('LP.UB.04')
    const bloss = rulesForElement('transition_curve', 'bloss').map(r => r.id)
    expect(bloss).toContain('LP.UB.04')
    expect(bloss).not.toContain('LP.UB.03')
  })
})

// The catalogue restates limits the served regelwerk already carries as bare
// numbers, because the two are written for different readers: the optimizer
// reads a value, this reads a rule with its steps of severity. Restating them
// is only safe while something fails when they part company.
describe('where the catalogue and the served regelwerk overlap', () => {
  const repoRoot = path.resolve(here, '../..')
  const ril = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'tools/optimizer/olt_optimizer/regelwerke/db-ril-800-0110.json'), 'utf-8'))
  const physicsFile = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'tools/optimizer/physics.json'), 'utf-8'))

  // Every threshold is read back out of the rule rather than out of the file's
  // text: what is compared is then what the checker would really apply.
  const thresholds = (id, scope, options = physics) =>
    evaluateRule(ruleById(id), scope, options).values
  const inSwitch = { ...physics, inContext: (id) => id === 'switch_area' }

  it('agrees on the cant a curve and a turnout may carry', () => {
    expect(thresholds('LP.KB.01', { 'element.cant': 0 }).max).toBe(ril.ueberhoehung.u_max.wert)
    const turnout = thresholds('LP.KB.05', { 'element.cant': 0 }, inSwitch)
    expect(turnout.reg).toBe(ril.weiche.u_max.wert)
    expect(turnout.discretion).toBe(ril.weiche.ausnahme_120.wert)
  })

  it('agrees on the deficiency a turnout may carry', () => {
    expect(thresholds('LP.KB.06', { 'physics.u_f': 0 }, inSwitch).max).toBe(ril.weiche.uf_max.wert)
  })

  // The optimizer keeps one ramp factor per transition form; in the catalogue
  // that factor is the Ermessensgrenze, with a Regelwert above it and a
  // Zustimmungswert below. Read at v = 1 km/h and Δu = 1000 mm the threshold
  // is the factor itself.
  it('agrees on the ramp factors, as the step the optimizer plans to', () => {
    const factors = (id) => thresholds(id, {
      'element.design_speed': 1, 'physics.delta_u': 1000, 'element.length': 0,
    })
    expect(factors('LP.UB.03').discretion).toBe(ril.rampenregel.faktor_klothoide.wert)
    expect(factors('LP.UB.04').discretion).toBe(ril.rampenregel.faktor_bloss.wert)
  })

  it('agrees on the minimum element length above 100 km/h', () => {
    const table = KATALOG.tables.min_element_length
    expect(lookupPiecewise(table, 200) / 200).toBeCloseTo(ril.mindestlaenge.koeffizient.wert, 10)
  })

  it('computes the comparison radius with the physics file\'s own coefficient', () => {
    expect(PHYSICS.u0_factor).toBe(physicsFile.ueberhoehungsfehlbetrag_koeffizient.wert)
  })
})

describe('what the viewer asks the locales for', () => {
  it('has a name for every severity the catalogue can answer with', () => {
    const languages = Object.keys(translations)
    for (const level of KATALOG.severity_levels) {
      const key = severityLabelKey(level.id)
      for (const lang of languages) {
        expect(typeof translations[lang][key], `${lang}/${key}`).toBe('string')
      }
    }
  })
})

// The app has judged cant since long before the catalogue existed — the
// dialogs have to answer on every keystroke, so they carry their own numbers
// (mapConstants). Where the two speak about the same limit they have to say
// the same thing, or the element table would contradict the dialog that let
// the value be typed.
describe('where the catalogue and the app\'s own cant constants overlap', () => {
  const thresholds = (id, scope, options = physics) =>
    evaluateRule(ruleById(id), scope, options).values
  const inSwitch = { ...physics, inContext: (id) => id === 'switch_area' }

  it('computes the same Regelüberhöhung the cant button fills in', () => {
    // computeAutoC is 6.5 · v² / R on the 5 mm step, which is LP.KB.04's u_reg.
    for (const [v, r] of [[100, 1000], [80, 600], [160, 4000]]) {
      const u_reg = thresholds('LP.KB.04', {
        'element.design_speed': v, 'element.radius': r, 'element.cant': 0,
      }).u_reg
      expect(u_reg, `${v} km/h, R ${r}`).toBe(Math.abs(computeAutoC(v, r)))
    }
  })

  it('holds a turnout to the same cant and deficiency the switch dialogs do', () => {
    const turnout = thresholds('LP.KB.05', { 'element.cant': 0 }, inSwitch)
    expect(turnout.reg).toBe(MAX_SWITCH_CANT)
    expect(turnout.discretion).toBe(MAX_SWITCH_CANT_EXCEPTION)
    expect(thresholds('LP.KB.06', { 'physics.u_f': 0 }, inSwitch).max).toBe(MAX_SWITCH_CANT_DEF)
  })

  it('holds the deficiency to the same step the dialogs and the V_max column do', () => {
    for (const v of [40, 100, 150, 151, 200, 300]) {
      expect(thresholds('LP.KB.02', {
        'element.design_speed': v, 'physics.u_f': 0,
      }).max, `${v} km/h`).toBe(cantDefLimit(v))
    }
  })

  // Until AP R.8 the dialogs accepted 170 mm where the catalogue allowed 160,
  // and the rule column was what made the difference visible (Entscheidung
  // 48). Now the dialogs take the limit from the catalogue, so the two are
  // the same number by construction — and this is what keeps them so.
  it('is where the dialogs get their cant limit from', () => {
    expect(MAX_CANT).toBe(thresholds('LP.KB.01', { 'element.cant': 0 }).max)
  })
})
