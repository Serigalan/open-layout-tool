import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WEICHEN_REGELWERK, WEICHEN_REGELWERK_ID, weichenGruppen } from './weichenRegelwerk'
import {
  SWITCH_TYPES, SWITCH_TYPES_SPECIAL, CROSSING_TYPES,
} from './switchUtils'
import { switchKindLabelKey } from './switchModel'
import { translations } from '../locales/i18n'
import {
  evaluateRule, ruleById, lookupPiecewise, KATALOG, IN_SWITCH_AREA,
} from './regelkatalog'
import { computeCantDefSigned } from './mapConstants'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const languages = Object.keys(translations)
const says = (key) => languages.every(lang => typeof translations[lang][key] === 'string')

const gruppen = weichenGruppen()
const byKey = Object.fromEntries(gruppen.map(g => [g.key, g]))
const form = (key, label) => byKey[key].formen.find(f => f.label === label)

describe('the switch forms as a regelwerk', () => {
  // The catalogue's own order: the Regelformen of A01 first, the
  // Sonderbauformen of A02 after, each split by what a row can state.
  it('groups the forms the way the Ril itself does', () => {
    expect(gruppen.map(g => g.key)).toEqual([
      'regel_weichen', 'regel_kreuzungen', 'regel_kreuzungsweichen',
      'sonder_weichen', 'sonder_kreuzungen', 'sonder_kreuzungsweichen',
    ])
    expect(byKey.regel_weichen.formen.map(f => f.label)).toEqual(SWITCH_TYPES.map(f => f.label))
    expect(byKey.sonder_weichen.formen.map(f => f.label))
      .toEqual(SWITCH_TYPES_SPECIAL.map(f => f.label))
    // Every crossing form is in exactly one of the crossing groups.
    const kreuzungen = gruppen.filter(g => g.art === 'kreuzung').flatMap(g => g.formen)
    expect(kreuzungen.map(f => f.label).sort())
      .toEqual(CROSSING_TYPES.map(f => f.label).sort())
  })

  // An empty table would claim the Ril has no such group — which is how the
  // Bogenkreuzungsweichen of A02 stayed out of sight until AP 3.4.
  it('leaves out a group with no form in it', () => {
    expect(gruppen.every(g => g.formen.length)).toBe(true)
    expect(byKey.sonder_kreuzungsweichen.formen.map(f => f.label))
      .toEqual(['EBKW 1:9 – 500.860', 'DBKW 1:9 – 500.860'])
  })

  it('says of each group whether it has turnout columns or crossing ones', () => {
    expect(gruppen.map(g => g.art))
      .toEqual(['weiche', 'kreuzung', 'kreuzung', 'weiche', 'kreuzung', 'kreuzung'])
  })

  // The viewer keys its rows by label; two forms with one label would be one row.
  it('names every form once across all tables', () => {
    const labels = gruppen.flatMap(g => g.formen.map(f => f.label))
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('reads a turnout form as the table states it', () => {
    expect(form('regel_weichen', '190 – 1:9')).toEqual({
      label: '190 – 1:9', radius: 190, neigung: 9, speed: 40, marke: 3.9, minl: 6,
      gerade: 6.092, symmetrisch: false,
    })
  })

  it('gives a branch that is one arc no straight end piece', () => {
    expect(form('regel_weichen', '300 – 1:9').gerade).toBe(0)
    expect(form('regel_weichen', '190 – 1:7.5').gerade).toBeCloseTo(0.640, 6)
  })

  it('marks the symmetrical turnout, and only it', () => {
    const symmetrisch = gruppen.flatMap(g => g.formen).filter(f => f.symmetrisch)
    expect(symmetrisch.map(f => f.label)).toEqual(['215 – 1:4.8'])
  })

  it('reads a plain crossing as tangent and angle, with no radius', () => {
    expect(form('regel_kreuzungen', 'Kr 1:9')).toEqual({
      label: 'Kr 1:9', kind: 'crossing', neigung: 9, radius: null, tangente: 16.6155,
      speed: 100, marke: 3.9, routen: null,
    })
  })

  it('reads a crossing switch as angle and curve radius, with a speed per route', () => {
    expect(form('regel_kreuzungsweichen', 'DKW 1:9 – 190')).toEqual({
      label: 'DKW 1:9 – 190', kind: 'double_slip', neigung: 9, radius: 190, tangente: null,
      speed: null, marke: null,
      routen: [
        { id: 'durchgehend', R: null, speed: 100 },
        { id: 'bogen', R: 190, speed: 40 },
      ],
    })
  })

  // A Bogenkreuzungsweiche has no one radius, and what it states in the tangent
  // column is the length of its curved legs, l_b.
  it('reads a Bogenkreuzungsweiche as its routes and its l_b', () => {
    expect(form('sonder_kreuzungsweichen', 'DBKW 1:9 – 500.860')).toEqual({
      label: 'DBKW 1:9 – 500.860', kind: 'double_slip', neigung: 9, radius: null,
      tangente: 27.6584, speed: null, marke: null,
      routen: [
        { id: 'verbindung', R: null, speed: 100 },
        { id: 'kreuzungsgleis', R: 500.86, speed: 60 },
        { id: 'innenbogen', R: 249.763, speed: 40 },
      ],
    })
  })

  it('keeps a Weichenmarke that stands before the body ends', () => {
    expect(form('sonder_kreuzungen', 'Kr 1:4.444').marke).toBe(-1.48)
  })
})

describe('what the viewer asks the locales for', () => {
  it('has a name and a note for every group, in every language', () => {
    for (const g of gruppen) {
      expect(says(g.titleKey), g.titleKey).toBe(true)
      expect(says(g.hintKey), g.hintKey).toBe(true)
    }
  })

  it('names every kind of crossing a row carries', () => {
    for (const f of gruppen.filter(g => g.art === 'kreuzung').flatMap(g => g.formen)) {
      expect(says(switchKindLabelKey(f.kind)), f.label).toBe(true)
    }
  })

  it('has the column headings and the notes beside them', () => {
    for (const key of [
      'constraints_weichen', 'constraints_weichen_hint', 'constraints_weichen_form',
      'constraints_weichen_art', 'constraints_weichen_radius', 'constraints_weichen_neigung',
      'constraints_weichen_speed', 'constraints_weichen_marke', 'constraints_weichen_minl',
      'constraints_weichen_gerade', 'constraints_weichen_tangente',
      'constraints_weichen_symmetrisch', 'constraints_service_down',
    ]) expect(says(key), key).toBe(true)
  })
})

describe('what rulebook it is', () => {
  it('is DB Ril 800.0120, versioned as the rendering it is', () => {
    // What it says about itself is the catalogue's own head, not a second
    // statement beside it.
    expect(WEICHEN_REGELWERK.id).toBe('db-ril-800-0120')
    expect(WEICHEN_REGELWERK.title).toBe('DB Ril 800.0120 | Auswahl der Weichen und Kreuzungen')
    expect(WEICHEN_REGELWERK.katalog_version).toBe('0.2.0')
    expect(WEICHEN_REGELWERK.status).toBe('draft')
    // The Ril's own edition and validity date are stated nowhere.
    expect(WEICHEN_REGELWERK.version).toBeUndefined()
    expect(WEICHEN_REGELWERK.gueltig_ab).toBeUndefined()
    expect(WEICHEN_REGELWERK_ID).toBe(WEICHEN_REGELWERK.id)
  })

  // The selector puts served and bundled regelwerke in one list, and folds two
  // entries with one id into one — so 800.0120, which the service does not
  // serve, may not collide with the id of one it does.
  it('is not the id the service serves', () => {
    const served = JSON.parse(fs.readFileSync(
      path.join(repoRoot, 'tools/optimizer/olt_optimizer/regelwerke/db-ril-800-0110.json'), 'utf-8'))
    expect(served.id).not.toBe(WEICHEN_REGELWERK_ID)
  })
})

// Two rulebooks, one layout: a form 800.0120 offers has to be one 800.0110
// would let a train over. Nothing here restates a limit — every number comes
// out of the other catalogue's own rules.
describe('DB Ril 800.0120 against DB Ril 800.0110 and the physics', () => {
  const withSpeed = gruppen.flatMap(g => g.formen).filter(f => f.speed != null)

  it('states a branch speed the Linienführung has rules for, on its 5 km/h grid', () => {
    expect(withSpeed.length).toBeGreaterThan(15)
    for (const f of withSpeed) {
      expect(evaluateRule(ruleById('LP.ALL.01'), { 'element.design_speed': f.speed }).severity,
        `${f.label}: ${f.speed} km/h`).toBe('ok')
      expect(evaluateRule(ruleById('LP.ALL.02'), { 'element.design_speed': f.speed }).severity,
        `${f.label}: ${f.speed} km/h`).toBe('ok')
    }
  })

  // A turnout's branch is driven uncanted — a switch is built on one set of
  // sleepers. So every form has to keep LP.KB.06 on its radius alone.
  it('keeps every branch inside the deficiency a turnout may carry, with no cant at all', () => {
    const turnouts = gruppen.filter(g => g.art === 'weiche').flatMap(g => g.formen)
    expect(turnouts.length).toBeGreaterThan(10)
    for (const f of turnouts) {
      const u_f = computeCantDefSigned(f.speed, f.radius, 0)
      const out = evaluateRule(ruleById('LP.KB.06'), { 'physics.u_f': u_f }, IN_SWITCH_AREA)
      expect(out.severity, `${f.label}: ${u_f} mm at ${f.speed} km/h`).toBe('ok')
    }
  })

  // A crossing switch is built on one set of sleepers as well: every curved
  // route it states has to keep LP.KB.06 at its own speed, uncanted.
  it('keeps every curved route of a crossing switch inside that deficiency too', () => {
    const routes = gruppen.filter(g => g.art === 'kreuzung').flatMap(g => g.formen)
      .flatMap(f => (f.routen ?? []).map(route => ({ ...route, label: f.label })))
      .filter(route => route.R != null)
    expect(routes.length).toBeGreaterThanOrEqual(7)
    for (const route of routes) {
      const u_f = computeCantDefSigned(route.speed, route.R, 0)
      const out = evaluateRule(ruleById('LP.KB.06'), { 'physics.u_f': u_f }, IN_SWITCH_AREA)
      expect(out.severity, `${route.label} ${route.id}: ${u_f} mm at ${route.speed} km/h`).toBe('ok')
    }
  })

  // The shortest straight 800.0120 asks for between two turnouts is never
  // shorter than the shortest element 800.0110 allows at that speed — for the
  // flatter forms the two are the same number.
  it('asks for an intermediate straight the Linienführung would also allow', () => {
    const withMinl = gruppen.filter(g => g.art === 'weiche').flatMap(g => g.formen)
      .filter(f => f.minl != null)
    expect(withMinl.length).toBeGreaterThan(10)
    for (const f of withMinl) {
      const l_min = lookupPiecewise(KATALOG.tables.min_element_length, f.speed)
      expect(f.minl, `${f.label}: ${f.minl} m against ${l_min} m`).toBeGreaterThanOrEqual(l_min)
    }
  })
})
