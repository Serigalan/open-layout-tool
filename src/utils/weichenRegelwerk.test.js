import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WEICHEN_REGELWERK_ID, weichenGruppen } from './weichenRegelwerk'
import {
  SWITCH_TYPES, SWITCH_TYPES_ALT1, SWITCH_TYPES_ALT2, SWITCH_TYPES_INVENTORY, CROSSING_TYPES,
} from './switchUtils'
import { switchKindLabelKey } from './switchModel'
import { translations } from '../locales/i18n'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const languages = Object.keys(translations)
const says = (key) => languages.every(lang => typeof translations[lang][key] === 'string')

const gruppen = weichenGruppen()
const byKey = Object.fromEntries(gruppen.map(g => [g.key, g]))
const form = (key, label) => byKey[key].formen.find(f => f.label === label)

describe('the switch forms as a regelwerk', () => {
  it('lists every table switchUtils holds, in the order the connection reaches for them', () => {
    expect(gruppen.map(g => g.key)).toEqual(['regel', 'alt1', 'alt2', 'bestand', 'kreuzung'])
    expect(gruppen.map(g => g.formen.length)).toEqual([
      SWITCH_TYPES.length, SWITCH_TYPES_ALT1.length, SWITCH_TYPES_ALT2.length,
      SWITCH_TYPES_INVENTORY.length, CROSSING_TYPES.length,
    ])
    expect(byKey.regel.formen.map(f => f.label)).toEqual(SWITCH_TYPES.map(f => f.label))
    expect(byKey.kreuzung.formen.map(f => f.label)).toEqual(CROSSING_TYPES.map(f => f.label))
  })

  it('says of each group whether it has turnout columns or crossing ones', () => {
    expect(gruppen.map(g => g.art)).toEqual(['weiche', 'weiche', 'weiche', 'weiche', 'kreuzung'])
  })

  // The viewer keys its rows by label; two forms with one label would be one row.
  it('names every form once across all tables', () => {
    const labels = gruppen.flatMap(g => g.formen.map(f => f.label))
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('reads a turnout form as the table states it', () => {
    expect(form('regel', '190 – 1:9')).toEqual({
      label: '190 – 1:9', radius: 190, neigung: 9, speed: 40, marke: 3.9, minl: 6,
      gerade: 6.092, symmetrisch: false,
    })
  })

  it('gives a branch that is one arc no straight end piece', () => {
    expect(form('regel', '300 – 1:9').gerade).toBe(0)
    expect(form('regel', '190 – 1:7.5').gerade).toBeCloseTo(0.640, 6)
  })

  it('marks the symmetrical turnout, and only it', () => {
    const symmetrisch = gruppen.flatMap(g => g.formen).filter(f => f.symmetrisch)
    expect(symmetrisch.map(f => f.label)).toEqual(['215 – 1:4.8'])
  })

  it('reads a plain crossing as tangent and angle, with no radius', () => {
    expect(form('kreuzung', 'Kr 1:9')).toEqual({
      label: 'Kr 1:9', kind: 'crossing', neigung: 9, radius: null, tangente: 16.6155,
      speed: 100, marke: 3.9,
    })
  })

  it('reads a crossing switch as angle and curve radius, with no tangent', () => {
    expect(form('kreuzung', 'DKW 1:9 – 190')).toEqual({
      label: 'DKW 1:9 – 190', kind: 'double_slip', neigung: 9, radius: 190, tangente: null,
      speed: null, marke: null,
    })
  })

  it('keeps a Weichenmarke that stands before the body ends', () => {
    expect(form('kreuzung', 'Kr 1:4.444').marke).toBe(-1.48)
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
    for (const f of byKey.kreuzung.formen) {
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

describe('the id it carries in the selector', () => {
  // The selector puts served and bundled regelwerke in one list, so the one id
  // that is not the service's may not collide with one that is.
  it('is not an id the service serves', () => {
    const served = JSON.parse(fs.readFileSync(
      path.join(repoRoot, 'tools/optimizer/olt_optimizer/regelwerke/db-ril-800.json'), 'utf-8'))
    expect(served.id).not.toBe(WEICHEN_REGELWERK_ID)
  })
})
